// Origin of the Sori website, baked in at build time from .env (WXT_SITE_URL).
// wxt.config.ts derives the matching host permission from the same variable.
export const SITE_URL: string = String(
  import.meta.env.WXT_SITE_URL || 'http://localhost:3000'
).replace(/\/+$/, '');
