// Compile-time flags set by `vite.define` in wxt.config.ts.

/**
 * True in SORI_SCREENSHOTS builds (the site's scripts/screenshots/shoot.mjs):
 * the content script is declared on <all_urls> and the panel's shadow root
 * stays open, so automation can reach both.
 */
declare const __SORI_SCREENSHOTS__: boolean;
