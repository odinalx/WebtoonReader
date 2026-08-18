import type { ExtensionMessage, SelectionRect, AnalysisResult, WordInfo } from '../src/types';
import { romanize } from '../src/romanize';

let scanActive = false;
let activePanel: ShadowRoot | null = null;
let currentAnalysis: AnalysisResult | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const message = msg as ExtensionMessage;
      if (message.type === 'ACTIVATE_SCAN' && !scanActive) {
        activateScan();
      } else if (message.type === 'ANALYZE_SELECTION') {
        runAnalyzeText(message.text);
      } else if (message.type === 'OCR_PROGRESS' && activePanel) {
        setPanelProgress(activePanel, message.status, message.progress);
      }
    });

    watchSelectionForMenu();
  },
});

// ---------------------------------------------------------------------------
// SVG icons (no emoji)
// ---------------------------------------------------------------------------

const ICON = {
  book: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M9 3v16"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" fill="currentColor"/></svg>`,
  external: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h2l1.5-2h7L19 5h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="13" cy="12" r="3.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 9v6M9 12h6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>`,
};

// ---------------------------------------------------------------------------
// Part-of-speech → color (for word coloring)
// ---------------------------------------------------------------------------

function posColor(pos: string): string {
  switch (pos) {
    case 'noun': return '#4dabf7';        // blue
    case 'verb': return '#ff6b6b';        // red
    case 'adjective': return '#51cf66';   // green
    case 'adverb': return '#ffa94d';      // orange
    case 'pronoun': return '#845ef7';     // indigo
    case 'numeral': return '#20c997';     // teal
    case 'particle': return '#f783ac';    // pink
    case 'conjunction': return '#fcc419'; // gold
    case 'interjection': return '#ff922b';// deep orange
    case 'determiner': return '#94d82d';  // lime
    default: return '#adb5bd';            // neutral grey — word not classified
  }
}

// ---------------------------------------------------------------------------
// Context-menu visibility — only offer "Analyze selection" for Korean text
// ---------------------------------------------------------------------------

// Hangul syllables + compatibility/conjoining Jamo.
const HANGUL_RE = /[가-힣㄰-㆏ᄀ-ᇿ]/;

function watchSelectionForMenu() {
  let lastVisible: boolean | null = null;
  let timer: number | undefined;

  const sync = () => {
    const sel = window.getSelection()?.toString() ?? '';
    const visible = HANGUL_RE.test(sel);
    if (visible === lastVisible) return; // only message background on change
    lastVisible = visible;
    browser.runtime
      .sendMessage({ type: 'SET_MENU_VISIBLE', visible } satisfies ExtensionMessage)
      .catch(() => {});
  };

  // selectionchange fires rapidly while drag-selecting — debounce it.
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = window.setTimeout(sync, 150);
  });
}

// ---------------------------------------------------------------------------
// Capture overlay
// ---------------------------------------------------------------------------

