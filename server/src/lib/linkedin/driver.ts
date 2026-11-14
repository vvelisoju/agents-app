// LKD-1 (Wave 1) — LinkedIn browser driver.
//
// Drives a real, logged-in Chrome session (the SAME pattern as the WhatsApp adapter: Puppeteer,
// headless, self-healing). It injects the owner's stored `li_at` cookie (lib/linkedin/session.ts)
// into a browser context and performs the owner's instructions: publish a post, comment/reply on a
// post, or reshare a post. There is NO LinkedIn API call here — this is owner-operated automation.
//
// ⚠️ LIVE-TUNING REQUIRED: LinkedIn's DOM/selectors are not a stable contract and WILL need
// tuning on the owner's own machine against the real logged-in page. Every selector/flow below is
// isolated in SELECTORS + the three action functions and marked, so tuning touches one place. The
// worker only ever runs an action the owner has APPROVED, so nothing fires unattended while tuning.
//
// Puppeteer is required LAZILY (like the pg/mysql drivers) so importing this module never launches
// a browser and the API/test process is unaffected until the worker actually runs an action.
import { getSession, setSessionStatus } from './session';

// A failure that means the session itself is no longer usable — the worker flips the stored
// session's status and alerts the owner to re-link, rather than retrying blindly.
export class SessionError extends Error {
  constructor(public linkStatus: 'needs_relink' | 'checkpoint', message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface ActionResult { url?: string }

// The WRITE contract the action worker depends on. The real implementation (realDriver) drives
// Puppeteer; tests inject a mock so the action/approval/worker logic is verified without Chrome.
export interface LinkedInDriver {
  publishPost(orgId: string, agentId: string, text: string): Promise<ActionResult>;
  commentOnPost(orgId: string, agentId: string, postUrl: string, text: string): Promise<ActionResult>;
  resharePost(orgId: string, agentId: string, postUrl: string, caption?: string): Promise<ActionResult>;
}

export interface LatestPost { postId: string; postUrl: string; text: string }

// LKD-2: the READ contract the monitor depends on (kept separate from the write driver so the
// monitor can be tested with a stub reader and the write-driver mocks stay unchanged).
export interface LinkedInReader {
  fetchLatestPost(orgId: string, agentId: string, profileUrl: string): Promise<LatestPost | null>;
}

// ── Everything LinkedIn-DOM-specific lives here. Tune these on the owner's machine. ──
const SELECTORS = {
  // When any of these is present after load, we are NOT logged in (cookie dead) or hit a checkpoint.
  loginWall: 'input#username, .authwall, form.login__form',
  checkpoint: '[data-id="checkpoint"], .challenge, #captcha-internal',
  // Composer (home feed "Start a post" → modal editor → Post button).
  startPost: 'button.share-box-feed-entry__trigger, button[aria-label^="Start a post"]',
  editor: 'div.ql-editor[contenteditable="true"], div[role="textbox"]',
  postSubmit: 'button.share-actions__primary-action, button[aria-label="Post"]',
  // Comment box + submit on a post permalink page.
  commentBox: 'div.comments-comment-box div[role="textbox"], div.ql-editor[contenteditable="true"]',
  commentSubmit: 'button.comments-comment-box__submit-button, button[aria-label="Post comment"]',
  // Reshare flow.
  reshareButton: 'button[aria-label^="Repost"], button[aria-label^="Share"]',
  reshareWithThoughts: 'div[aria-label="Repost with your thoughts"], button:has-text("Repost with your thoughts")',
  // LKD-2 — a single activity/update card on a profile's recent-activity page.
  feedUpdate: 'div.feed-shared-update-v2[data-urn], div[data-urn^="urn:li:activity"]',
};

const NAV_TIMEOUT_MS = Number(process.env.LINKEDIN_NAV_TIMEOUT_MS) || 45_000;

// Human-paced helpers — small randomised delays so actions don't look like a burst bot.
const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Launch a logged-in browser for the agent, run `fn(page)`, and always clean up. Mirrors the
// WhatsApp adapter's launch args. Throws SessionError when the cookie is missing/dead/challenged.
async function withPage<T>(orgId: string, agentId: string, fn: (page: any) => Promise<T>): Promise<T> {
  const session = await getSession(orgId, agentId);
  if (!session?.li_at) throw new SessionError('needs_relink', 'no active LinkedIn session — paste your cookie to connect');

  // Lazy require — identical rationale to lib/connectors.ts (pg/mysql) and channels/whatsapp.ts.
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    const cookies = [{ name: 'li_at', value: session.li_at, domain: '.linkedin.com', path: '/', httpOnly: true, secure: true }];
    if (session.jsessionid) cookies.push({ name: 'JSESSIONID', value: session.jsessionid, domain: '.linkedin.com', path: '/', httpOnly: false, secure: true } as any);
    await page.setCookie(...cookies);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

// After navigating, bail out clearly if LinkedIn bounced us to login or a security challenge.
async function assertAuthed(page: any): Promise<void> {
  const url: string = page.url();
  if (/\/checkpoint\//.test(url) || (await page.$(SELECTORS.checkpoint))) {
    throw new SessionError('checkpoint', 'LinkedIn presented a security checkpoint — resolve it in your browser, then re-link');
  }
  if (/\/(login|uas\/login)/.test(url) || (await page.$(SELECTORS.loginWall))) {
    throw new SessionError('needs_relink', 'LinkedIn is no longer logged in with this cookie — re-link your session');
  }
}

// Type text into a contenteditable editor with human-like keystroke delays.
async function typeHuman(page: any, selector: string, text: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: NAV_TIMEOUT_MS });
  await page.click(selector);
  await sleep(rand(300, 900));
  await page.type(selector, text, { delay: rand(20, 70) });
  await sleep(rand(500, 1200));
}

export const realDriver: LinkedInDriver & LinkedInReader = {
  // ── LKD-2 · NEEDS LIVE TUNING: read the person's most recent activity post. ──
  async fetchLatestPost(orgId, agentId, profileUrl) {
    const url = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';
    return withPage(orgId, agentId, async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await assertAuthed(page);
      await page.waitForSelector(SELECTORS.feedUpdate).catch(() => {});
      // Read the first activity card: its data-urn (stable post id), permalink, and text.
      const post = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const urn = el.getAttribute('data-urn') || el.querySelector('[data-urn]')?.getAttribute('data-urn') || '';
        const textEl = el.querySelector('.update-components-text, .feed-shared-update-v2__description');
        const text = (textEl?.textContent || '').trim();
        return { urn, text };
      }, SELECTORS.feedUpdate);
      if (!post || !post.urn) return null;
      const postUrl = `https://www.linkedin.com/feed/update/${post.urn}/`;
      return { postId: post.urn, postUrl, text: post.text };
    });
  },

  // ── NEEDS LIVE TUNING against the real logged-in feed. ──
  async publishPost(orgId, agentId, text) {
    return withPage(orgId, agentId, async (page) => {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
      await assertAuthed(page);
      await page.waitForSelector(SELECTORS.startPost);
      await page.click(SELECTORS.startPost);
      await sleep(rand(800, 1600));
      await typeHuman(page, SELECTORS.editor, text);
      await page.waitForSelector(SELECTORS.postSubmit);
      await page.click(SELECTORS.postSubmit);
      await sleep(rand(1500, 3000));
      return { url: page.url() };
    });
  },

  // ── NEEDS LIVE TUNING against a post permalink page. ──
  async commentOnPost(orgId, agentId, postUrl, text) {
    return withPage(orgId, agentId, async (page) => {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
      await assertAuthed(page);
      await typeHuman(page, SELECTORS.commentBox, text);
      await page.waitForSelector(SELECTORS.commentSubmit);
      await page.click(SELECTORS.commentSubmit);
      await sleep(rand(1500, 3000));
      return { url: postUrl };
    });
  },

  // ── NEEDS LIVE TUNING: reshare ("repost with your thoughts" when a caption is given). ──
  async resharePost(orgId, agentId, postUrl, caption) {
    return withPage(orgId, agentId, async (page) => {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
      await assertAuthed(page);
      await page.waitForSelector(SELECTORS.reshareButton);
      await page.click(SELECTORS.reshareButton);
      await sleep(rand(800, 1600));
      if (caption && caption.trim()) {
        await page.click(SELECTORS.reshareWithThoughts).catch(() => {});
        await typeHuman(page, SELECTORS.editor, caption);
        await page.waitForSelector(SELECTORS.postSubmit);
        await page.click(SELECTORS.postSubmit);
      }
      await sleep(rand(1500, 3000));
      return { url: postUrl };
    });
  },
};

// Re-export so the worker can flip session status on a SessionError without another import.
export { setSessionStatus };
