import type {
  AnalysisResult,
  AnkiCardDraft,
  ExtensionMessage,
  FlashcardTarget,
  SelectionRect,
} from '../src/types';
import { getSettings, hasVoiceCreds } from '../src/settings';
import { clovaTts } from '../src/clova';
import { naverWordAudioUrl } from '../src/naver';
import { sendCardsToAnki } from '../src/anki';
import { analyzeOnSite, sendCardToSite, sendCardsToSite } from '../src/site';
import { getAccess, lockMessage } from '../src/access';
import { SITE_URL } from '../src/config';
import type { Settings } from '../src/types';

const OFFSCREEN_URL = 'offscreen.html';
const CAPTURE_TIMEOUT_MS = 15_000;
const OFFSCREEN_TIMEOUT_MS = 15_000;
const OCR_TIMEOUT_MS = 120_000; // best model is slower
const SEGMENT_TIMEOUT_MS = 120_000; // first call builds the Kiwi neural model (slow once)

// Push a status line to the result panel (and the background console).
function report(status: string, progress: number) {
  console.log(`[Korean Reader] ${status} (${Math.round(progress * 100)}%)`);
  chrome.runtime
    .sendMessage({ type: 'OCR_PROGRESS', status, progress } satisfies ExtensionMessage)
    .catch(() => {});
}

const CONTEXT_MENU_ID = 'wkr-analyze-selection';