function activateScan() {
  scanActive = true;

  const overlay = el('div', {
    position: 'fixed', top: '0', left: '0',
    width: '100vw', height: '100vh',
    background: 'rgba(0,0,0,0.45)',
    zIndex: '2147483645',
    cursor: 'crosshair',
    userSelect: 'none',
    touchAction: 'none',
  });

  const hint = el('div', {
    position: 'fixed', top: '16px', left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)', color: '#fff',
    padding: '8px 16px', borderRadius: '8px',
    fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    pointerEvents: 'none', zIndex: '2147483647',
    whiteSpace: 'nowrap',
  });
  hint.textContent = 'Drag to select a speech bubble — ESC to cancel';

  const selBox = el('div', {
    position: 'fixed', display: 'none',
    border: '1.5px solid #00c73c', background: 'rgba(0,199,60,0.10)',
    zIndex: '2147483646', pointerEvents: 'none', boxSizing: 'border-box',
  });

  document.body.append(hint, selBox, overlay);

  // Lock page scroll while selecting.
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  const blockScroll = (e: Event) => e.preventDefault();
  overlay.addEventListener('wheel', blockScroll, { passive: false });
  overlay.addEventListener('touchmove', blockScroll, { passive: false });

  let startX = 0, startY = 0, dragging = false;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    Object.assign(selBox.style, { left: `${startX}px`, top: `${startY}px`, width: '0', height: '0', display: 'block' });
    e.preventDefault();
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    Object.assign(selBox.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${Math.abs(e.clientX - startX)}px`,
      height: `${Math.abs(e.clientY - startY)}px`,
    });
  };

  const cleanup = () => {
    scanActive = false;
    document.documentElement.style.overflow = prevOverflow;
    overlay.removeEventListener('mousedown', onDown);
    overlay.removeEventListener('wheel', blockScroll);
    overlay.removeEventListener('touchmove', blockScroll);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onKey);
    overlay.remove(); hint.remove(); selBox.remove();
  };

  const onUp = async (e: MouseEvent) => {
    if (!dragging) return;
    dragging = false;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 10 || h < 10) { cleanup(); return; }
    cleanup();

    runCapture({ x, y, width: w, height: h, devicePixelRatio: window.devicePixelRatio || 1 });
  };

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

  overlay.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keydown', onKey);
}

// ---------------------------------------------------------------------------
// Capture -> OCR -> render (with retry)
// ---------------------------------------------------------------------------

async function runCapture(rect: SelectionRect) {
  const panel = createPanel();
  activePanel = panel;
  setPanelStatus(panel, 'Capturing…');

  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'CAPTURE_REQUEST',
      rect,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;

    if (!resp) {
      setPanelError(panel, 'No response from the extension. Try reloading the page.', () => runCapture(rect));
      return;
    }
    if (resp.type === 'CAPTURE_ERROR') { setPanelError(panel, resp.message, () => runCapture(rect)); return; }
    if (resp.type !== 'CAPTURE_RESULT') return;

    renderResults(panel, resp.analysis);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes('message channel closed') || msg.includes('Extension context invalidated')) {
      setPanelError(panel, 'Extension was reloaded. Refresh the page and try again.', () => runCapture(rect));
    } else {
      setPanelError(panel, msg, () => runCapture(rect));
    }
  }
}

// ---------------------------------------------------------------------------
// Selected text -> analyze -> render (parallels runCapture, minus capture/OCR)
// ---------------------------------------------------------------------------

async function runAnalyzeText(text: string) {
  const clean = text.trim();
  if (!clean) return;

  const panel = createPanel();
  activePanel = panel;
  setPanelStatus(panel, 'Analyzing…');

  const retry = () => runAnalyzeText(clean);
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'ANALYZE_TEXT',
      text: clean,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;

    if (!resp) {
      setPanelError(panel, 'No response from the extension. Try reloading the page.', retry);
      return;
    }
    if (resp.type === 'CAPTURE_ERROR') { setPanelError(panel, resp.message, retry); return; }
    if (resp.type !== 'CAPTURE_RESULT') return;

    renderResults(panel, resp.analysis);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes('message channel closed') || msg.includes('Extension context invalidated')) {
      setPanelError(panel, 'Extension was reloaded. Refresh the page and try again.', retry);
    } else {
      setPanelError(panel, msg, retry);
    }
  }
}

// ---------------------------------------------------------------------------
// Result panel (Shadow DOM for style isolation)
// ---------------------------------------------------------------------------

function createPanel(): ShadowRoot {
  document.getElementById('wkr-host')?.remove();

  const host = document.createElement('div');
  host.id = 'wkr-host';
  Object.assign(host.style, {
    position: 'fixed', top: '16px', right: '16px',
    width: '340px', zIndex: '2147483647',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  shadow.appendChild(styleEl);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="header">
      <span class="title">${ICON.book}<span>Sori</span></span>
      <button class="close" title="Close">${ICON.close}</button>
    </div>
    <div class="body"><div class="status">Capturing…</div></div>
  `;
  shadow.appendChild(panel);

  shadow.querySelector('.close')!.addEventListener('click', () => {
    if (activePanel === shadow) activePanel = null;
    host.remove();
  });
  makeDraggable(host, shadow.querySelector('.header') as HTMLElement);

  return shadow;
}

function setPanelStatus(shadow: ShadowRoot, msg: string) {
  (shadow.querySelector('.body') as HTMLElement).innerHTML =
    `<div class="status">${esc(msg)}</div>`;
}

