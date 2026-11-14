# Secure Agents — Marketing Landing Page

A **standalone, zero-build** marketing site for the Secure Agents platform. It is deliberately
**separate from the app** (`client/`) so you can deploy it on its own domain for SEO, speed and
independent iteration — the app never has to be rebuilt to change the pitch.

```
landing/
├── index.html      ← the whole page (inline CSS + JS, no build step, no dependencies)
├── robots.txt      ← crawler rules + sitemap pointer
├── sitemap.xml     ← one-URL sitemap for Search Console
└── README.md       ← this file
```

## Before you go live — swap 4 things

| What | Where | From → To |
|---|---|---|
| **App URL** (all "Create your agent" / "Sign in" CTAs) | `index.html`, `<script>` near the bottom: `var APP_URL` | `https://app.example.com` → your app origin |
| **Marketing domain** (canonical, Open Graph, Twitter, sitemap) | `index.html` `<head>` + `robots.txt` + `sitemap.xml` | `https://www.example.com` → your domain |
| **Social preview image** | `index.html` `og:image` / `twitter:image` | `https://www.example.com/og-cover.png` → a real 1200×630 image you host beside `index.html` |
| **Contact email + footer links** | footer in `index.html` | `hello@example.com` → your real email |

> Tip: find-and-replace `www.example.com` and `app.example.com` across the three files.

## Deploy (pick one — all are free-tier friendly)

It's a static folder, so it works anywhere:

- **Netlify / Vercel / Cloudflare Pages:** drag-drop the `landing/` folder, or point the project's
  publish/root directory at `landing`. No build command needed.
- **GitHub Pages:** push and serve the `landing/` folder.
- **S3 + CloudFront / any static host / Nginx:** upload the three files; serve `index.html` at `/`.

Keep it on a **separate domain or subdomain** from the app (e.g. `www.yourbrand.com` for this page,
`app.yourbrand.com` for the product) so marketing SEO and the app deploy independently.

## What's already done for SEO & performance

- Semantic HTML, a single `<h1>`, descriptive headings, `alt`/`aria` labels.
- `<title>` + meta description + keywords + canonical + `theme-color`.
- **Open Graph + Twitter Card** tags for rich link previews.
- **JSON-LD structured data**: `SoftwareApplication`, `Organization`, and a `FAQPage`
  (eligible for FAQ rich results).
- `robots.txt` + `sitemap.xml`.
- Fast by design: no framework, no bundler; only Google Fonts loads externally (with `preconnect`).
- Responsive down to phone width, dark theme matched to the app brand
  (violet→cyan gradient, `#0b1220` base), and `prefers-reduced-motion` respected.

## After launch (optional, high-value)

- Add Google Search Console + submit the sitemap.
- Add analytics (Plausible/GA) — one snippet before `</body>`.
- Create the real `og-cover.png` (1200×630) for shareable link previews.
- A/B the hero headline — it's the single highest-leverage line on the page.
