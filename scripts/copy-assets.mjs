/**
 * Copies Tesseract.js worker + core wasm files into public/tesseract/ so they
 * are bundled into the extension and loaded from the extension's own origin
 * (required — a content script's page origin cannot construct an extension Worker,
 * and strict site CSPs block remote core scripts).
 * Runs automatically via "postinstall" in package.json.
 */
import { cpSync, mkdirSync, readdirSync, existsSync, writeFileSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = resolve(root, 'public/tesseract');
mkdirSync(destDir, { recursive: true });

// 1. Worker script
cpSync(
  resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'),
  resolve(destDir, 'worker.min.js')
);

// 2. Core. tesseract.js 5 imports a single self-contained `*.wasm.js` (the
//    wasm is inlined as base64), picked by getCore.js: the worker runs with
//    OEM 1 (LSTM only), so it loads the SIMD LSTM build, or the plain LSTM
//    build on a CPU without SIMD. The bare .wasm files, the non-LSTM builds
//    and the `tesseract-core*.js` loaders are never requested: leaving them
//    out saves about 25 MB unpacked.
const CORES = ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'];
const coreDir = resolve(root, 'node_modules/tesseract.js-core');
for (const f of CORES) cpSync(resolve(coreDir, f), resolve(destDir, f));
// Drop files earlier versions of this script copied.
const keep = new Set(['worker.min.js', 'kor.traineddata.gz', ...CORES]);
for (const f of readdirSync(destDir)) {
  if (!keep.has(f)) rmSync(resolve(destDir, f), { force: true });
}

// 3. Korean language data (BEST model, ~15 MB — most accurate) bundled locally
//    at setup so scans need no network round-trip. Downloaded once, then cached
//    in the repo's (gitignored) public/ dir.
//    Override the variant with TESS_MODEL=4.0.0_fast for a faster/smaller model.
const variant = process.env.TESS_MODEL || '4.0.0_best';
const langFile = resolve(destDir, 'kor.traineddata.gz');
if (!existsSync(langFile)) {
  const url = `https://tessdata.projectnaptha.com/${variant}/kor.traineddata.gz`;
  console.log(`↓ Downloading kor.traineddata.gz (${variant}) — this is a one-time setup step …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download lang data: HTTP ${res.status}`);
  writeFileSync(langFile, Buffer.from(await res.arrayBuffer()));
}

console.log('✓ Copied tesseract worker + core + kor lang data into public/tesseract/');

// ---------------------------------------------------------------------------
// Kiwi (Korean morphological analyzer) — wasm + model, run in the offscreen doc
