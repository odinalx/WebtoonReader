import { createWorker, PSM, type Worker as TesseractWorker } from 'tesseract.js';
import type { ExtensionMessage } from '../../src/types';

// Runs in the extension's own origin (chrome-extension://), so constructing the
// Tesseract Worker and importing the local core wasm are both same-origin → allowed.

let workerPromise: Promise<TesseractWorker> | null = null;

// Restrict the recognizer to Hangul syllables + the punctuation/digits we
// actually keep, so it can't hallucinate stray Latin letters or symbols out of
// bubble artwork. Standalone compatibility jamo (ㄱ–ㅎ, ㅏ–ㅣ) are deliberately
// excluded — they're almost always OCR noise. The LSTM engine honours
// tessedit_char_whitelist since Tesseract 4.1.
const HANGUL_WHITELIST = (() => {
  let s = '';
  for (let c = 0xac00; c <= 0xd7a3; c++) s += String.fromCharCode(c);
  return s + '0123456789 .,!?~·…"\'';
})();

// Words the recognizer reports below this confidence (0–100) are dropped rather
// than displayed — bubble-outline hallucinations come back with low confidence.
const MIN_WORD_CONFIDENCE = 50;

// Rebuild the recognized text from per-word data, keeping only confident words
// and preserving line structure. Falls back to the raw text if the structured
// block output is unavailable.
function confidentText(data: { text?: string; blocks?: unknown }): string {
  const blocks = data?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return (data?.text ?? '').trim();
  const lines: string[] = [];
  for (const block of blocks as any[]) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        const kept = (line?.words ?? [])
          .filter((w: any) => typeof w?.confidence === 'number' && w.confidence >= MIN_WORD_CONFIDENCE)
          .map((w: any) => String(w?.text ?? '').trim())
          .filter(Boolean);
        if (kept.length) lines.push(kept.join(' '));
      }
    }
  }
  return lines.join('\n').trim();
}

function reportProgress(status: string, progress: number) {
  // Fire-and-forget; ignore "no receiver" errors when no panel is listening.
  chrome.runtime
    .sendMessage({ type: 'OCR_PROGRESS', status, progress } satisfies ExtensionMessage)
    .catch(() => {});
}

function getWorker(): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  workerPromise = createWorker('kor', 1, {
    // Load the worker directly as an extension-origin Worker (no blob bootstrap).
    workerBlobURL: false,
    workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
    // Directory (NO trailing slash): Tesseract joins with `/tesseract-core…`.
    // langPath joins as `${langPath}/kor.traineddata.gz` WITHOUT stripping a
    // trailing slash, so a trailing slash here would 404 (double slash).
    corePath: chrome.runtime.getURL('tesseract').replace(/\/$/, ''),
    // Local language data (bundled) — no network round-trip on first scan.
    langPath: chrome.runtime.getURL('tesseract').replace(/\/$/, ''),
    logger: (m) => {
      if (m && typeof m.progress === 'number') reportProgress(m.status, m.progress);
    },
  })
    .then(async (worker) => {
      // A cropped speech bubble is one uniform block of text, so tell Tesseract
      // not to run full page-layout analysis (which invents structure — and
      // glyphs — on small noisy crops). Whitelist keeps output to Hangul.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: HANGUL_WHITELIST,
        preserve_interword_spaces: '1',
      });
      return worker;
    })
    .catch((e) => {
      // Reset so a later scan can retry worker creation instead of being stuck
      // on a permanently-rejected promise.
      workerPromise = null;
      throw new Error(`Failed to initialize OCR engine: ${describe(e)}`);
    });
  return workerPromise;
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse): boolean => {
  const message = msg as ExtensionMessage;

  if (message.type === 'OCR_REQUEST' && message.target === 'offscreen') {
    (async () => {
      try {
        const worker = await getWorker();
        reportProgress('recognizing text', 0);
        const { data } = await worker.recognize(message.imageDataUrl);
        sendResponse({ type: 'OCR_RESULT', text: confidentText(data) } satisfies ExtensionMessage);
      } catch (e) {
        sendResponse({ type: 'OCR_ERROR', message: describe(e) } satisfies ExtensionMessage);
      }
    })();
    return true; // async sendResponse
  }

  if (message.type === 'TTS_PLAY' && message.target === 'offscreen') {
    const audio = new Audio(message.audioDataUrl);
    audio.play().catch((e) => console.error('[Sori] audio play failed:', e));
    return false;
  }

  return false;
});

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
