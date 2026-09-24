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

// Below this confidence (0–100) a token is treated as noise, but only when it
// carries no Hangul. Bubble outlines and tails come back as low-confidence
// quotes, dots and tildes; real syllables often do too (체 at 3, 너 at 47 on a
// bold webtoon font) and dropping those cut words in half ("너대체" → "대").
// A doubtful syllable is still better than a missing one: the server's
// segmenter and translator read it in context.
const MIN_NOISE_CONFIDENCE = 50;
const HANGUL = /[\uac00-\ud7a3]/;

interface OcrWord {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; x1: number; y0: number; y1: number };
}

// Rebuild the text line by line from Tesseract's words. Tesseract often
// reports each syllable of a bold line as its own "word", so words are joined
// with a space only where the image shows a real gap (more than a third of
// the line height), not after every token.
function confidentText(data: { text?: string; blocks?: unknown }): string {
  const blocks = data?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return (data?.text ?? '').trim();
  const lines: string[] = [];
  for (const block of blocks as any[]) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        const words = ((line?.words ?? []) as OcrWord[]).filter((w) => {
          const t = String(w?.text ?? '').trim();
          if (!t) return false;
          return HANGUL.test(t) || (w.confidence ?? 0) >= MIN_NOISE_CONFIDENCE;
        });
        let out = '';
        let prev: OcrWord | null = null;
        for (const w of words) {
          const t = String(w.text).trim();
          if (prev?.bbox && w.bbox) {
            const height = Math.max(1, w.bbox.y1 - w.bbox.y0);
            out += w.bbox.x0 - prev.bbox.x1 > height / 3 ? ' ' : '';
          } else if (prev) {
            out += ' ';
          }
          out += t;
          prev = w;
        }
        if (out) lines.push(out);
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
