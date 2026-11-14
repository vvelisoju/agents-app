// LKD-1 (Wave 0) — LinkedIn channel adapter: catalog presence only.
//
// This registers 'linkedin-browser' so it appears in the "Add agent" gallery (generated from the
// registry), but it is a COMING-SOON tile (ready:false) until the browser worker + session flow
// land in Wave 1. Onboarding is 'token' (the owner pastes their session cookie — see
// lib/linkedin/session.ts), NOT QR/OAuth.
//
// IMPORTANT: LinkedIn is owner-operated, proactive/approval-gated automation — there is no inbound
// message to answer, so this channel has NO reply path. send() throws deliberately: posting and
// reactions go through the approval-gated LinkedIn action worker (Wave 1), never the engine's
// inbound reply path. Keeping send() a hard error means a mis-routed reply fails loudly in dev
// rather than silently pretending to deliver. See docs/LINKEDIN_AGENT_PLAN.md.
import { register } from './registry';

register({
  type: 'linkedin-browser',
  onboarding: 'token',
  label: 'LinkedIn',
  blurb: 'Post from your own account (owner-operated, approval-gated)',
  ready: false, // coming-soon until Wave 1 (browser worker + session) ships
  capabilities: ['text'],
  send: async () => {
    throw new Error(
      'linkedin-browser has no inbound reply path; posts/reactions run through the approval-gated LinkedIn action worker',
    );
  },
});
