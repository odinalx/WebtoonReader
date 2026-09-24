# Chrome Web Store kit

Everything needed to publish Dokhae on the Chrome Web Store.

| File | What |
|---|---|
| `listing-fr.md` | Listing in French (default language): descriptions, category, single purpose, permission justifications, privacy tab answers, links |
| `listing-en.md` | The same in English (secondary language) |
| `assets/` | Icon 128, five 1280 × 800 screenshots, small promo tile 440 × 280 |

## Build the package

```sh
npm ci
WXT_SITE_URL=https://dokhae.fr npm run zip
```

This writes `.output/dokhae-extension-1.0.0-chrome.zip` (about 15 MB, most
of it the Korean OCR model). `npm run zip` sets `SORI_RELEASE`, so the build
refuses a localhost `WXT_SITE_URL`. Never set `SORI_SCREENSHOTS` for a
release: it adds `<all_urls>`.

Before uploading, check `.output/chrome-mv3/manifest.json`:

- `name` Dokhae, `version` bumped (the store refuses a version it has seen),
- `host_permissions` ends with `https://dokhae.fr/*` and holds no
  `localhost:3000` and no `<all_urls>`,
- `content_scripts` has only `https://dokhae.fr/connect-extension*`.

For an update, bump `version` in both `wxt.config.ts` and `package.json`.

## Screenshots

The captures come from the real extension against the local site, through
the site's `scripts/screenshots/shoot.mjs` (build with
`WXT_SITE_URL=http://localhost:3000 SORI_SCREENSHOTS=1 npm run build`,
then run it with `SORI_DEMO=real-panel.html SORI_CHIP=어떻게`). They were
then laid out at 1280 × 800 on the cream background with a French caption.

## By hand in the dashboard

1. Upload the zip (Package), then fill Store listing from `listing-fr.md`;
   add English from `listing-en.md`.
2. Privacy tab: single purpose, one justification per permission and host,
   remote code "No", the data boxes and the three certifications.
3. Privacy policy URL `https://dokhae.fr/privacy`, support email
   `contact@dokhae.fr`, website `https://dokhae.fr` (verify the domain in
   Search Console to show it as the official site).
4. Account: trader declaration (EU), since Dokhae is sold by a
   micro-entreprise; the declared address and email are shown publicly.
5. Distribution: public, all regions (or French-speaking ones first).
