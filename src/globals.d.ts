// Compile-time flags set by `vite.define` in wxt.config.ts.

/**
 * True in SORI_SCREENSHOTS builds (the site's scripts/screenshots/shoot.mjs):
 * the content script is declared on <all_urls> and the panel's shadow root
 * stays open, so automation can reach both.
 */
declare const __SORI_SCREENSHOTS__: boolean;

/**
 * Origin of the Dokhae site (from WXT_SITE_URL), for manifest-time values such
 * as a content script's match pattern. Runtime code reads src/config.ts.
 */
declare const __DOKHAE_SITE_ORIGIN__: string;