function setPanelProgress(shadow: ShadowRoot, status: string, progress: number) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  (shadow.querySelector('.body') as HTMLElement).innerHTML = `
    <div class="status">${esc(status)}…</div>
    <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="progress-pct">${pct}%</div>
  `;
}

function setPanelError(shadow: ShadowRoot, msg: string, onRetry?: () => void) {
  const body = shadow.querySelector('.body') as HTMLElement;
  body.innerHTML = `
    <div class="error">${esc(msg)}</div>
    ${onRetry ? `<button class="btn-primary retry">${ICON.refresh}<span>Try again</span></button>` : ''}
  `;
  if (onRetry) {
    body.querySelector('.retry')!.addEventListener('click', onRetry);
  }
}

function renderResults(shadow: ShadowRoot, analysis: AnalysisResult) {
  const body = shadow.querySelector('.body') as HTMLElement;
  currentAnalysis = analysis;

  if (!analysis.text) {
    body.innerHTML = `
      <div class="status">No text detected. Try a cleaner crop.</div>
      <button class="btn-primary scan-again">${ICON.camera}<span>Scan other</span></button>`;
    body.querySelector('.scan-again')!.addEventListener('click', () => activateScan());
    return;
  }

  body.innerHTML = `
    <div class="phrase-row">
      <div class="phrase"></div>
      <button class="speak-all" title="Speak phrase">${ICON.speaker}</button>
    </div>
    <button class="btn-row toggle-tr">
      ${ICON.eye}<span class="toggle-label">Show translation</span>
    </button>
    <div class="translation hidden">
      ${analysis.sentenceTranslation
        ? esc(analysis.sentenceTranslation)
        : '<span class="muted">(translation unavailable)</span>'}
      ${analysis.tone ? `<div class="tone">tone: ${esc(analysis.tone)}</div>` : ''}
    </div>
    <button class="btn-row scan-again">${ICON.camera}<span>Scan other</span></button>
    <div class="legend"></div>
    <div class="anki-bar"></div>
  `;

  // Flowing Korean phrase — each word is marked with POS-colored dots
  // underneath (not recolored text) and highlights on click.
  const phraseEl = body.querySelector('.phrase') as HTMLElement;
  analysis.words.forEach((info, i) => {
    const color = posColor(info.pos);
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = info.surface;
    w.style.setProperty('--c', color);            // dot color
    w.style.setProperty('--c-soft', hexA(color, 0.18)); // active highlight bg
    w.addEventListener('click', () => {
      phraseEl.querySelectorAll('.w.active').forEach((e) => e.classList.remove('active'));
      w.classList.add('active');
      showWordPopover(shadow, w, info);
    });
    phraseEl.appendChild(w);
    if (i < analysis.words.length - 1) phraseEl.appendChild(document.createTextNode(' '));
  });

  // Show / hide translation toggle.
  const tr = body.querySelector('.translation') as HTMLElement;
  const toggle = body.querySelector('.toggle-tr') as HTMLElement;
  const label = body.querySelector('.toggle-label') as HTMLElement;
  toggle.addEventListener('click', () => {
    const hidden = tr.classList.toggle('hidden');
    label.textContent = hidden ? 'Show translation' : 'Hide translation';
  });

  body.querySelector('.speak-all')!.addEventListener('click', () => tts(analysis.text));
  body.querySelector('.scan-again')!.addEventListener('click', () => activateScan());

  // Legend of the parts of speech actually present.
  const present = [...new Set(analysis.words.map((w) => w.pos || 'other'))];
  const legend = body.querySelector('.legend') as HTMLElement;
  legend.innerHTML = present
    .map((p) => {
      const c = posColor(p === 'other' ? '' : p);
      return `<span class="legend-item"><span class="dot" style="background:${c}"></span>${esc(p)}</span>`;
    })
    .join('');

  void updateAnkiBar(shadow);
}

// ---------------------------------------------------------------------------
// Flashcard queue UI (footer bar of the result panel)
// ---------------------------------------------------------------------------

// Human name of the current destination ('site' → Sori, 'anki' → Anki).
function targetName(target: string | undefined): string {
  return target === 'anki' ? 'Anki' : 'Sori';
}

