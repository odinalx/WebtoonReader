import { createWorker, PSM, type Worker as TesseractWorker } from 'tesseract.js';
import type { ExtensionMessage } from '../../src/types';
import { confidentText } from '../../src/ocrText';

// Runs in the extension's own origin (chrome-extension://), so constructing the
// Tesseract Worker and importing the local core wasm are both same-origin → allowed.

let workerPromise: Promise<TesseractWorker> | null = null;

// Scans waiting on the engine. Loading progress is only relayed while one is,
// so a warm-up started when the overlay opens doesn't overwrite the results
// of the previous scan still shown in the panel.
let pendingScans = 0;

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

// Tesseract's logger speaks English; the panel shows these lines as is.
const STATUS_FR: Record<string, string> = {
  'loading tesseract core': 'chargement du moteur de lecture',
  'initializing tesseract': 'démarrage du moteur de lecture',
  'initialized tesseract': 'démarrage du moteur de lecture',
  'loading language traineddata': 'chargement du modèle coréen',
  'loading language traineddata (from cache)': 'chargement du modèle coréen',
  'loaded language traineddata': 'chargement du modèle coréen',
  'initializing api': 'préparation de la lecture',
  'initialized api': 'préparation de la lecture',
  'recognizing text': 'lecture du texte',
};

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
      if (pendingScans > 0 && m && typeof m.progress === 'number') {
        reportProgress(STATUS_FR[m.status] ?? 'lecture du texte', m.progress);
      }
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
      throw new Error(`Le moteur de lecture n'a pas pu démarrer\u00a0: ${describe(e)}`);
    });
  return workerPromise;
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse): boolean => {
  const message = msg as ExtensionMessage;

  if (message.type === 'OCR_REQUEST' && message.target === 'offscreen') {
    (async () => {
      pendingScans++;
      try {
        const worker = await getWorker();
        reportProgress('lecture du texte', 0);
        const { data } = await worker.recognize(message.imageDataUrl);
        const { text, uncertain } = confidentText(data);
        sendResponse({ type: 'OCR_RESULT', text, uncertain } satisfies ExtensionMessage);
      } catch (e) {
        sendResponse({ type: 'OCR_ERROR', message: describe(e) } satisfies ExtensionMessage);
      } finally {
        pendingScans--;
      }
    })();
    return true; // async sendResponse
  }

  if (message.type === 'OCR_WARM' && message.target === 'offscreen') {
    // A failure resets workerPromise; the scan itself will retry and report it.
    getWorker().catch((e) => console.warn('[Dokhae] OCR warm-up failed:', e));
    return false;
  }

  if (message.type === 'TTS_PLAY' && message.target === 'offscreen') {
    const audio = new Audio(message.audioDataUrl);
    audio.play().catch((e) => console.error('[Dokhae] audio play failed:', e));
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