export default defineBackground(() => {
  // --- Right-click "Analyze selection" entry point -------------------------
  // The item only shows when text is selected; clicking it forwards the
  // selected text to the content script, which drives the same result panel
  // as a scan (skipping capture/OCR).
  // Created hidden — the content script reveals it (SET_MENU_VISIBLE) only when
  // the current selection contains Hangul, since Chrome can't filter by content.
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Analyze with Korean Reader',
      contexts: ['selection'],
      visible: false,
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id == null) return;
    const text = (info.selectionText ?? '').trim();
    if (!text) return;
    chrome.tabs
      .sendMessage(tab.id, { type: 'ANALYZE_SELECTION', text } satisfies ExtensionMessage)
      .catch(() => {
        // Content script not injected (e.g. page loaded before the extension).
      });
  });

  browser.runtime.onMessage.addListener((msg: unknown): boolean => {
    const message = msg as ExtensionMessage;
    if (message.type !== 'SET_MENU_VISIBLE') return false;
    chrome.contextMenus.update(CONTEXT_MENU_ID, { visible: message.visible }).catch(() => {});
    return false;
  });

  // --- Paywall status for the popup / options page --------------------------
  browser.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse): boolean => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'ACCESS_CHECK') return false;

      (async () => {
        const state = await getAccess(message.force ?? false);
        sendResponse({
          type: 'ACCESS_INFO',
          ok: state.ok,
          reason: state.reason,
          email: state.email,
          plan: state.plan,
          siteUrl: SITE_URL,
        } satisfies ExtensionMessage);
      })();

      return true;
    }
  );

  browser.runtime.onMessage.addListener(
    (msg: unknown, sender, sendResponse): boolean => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'CAPTURE_REQUEST') return false;

      (async () => {
        try {
          // Paywall: scanning requires an active Sori subscription.
          const access = await getAccess();
          if (!access.ok) throw new Error(lockMessage(access));

          const windowId = sender.tab?.windowId;
          if (windowId == null) throw new Error('Could not determine the active window.');

          // --- Capture ---
          report('capturing screenshot', 0.1);
          let dataUrl: string;
          try {
            dataUrl = await withTimeout(
              browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
              CAPTURE_TIMEOUT_MS,
              'Screenshot capture timed out.'
            );
          } catch (e) {
            throw new Error(
              `Could not capture the page. Chrome blocks capture on some pages ` +
                `(chrome://, the Web Store, PDFs). Details: ${describe(e)}`
            );
          }

          // --- Crop + preprocess ---
          report('cropping image', 0.25);
          let cropped: string;
          let preprocessed: string;
          try {
            cropped = await cropImage(dataUrl, message.rect);
            preprocessed = await preprocess(cropped);
          } catch (e) {
            throw new Error(`Failed to process the captured image: ${describe(e)}`);
          }

          // --- OCR (local Tesseract) ---
          let text = '';
          try {
            text = await tesseractOcr(preprocessed);
          } catch (e) {
            console.error('[Korean Reader] OCR failed:', e);
            throw new Error(`OCR failed: ${describe(e)}`);
          }

          // --- Segmentation + translation + grammar (Sori server) ---
          report('analyzing words', 0.8);
          const analysis = await analyzeText(text);

          sendResponse({ type: 'CAPTURE_RESULT', analysis } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Korean Reader] capture pipeline failed:', e);
          sendResponse({ type: 'CAPTURE_ERROR', message: describe(e) } satisfies ExtensionMessage);
        }
      })();

      return true; // keep channel open for async sendResponse
    }
  );

  // --- Analyze selected text: same pipeline as a scan, minus capture/OCR ---
  browser.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse): boolean => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'ANALYZE_TEXT') return false;

      (async () => {
        try {
          // Paywall: text analysis requires an active Sori subscription too.
          const access = await getAccess();
          if (!access.ok) throw new Error(lockMessage(access));

          report('analyzing words', 0.8);
          const analysis = await analyzeText(message.text);

          sendResponse({ type: 'CAPTURE_RESULT', analysis } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Korean Reader] analyze-text pipeline failed:', e);
          sendResponse({ type: 'CAPTURE_ERROR', message: describe(e) } satisfies ExtensionMessage);
        }
      })();

      return true; // keep channel open for async sendResponse
    }
  );

  // --- Text-to-speech: fetch Google TTS audio, play it in the offscreen doc ---
  browser.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse): boolean => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'TTS_REQUEST') return false;

      (async () => {
        try {
          const settings = await getSettings();
          const audioDataUrl = await resolveTtsAudio(message.text, settings);
          await ensureOffscreen();
          await chrome.runtime.sendMessage({
            type: 'TTS_PLAY',
            target: 'offscreen',
            audioDataUrl,
          } satisfies ExtensionMessage);
          sendResponse({ type: 'TTS_DONE', ok: true } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Korean Reader] TTS failed:', e);
          sendResponse({ type: 'TTS_DONE', ok: false, message: describe(e) } satisfies ExtensionMessage);
        }
      })();

      return true;
    }
  );

  // --- Anki card queue (session list) + AnkiConnect delivery ---
  browser.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse): boolean => {
      const message = msg as ExtensionMessage;
      if (
        message.type !== 'ANKI_ADD' &&
        message.type !== 'ANKI_SEND_ALL' &&
        message.type !== 'ANKI_QUEUE' &&
        message.type !== 'ANKI_CLEAR'
      ) {
        return false;
      }

      (async () => {
        // Fallback for error responses if reading settings itself fails.
        let target: FlashcardTarget = 'site';
        try {
          const settings = await getSettings();
          target = settings.flashcardTarget;

          if (message.type === 'ANKI_QUEUE') {
            const queue = await getQueue();
            sendResponse({
              type: 'ANKI_QUEUE_INFO',
              count: queue.length,
              autoSend: settings.ankiAutoSend,
              target,
            } satisfies ExtensionMessage);
            return;
          }

          if (message.type === 'ANKI_CLEAR') {
            await setQueue([]);
            sendResponse({ type: 'ANKI_CLEAR_DONE', ok: true } satisfies ExtensionMessage);
            return;
          }

          if (message.type === 'ANKI_ADD') {
            const card: AnkiCardDraft = {
              ...message.card,
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              addedAt: Date.now(),
            };

            // Website destination (default): save straight to the Sori deck.
            // On failure the card stays in the queue so it's never lost.
            if (target === 'site') {
              try {
                const access = await getAccess();
                if (!access.ok) throw new Error(lockMessage(access));
                await sendCardToSite(settings.siteToken.trim(), card);
                sendResponse({
                  type: 'ANKI_ADD_DONE', ok: true, queued: (await getQueue()).length,
                  sentNow: true, target,
                } satisfies ExtensionMessage);
              } catch (e) {
                const queue = [...(await getQueue()), card];
                await setQueue(queue);
                sendResponse({
                  type: 'ANKI_ADD_DONE', ok: false, queued: queue.length, sentNow: false,
                  target, message: `Kept in queue — saving to Sori failed: ${describe(e)}`,
                } satisfies ExtensionMessage);
              }
              return;
            }

            // Anki auto-send mode: push straight into Anki; if that fails,
            // keep the card in the queue so it's never lost.
            if (settings.ankiAutoSend) {
              try {
                const r = await sendCardsToAnki(settings, [card], (t) => audioOrNull(t, settings));
                if (r.addedIds.length > 0) {
                  const queue = await getQueue();
                  sendResponse({
                    type: 'ANKI_ADD_DONE', ok: true, queued: queue.length, sentNow: true, target,
                  } satisfies ExtensionMessage);
                  return;
                }
                throw new Error(r.failures[0] || 'Anki did not accept the card');
              } catch (e) {
                const queue = [...(await getQueue()), card];
                await setQueue(queue);
                sendResponse({
                  type: 'ANKI_ADD_DONE', ok: false, queued: queue.length, sentNow: false,
                  target, message: `Kept in queue — Anki send failed: ${describe(e)}`,
                } satisfies ExtensionMessage);
                return;
              }
            }

            const queue = [...(await getQueue()), card];
            await setQueue(queue);
            sendResponse({
              type: 'ANKI_ADD_DONE', ok: true, queued: queue.length, sentNow: false, target,
            } satisfies ExtensionMessage);
            return;
          }

          // ANKI_SEND_ALL — flush the queue to the configured destination.
          const queue = await getQueue();
          if (queue.length === 0) {
            sendResponse({
              type: 'ANKI_SEND_ALL_DONE', ok: true, added: 0, failed: 0, remaining: 0, target,
            } satisfies ExtensionMessage);
            return;
          }
          if (target === 'site') {
            const access = await getAccess();
            if (!access.ok) throw new Error(lockMessage(access));
          }
          const result =
            target === 'site'
              ? await sendCardsToSite(settings.siteToken.trim(), queue)
              : await sendCardsToAnki(settings, queue, (t) => audioOrNull(t, settings));
          const remaining = queue.filter((c) => !result.addedIds.includes(c.id));
          await setQueue(remaining);
          sendResponse({
            type: 'ANKI_SEND_ALL_DONE',
            ok: result.failed === 0,
            added: result.addedIds.length,
            failed: result.failed,
            remaining: remaining.length,
            target,
            message: result.failures[0],
          } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Korean Reader] flashcard op failed:', e);
          if (message.type === 'ANKI_SEND_ALL') {
            const queue = await getQueue();
            sendResponse({
              type: 'ANKI_SEND_ALL_DONE', ok: false, added: 0, failed: queue.length,
              remaining: queue.length, target, message: describe(e),
            } satisfies ExtensionMessage);
          } else if (message.type === 'ANKI_ADD') {
            sendResponse({
              type: 'ANKI_ADD_DONE', ok: false, queued: (await getQueue()).length,
              sentNow: false, target, message: describe(e),
            } satisfies ExtensionMessage);
          } else if (message.type === 'ANKI_CLEAR') {
            sendResponse({ type: 'ANKI_CLEAR_DONE', ok: false } satisfies ExtensionMessage);
          } else {
            sendResponse({
              type: 'ANKI_QUEUE_INFO', count: 0, autoSend: false, target,
            } satisfies ExtensionMessage);
          }
        }
      })();

      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Anki queue persistence
// ---------------------------------------------------------------------------

const ANKI_QUEUE_KEY = 'ankiQueue';

async function getQueue(): Promise<AnkiCardDraft[]> {
  const stored = await chrome.storage.local.get(ANKI_QUEUE_KEY);
  return (stored[ANKI_QUEUE_KEY] as AnkiCardDraft[] | undefined) ?? [];
}

async function setQueue(queue: AnkiCardDraft[]): Promise<void> {
  await chrome.storage.local.set({ [ANKI_QUEUE_KEY]: queue });
}

// resolveTtsAudio wrapper that never throws — returns null when no audio.
async function audioOrNull(text: string, settings: Settings): Promise<string | null> {
  try {
    return await resolveTtsAudio(text, settings);
  } catch (e) {
    console.warn('[Korean Reader] audio for Anki card failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local OCR (Tesseract in the offscreen document)
// ---------------------------------------------------------------------------

async function tesseractOcr(preprocessed: string): Promise<string> {
  report('starting OCR engine', 0.35);
  await withTimeout(ensureOffscreen(), OFFSCREEN_TIMEOUT_MS, 'Starting the OCR engine timed out.');

  report('sending to OCR engine', 0.4);
  const ocr = (await withTimeout(
    chrome.runtime.sendMessage({
      type: 'OCR_REQUEST',
      target: 'offscreen',
      imageDataUrl: preprocessed,
    } satisfies ExtensionMessage),
    OCR_TIMEOUT_MS,
    'OCR timed out. Try a smaller / tighter crop.'
  )) as ExtensionMessage | undefined;

  if (!ocr) throw new Error('OCR engine did not respond (offscreen document not ready).');
  if (ocr.type === 'OCR_ERROR') throw new Error(ocr.message);
  return ocr.type === 'OCR_RESULT' ? ocr.text : '';
}

/**
 * Segment + translate + tag Korean text on the Sori server.
 *
 * This used to run entirely in-page: Kiwi's wasm in a sandboxed iframe (its
 * Emscripten glue needs `unsafe-eval`, which only a sandboxed page's CSP may
 * grant) driven from the offscreen document, with the model bytes transferred
 * in over postMessage. All of that — and the ~84 MB model shipped inside every
 * install — is now one HTTP call, shared with the mobile app.
 *
 * OCR stays local: it's free, works offline, and Tesseract handles the crisp
 * rendered text of a webtoon panel well.
 *
 * Empty text short-circuits, and a failed call degrades to showing the
 * recognised text with no analysis, exactly as the local path used to.
 */
async function analyzeText(raw: string): Promise<AnalysisResult> {
  const empty = { text: '', sentenceTranslation: '', tone: '', words: [] };
  if (!raw?.trim()) return empty;

  const { siteToken } = await getSettings();
  if (!siteToken) return { ...empty, text: raw };

  report('translating', 0.85);
  try {
    return await analyzeOnSite(siteToken, raw);
  } catch (e) {
    console.error('[Korean Reader] analysis failed:', e);
    return { ...empty, text: raw };
  }
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

// Pick the best available voice:
//   1. Naver dictionary pronunciation (free, natural) — single dictionary words
//   2. Clova Voice (paid, if keys configured)
//   3. Google TTS (free, simple) — always works as a fallback
async function resolveTtsAudio(text: string, settings: Settings): Promise<string> {
  const word = text.trim();

  if (!/\s/.test(word)) {
    try {
      const naverUrl = await naverWordAudioUrl(word);
      if (naverUrl) return await fetchAudioAsDataUrl(naverUrl);
    } catch (e) {
      console.warn('[Korean Reader] Naver dict audio failed:', e);
    }
  }

  if (hasVoiceCreds(settings)) {
    try {
      return await clovaTts(text, settings);
    } catch (e) {
      console.warn('[Korean Reader] Clova Voice failed, falling back to Google TTS:', e);
    }
  }

  return fetchTts(text);
}

async function fetchAudioAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);
  return blobToDataUrl(await res.blob());
}

async function fetchTts(text: string): Promise<string> {
  const clean = text.trim().slice(0, 200);
  const ttsUrl =
    `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ko` +
    `&q=${encodeURIComponent(clean)}&textlen=${clean.length}`;
  const res = await fetch(ttsUrl);
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  return blobToDataUrl(await res.blob());
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------

let creating: Promise<void> | null = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  if (creating) {
    await creating;
    return;
  }

  try {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS', 'AUDIO_PLAYBACK'] as chrome.offscreen.Reason[],
      justification: 'Run Tesseract OCR in a Web Worker and play pronunciation audio.',
    });
    await creating;
  } catch (e) {
    // A concurrent scan may have created it already; that specific error is benign.
    if (!String(e).includes('Only a single offscreen document')) {
      throw new Error(`Could not start the OCR engine: ${describe(e)}`);
    }
  } finally {
    creating = null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

async function cropImage(dataUrl: string, rect: SelectionRect): Promise<string> {
  const dpr = rect.devicePixelRatio;
  const x = Math.round(rect.x * dpr);
  const y = Math.round(rect.y * dpr);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));

  const bitmap = await dataUrlToBitmap(dataUrl);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

async function preprocess(dataUrl: string): Promise<string> {
  const bitmap = await dataUrlToBitmap(dataUrl);
  const scale = bitmap.width < 400 ? 2 : 1;
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.min(255, Math.max(0, (g - 128) * 1.4 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const arr = new Uint8Array(buf);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, Math.min(i + chunk, arr.length)));
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,` + btoa(bin);
}