async function updateAnkiBar(shadow: ShadowRoot) {
  const bar = shadow.querySelector('.anki-bar') as HTMLElement | null;
  if (!bar) return;

  let count = 0;
  let target: string | undefined;
  try {
    const info = (await browser.runtime.sendMessage({
      type: 'ANKI_QUEUE',
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    if (info && info.type === 'ANKI_QUEUE_INFO') {
      count = info.count;
      target = info.target;
    }
  } catch {
    /* background not ready — show empty bar */
  }

  if (count === 0) {
    bar.innerHTML = `<span class="anki-count muted">No cards queued yet</span>`;
    return;
  }

  bar.innerHTML = `
    <span class="anki-count">${count} card${count > 1 ? 's' : ''} queued</span>
    <div class="anki-actions">
      <button class="btn-row anki-send">${ICON.send}<span>Send all to ${targetName(target)}</span></button>
      <button class="anki-clear" title="Clear queue">${ICON.close}</button>
    </div>`;
  bar.querySelector('.anki-send')!.addEventListener('click', () => sendAllCards(shadow));
  bar.querySelector('.anki-clear')!.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'ANKI_CLEAR' } satisfies ExtensionMessage).catch(() => {});
    void updateAnkiBar(shadow);
  });
}

async function sendAllCards(shadow: ShadowRoot) {
  const bar = shadow.querySelector('.anki-bar') as HTMLElement | null;
  if (!bar) return;
  bar.innerHTML = `<span class="anki-count muted">Sending…</span>`;

  let resp: ExtensionMessage | undefined;
  try {
    resp = (await browser.runtime.sendMessage({
      type: 'ANKI_SEND_ALL',
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
  } catch {
    resp = undefined;
  }

  if (!resp || resp.type !== 'ANKI_SEND_ALL_DONE') {
    bar.innerHTML = `<span class="anki-count warn">Could not reach the extension. Try again.</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 2500);
    return;
  }

  const dest = targetName(resp.target);
  if (resp.ok && resp.failed === 0) {
    bar.innerHTML = `<span class="anki-count ok">✓ Sent ${resp.added} card${resp.added > 1 ? 's' : ''} to ${dest}</span>`;
  } else if (resp.added > 0) {
    bar.innerHTML = `<span class="anki-count warn">Sent ${resp.added}, ${resp.failed} failed — ${resp.remaining} still queued.</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 3000);
  } else {
    const why =
      resp.message ||
      (resp.target === 'anki'
        ? 'Could not reach Anki. Open it with the AnkiConnect add-on.'
        : 'Could not reach Sori. Check your connection and token.');
    bar.innerHTML = `<span class="anki-count warn">${esc(why)}</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 4000);
  }
}

// ---------------------------------------------------------------------------
// Word detail popover
// ---------------------------------------------------------------------------

function showWordPopover(shadow: ShadowRoot, anchor: HTMLElement, info: WordInfo) {
  shadow.querySelector('.popover')?.remove();

  const color = posColor(info.pos);
  const dictForm = info.infinitive || info.base;
  const sentence = currentAnalysis?.text || '';
  const sentenceTr = currentAnalysis?.sentenceTranslation || '';
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = `
    <div class="pop-head">
      <span class="pop-word">${esc(info.surface)}</span>
      ${info.pos ? `<span class="pop-badge">${esc(info.pos)}</span>` : ''}
      <button class="pop-close" title="Close">${ICON.close}</button>
    </div>
    <div class="pop-rom">
      <button class="pop-tts" title="Pronounce">${ICON.speaker}</button>
      <span class="pop-rom-text">[${esc(romanize(info.surface))}]</span>
    </div>
    <div class="pop-trans">${info.translation ? esc(info.translation) : '<span class="muted">no translation</span>'}</div>
    ${dictForm && dictForm !== info.surface ? `<div class="pop-inf">dictionary form: <b>${esc(dictForm)}</b><button class="pop-tts pop-tts-inf" title="Pronounce dictionary form">${ICON.speaker}</button></div>` : ''}
    ${info.form ? `<div class="pop-form">form: ${esc(info.form)}</div>` : ''}
    ${info.speechLevel ? `<div class="pop-form">speech level: ${esc(info.speechLevel)}</div>` : ''}
    ${info.meanings.length > 1
      ? `<ul class="pop-meanings">${info.meanings.slice(0, 5).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
      : ''}
    ${sentence ? `<div class="pop-example">
      <div class="pop-example-ko">${highlightWord(sentence, info.surface, color)}</div>
      ${sentenceTr ? `<div class="pop-example-en">${esc(`“${sentenceTr}”`)}</div>` : ''}
    </div>` : ''}
    <button class="pop-flash">${ICON.plus}<span>Add to flashcards</span></button>
    <a class="pop-naver" target="_blank" href="https://korean.dict.naver.com/koendict/#/search?range=all&query=${encodeURIComponent(info.infinitive || info.base || info.surface)}">
      ${ICON.external}<span>Open in Naver Dictionary</span>
    </a>
  `;
  shadow.appendChild(pop);

  // Position relative to the clicked word, then clamp inside the viewport on
  // both axes (flip above the word if it would overflow the bottom).
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const { width: popW, height: popH } = pop.getBoundingClientRect();

  let left = r.left;
  if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
  left = Math.max(margin, left);

  let top = r.bottom + 6;
  if (top + popH > window.innerHeight - margin) {
    top = r.top - popH - 6; // flip above the word
    if (top < margin) top = Math.max(margin, window.innerHeight - popH - margin);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const dismiss = () => {
    anchor.classList.remove('active');
    pop.remove();
  };

  pop.querySelector('.pop-tts')!.addEventListener('click', () => tts(info.surface));
  if (dictForm) pop.querySelector('.pop-tts-inf')?.addEventListener('click', () => tts(dictForm));
  pop.querySelector('.pop-close')!.addEventListener('click', dismiss);

  const ankiBtn = pop.querySelector('.pop-flash') as HTMLButtonElement;
  const ankiLabel = ankiBtn.querySelector('span') as HTMLElement;
  ankiBtn.addEventListener('click', async () => {
    ankiBtn.disabled = true;
    ankiLabel.textContent = 'Adding…';
    const card = {
      word: info.surface,
      base: info.base,
      wordTranslation: info.translation || '',
      meanings: info.meanings || [],
      wordPos: info.pos || '',
      infinitive: info.infinitive,
      sentence: currentAnalysis?.text || '',
      sentenceTranslation: currentAnalysis?.sentenceTranslation || '',
      source: location.hostname,
    };
    let resp: ExtensionMessage | undefined;
    try {
      resp = (await browser.runtime.sendMessage({
        type: 'ANKI_ADD', card,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    } catch {
      resp = undefined;
    }
    if (resp && resp.type === 'ANKI_ADD_DONE' && resp.ok) {
      ankiBtn.classList.add('done');
      ankiLabel.textContent = resp.sentNow ? `Saved to ${targetName(resp.target)} ✓` : 'Queued ✓';
    } else {
      ankiBtn.classList.add('warn');
      ankiLabel.textContent =
        resp && resp.type === 'ANKI_ADD_DONE' ? (resp.message || 'Kept in queue') : 'Failed — try again';
      ankiBtn.disabled = false;
    }
    void updateAnkiBar(shadow);
  });

  // Close on outside click.
  const onDoc = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(pop) && !path.includes(anchor)) {
      dismiss();
      document.removeEventListener('mousedown', onDoc);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
}

// Wrap occurrences of `word` in the sentence with a POS-colored highlight span.
function highlightWord(sentence: string, word: string, color: string): string {
  const safe = esc(sentence);
  if (!word) return safe;
  return safe
    .split(esc(word))
    .join(`<span class="pop-hl" style="background:${hexA(color, 0.22)}">${esc(word)}</span>`);
}

// ---------------------------------------------------------------------------
// Text-to-speech (routed through background → Google TTS; falls back locally)
// ---------------------------------------------------------------------------

async function tts(text: string) {
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'TTS_REQUEST',
      text,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    if (resp && resp.type === 'TTS_DONE' && resp.ok) return;
    throw new Error(resp && resp.type === 'TTS_DONE' ? resp.message || 'tts failed' : 'tts failed');
  } catch {
    // Fallback to the browser's own voice (may be silent if none installed).
    try {
      speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'ko-KR';
      utt.rate = 0.85;
      speechSynthesis.speak(utt);
    } catch {
      /* nothing we can do */
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "#rrggbb" + alpha → rgba()
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function el(tag: string, styles: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  return e;
}

function makeDraggable(host: HTMLElement, handle: HTMLElement) {
  let startX = 0, startY = 0, startL = 0, startT = 0;
  handle.style.cursor = 'move';

  const onMove = (e: MouseEvent) => {
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${startL + (e.clientX - startX)}px`;
    host.style.top = `${startT + (e.clientY - startY)}px`;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.close')) return;
    const rect = host.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startL = rect.left; startT = rect.top;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Panel styles
// ---------------------------------------------------------------------------

const STYLES = `
  :host {
    --wkr-green: #00c73c;
    --wkr-green-strong: #00a030;
    --wkr-green-soft: rgba(0,199,60,0.12);
    --wkr-bg: #ffffff;
    --wkr-surface: #f5f6f8;
    --wkr-text: #1a1a1a;
    --wkr-muted: #6b7280;
    --wkr-border: #e5e7eb;
    --wkr-ink: #1a1a1a;
    --wkr-error: #e5484d;
  }
  .panel {
    background: var(--wkr-bg);
    color: var(--wkr-text);
    border-radius: 14px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.16);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 520px;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 11px 14px;
    background: var(--wkr-bg);
    border-bottom: 1px solid var(--wkr-border);
    user-select: none;
  }
  .title {
    display: flex; align-items: center; gap: 7px;
    font-size: 13px; font-weight: 700; color: var(--wkr-green-strong); letter-spacing: 0.3px;
  }
  .close {
    display: flex; background: none; border: none; color: var(--wkr-muted); cursor: pointer;
    padding: 3px; border-radius: 5px;
  }
  .close:hover { color: var(--wkr-text); background: var(--wkr-surface); }
  .body {
    padding: 12px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 10px;
  }
  .status { color: var(--wkr-muted); font-size: 13px; text-align: center; padding: 16px 0; }
  .muted { color: var(--wkr-muted); }
  .error {
    color: var(--wkr-error); font-size: 13px; padding: 8px;
    background: rgba(229,72,77,0.08); border-radius: 8px;
    line-height: 1.5; word-break: break-word;
  }
  .progress { width: 100%; height: 6px; background: var(--wkr-surface); border-radius: 3px; overflow: hidden; }
  .progress-bar { height: 100%; background: var(--wkr-green); border-radius: 3px; transition: width 0.2s ease; }
  .progress-pct { font-size: 11px; color: var(--wkr-muted); text-align: center; }

  .phrase-row {
    display: flex; align-items: flex-start; gap: 8px;
    background: var(--wkr-surface); border-radius: 10px; padding: 12px;
  }
  .phrase {
    flex: 1;
    font-size: 19px; line-height: 2; font-weight: 500; color: var(--wkr-text);
    padding-top: 2px;
    word-break: keep-all;
  }
  .speak-all {
    flex: none; display: flex; align-items: center; justify-content: center;
    background: var(--wkr-bg); border: 1px solid var(--wkr-border);
    color: var(--wkr-muted); cursor: pointer; padding: 6px; border-radius: 8px;
  }
  .speak-all:hover { color: var(--wkr-green-strong); border-color: var(--wkr-green); }
  .w {
    cursor: pointer; padding: 2px 3px 7px; border-radius: 5px;
    background-image: radial-gradient(circle, var(--c, var(--wkr-muted)) 1.6px, transparent 1.9px);
    background-size: 7px 7px;
    background-repeat: round no-repeat;
    background-position: left bottom 1px;
    transition: background-color 0.12s ease;
  }
  .w:hover { background-color: var(--c-soft, var(--wkr-green-soft)); }
  .w.active { background-color: var(--c-soft, var(--wkr-green-soft)); }

  .translation {
    font-size: 15px; line-height: 1.5; color: var(--wkr-text); font-weight: 500;
    padding: 10px; background: var(--wkr-green-soft); border-radius: 8px;
  }
  .translation.hidden { display: none; }
  .tone { font-size: 11px; color: var(--wkr-muted); margin-top: 6px; font-weight: 400; }

  .btn-primary, .btn-row {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 600;
    border-radius: 8px; font-family: inherit;
  }
  .btn-primary {
    background: var(--wkr-green); border: 1px solid var(--wkr-green); color: #fff;
  }
  .btn-primary:hover { background: var(--wkr-green-strong); border-color: var(--wkr-green-strong); }
  .btn-row {
    background: none; border: 1px solid var(--wkr-border); color: var(--wkr-muted); font-weight: 500;
  }
  .btn-row:hover { color: var(--wkr-green-strong); border-color: var(--wkr-green); }

  .legend { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 2px; }
  .legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--wkr-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  .anki-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--wkr-border);
    flex-wrap: wrap;
  }
  .anki-count { font-size: 11px; color: var(--wkr-muted); }
  .anki-count.muted { color: var(--wkr-muted); }
  .anki-count.ok { color: var(--wkr-green-strong); }
  .anki-count.warn { color: #c2410c; line-height: 1.4; }
  .anki-actions { display: flex; align-items: center; gap: 6px; }
  .anki-bar .anki-send { width: auto; padding: 5px 10px; font-size: 12px; }
  .anki-clear {
    display: flex; background: none; border: none; color: var(--wkr-muted); cursor: pointer;
    padding: 3px; border-radius: 5px;
  }
  .anki-clear:hover { color: var(--wkr-error); background: var(--wkr-surface); }

  .pop-flash {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    width: 100%; padding: 10px; cursor: pointer; font-size: 13px; font-weight: 600;
    border-radius: 9px; font-family: inherit;
    background: var(--wkr-ink); border: 1px solid var(--wkr-ink); color: #fff;
    margin-top: 2px;
  }
  .pop-flash:hover:not(:disabled) { background: #000; }
  .pop-flash:disabled { cursor: default; opacity: 0.9; }
  .pop-flash.done { background: var(--wkr-green); border-color: var(--wkr-green); color: #fff; }
  .pop-flash.warn { background: #fff7ed; border-color: #fdba74; color: #c2410c; }

  .popover {
    position: fixed; width: 280px; z-index: 2147483647;
    max-height: calc(100vh - 16px); overflow-y: auto;
    background: var(--wkr-bg); border-radius: 14px;
    box-shadow: 0 14px 40px rgba(0,0,0,0.18); padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .pop-head { display: flex; align-items: center; gap: 8px; }
  .pop-word { font-size: 24px; font-weight: 800; color: var(--wkr-text); flex: 1; word-break: keep-all; }
  .pop-badge {
    font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px;
    color: var(--wkr-muted); background: var(--wkr-surface); text-transform: lowercase;
  }
  .pop-close {
    display: flex; background: none; border: none; cursor: pointer;
    color: var(--wkr-muted); padding: 3px; border-radius: 6px;
  }
  .pop-close:hover { background: var(--wkr-surface); color: var(--wkr-text); }
  .pop-rom { display: flex; align-items: center; gap: 8px; }
  .pop-tts {
    display: flex; background: none; border: none; cursor: pointer;
    color: var(--wkr-muted); padding: 3px; border-radius: 6px;
  }
  .pop-tts:hover { background: var(--wkr-surface); color: var(--wkr-green-strong); }
  .pop-rom-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px; color: var(--wkr-muted); letter-spacing: 0.2px;
  }
  .pop-trans { font-size: 17px; font-weight: 600; color: var(--wkr-text); }
  .pop-inf { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--wkr-muted); }
  .pop-inf b { color: var(--wkr-text); }
  .pop-tts-inf { padding: 2px; }
  .pop-form { font-size: 12px; color: var(--wkr-muted); }
  .pop-meanings { margin: 0; padding-left: 16px; color: var(--wkr-muted); font-size: 12px; line-height: 1.5; }
  .pop-example {
    background: var(--wkr-surface); border: 1px solid var(--wkr-border); border-radius: 10px;
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
  }
  .pop-example-ko { font-size: 14px; line-height: 1.6; color: var(--wkr-text); word-break: keep-all; }
  .pop-hl { padding: 1px 3px; border-radius: 4px; font-weight: 600; }
  .pop-example-en { font-size: 13px; font-style: italic; color: var(--wkr-muted); line-height: 1.5; }
  .pop-naver {
    display: flex; align-items: center; gap: 6px;
    color: var(--wkr-muted); text-decoration: none; font-size: 12px;
    padding-top: 8px; border-top: 1px solid var(--wkr-border);
  }
  .pop-naver:hover { color: var(--wkr-green-strong); text-decoration: underline; }
`;
