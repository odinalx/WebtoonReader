import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

// The site origin must be a compile-time host permission, and this config file
// runs before WXT exposes .env values — so read it ourselves:
// process.env → .env file → localhost fallback. Keep in sync with
// src/config.ts, which reads the same variable via import.meta.env.
function siteOrigin(): string {
  let url = process.env.WXT_SITE_URL;
  if (!url) {
    try {
      const env = readFileSync(new URL('.env', import.meta.url), 'utf8');
      url = /^WXT_SITE_URL=(.+)$/m.exec(env)?.[1]?.trim();
    } catch {
      // no .env file — use the fallback
    }
  }
  return new URL(url || 'http://localhost:3000').origin;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Webtoon Korean Reader',
    description: 'OCR + dictionary helper for Korean webtoons',
    version: '0.1.1',
    // Tesseract compiles a .wasm core; MV3's default CSP (script-src 'self')
    // blocks WebAssembly.instantiate. 'wasm-unsafe-eval' re-allows it.
    // Kiwi's Emscripten/Embind glue additionally JITs binding functions via
    // `new Function(...)`, which needs 'unsafe-eval' — forbidden on extension
    // pages but allowed on a SANDBOXED page, so Kiwi runs in kiwi-sandbox.html
    // (a static page bundled to public/ by scripts/bundle-sandbox.mjs, served
    // from the extension origin so it's identical in dev and production).
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
      sandbox:
        "sandbox allow-scripts; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'self';",
    },
    sandbox: { pages: ['kiwi-sandbox.html'] },
    permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'offscreen', 'contextMenus'],
    host_permissions: [
      'https://translate.googleapis.com/*',
      'https://translate.google.com/*',
      'https://*.apigw.ntruss.com/*',
      'https://ko.dict.naver.com/*',
      'https://dict-dn.pstatic.net/*',
      'http://127.0.0.1:8765/*',
      'http://localhost:8765/*',
      // Sori website API (account check + saving flashcards).
      `${siteOrigin()}/*`,
    ],
    web_accessible_resources: [
      {
        // Worker + core wasm must be reachable from the extension origin.
        resources: ['tesseract/*'],
        matches: ['<all_urls>'],
      },
      {
        // Kiwi wasm + model files, loaded by the offscreen document.
        resources: ['kiwi/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
