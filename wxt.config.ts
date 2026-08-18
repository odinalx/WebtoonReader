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
  const origin = new URL(url || 'http://localhost:3000').origin;

  // The origin is baked into the bundle AND into host_permissions, so a release
  // that kept the committed localhost default would ship an extension talking
  // to the user's own machine — failing silently, with no permission to reach
  // the real site. `npm run zip` sets SORI_RELEASE, so the check guards the
  // distributable without breaking `npm run build` against a local server.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);
  if (isLocal && process.env.SORI_RELEASE) {
    throw new Error(
      `WXT_SITE_URL is ${origin} but this is a release build. ` +
        'Set WXT_SITE_URL to the real site origin (https://…) and rebuild.'
    );
  }
  return origin;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Sori',
    description: 'Read Korean webtoons — capture a panel, get the words, save them to your Sori deck',
    version: '0.1.1',
    // Tesseract compiles a .wasm core; MV3's default CSP (script-src 'self')
    // blocks WebAssembly.instantiate. 'wasm-unsafe-eval' re-allows it.
    // (The sandbox entry that used to sit here existed only for Kiwi, whose
    // Emscripten glue needs 'unsafe-eval'. Segmentation now runs on the Sori
    // server, so neither the sandbox nor that CSP relaxation is needed.)
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'offscreen', 'contextMenus'],
    host_permissions: [
      // Google TTS fallback only — translation itself moved to the Sori server.
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
    ],
  },
});
