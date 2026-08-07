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

// 2. All core variants (.wasm + their .js loaders) — Tesseract auto-selects
//    the right one (simd / lstm) when corePath points at this directory.
const coreDir = resolve(root, 'node_modules/tesseract.js-core');
for (const f of readdirSync(coreDir)) {
  if (f.startsWith('tesseract-core') && (f.endsWith('.js') || f.endsWith('.wasm'))) {
    cpSync(resolve(coreDir, f), resolve(destDir, f));
  }
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
