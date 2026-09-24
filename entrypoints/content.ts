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
  check: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 9v6M9 12h6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>`,
};

// ---------------------------------------------------------------------------
// Part-of-speech → color (for word coloring)
// ---------------------------------------------------------------------------

// Same values as the site's deck, so a word keeps its colour from the page to
// the card. Keys stay English (they come from the analyser); only the labels
// shown to the reader are French.
const POS_COLORS: Record<string, string> = {
  noun: '#2f4bd8',
  pronoun: '#6478e0',
  verb: '#1f8a70',
  adjective: '#a8561c',
  adverb: '#c2701c',
  particle: '#9b97a6',
  numeral: '#5d6b8a',
  determiner: '#a1731c',
  interjection: '#c8412f',
  suffix: '#9b97a6',
};

const POS_LABELS: Record<string, string> = {
  noun: 'nom',
  pronoun: 'pronom',
  verb: 'verbe',
  adjective: 'adjectif',
  adverb: 'adverbe',
  particle: 'particule',
  numeral: 'numéral',
  determiner: 'déterminant',
  interjection: 'interjection',
  suffix: 'suffixe',
  conjunction: 'conjonction',
};

function posColor(pos: string): string {
  return POS_COLORS[pos] ?? '#9b97a6'; // unclassified words read as neutral
}

function posLabel(pos: string): string {
  if (!pos || pos === 'other') return 'autre';
  return POS_LABELS[pos] ?? pos;
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
    background: 'rgba(20, 18, 26, 0.45)',
    zIndex: '2147483645',
    cursor: 'crosshair',
    userSelect: 'none',
    touchAction: 'none',
  });

  // Ink pill with cream text: the site's "ink" button, used here as a label.
  const hint = el('div', {
    position: 'fixed', top: '16px', left: '50%',
    transform: 'translateX(-50%)',
    background: '#16141a', color: '#f4f1e9',
    border: '1px solid #000000',
    padding: '9px 16px', borderRadius: '12px',
    fontFamily: FONT_STACK, fontSize: '14px', fontWeight: '600',
    lineHeight: '1.3', letterSpacing: '0',
    pointerEvents: 'none', zIndex: '2147483647',
    whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 32px)',
    overflow: 'hidden', textOverflow: 'ellipsis',
  });
  hint.setAttribute('role', 'status');
  hint.textContent = 'Trace un cadre autour d’une bulle · Échap pour annuler';

  const selBox = el('div', {
    position: 'fixed', display: 'none',
    border: '2px solid #2f4bd8', background: 'transparent',
    borderRadius: '4px',
    // Once dragging starts, the box itself casts the dimming (a huge spread
    // shadow) and the overlay goes clear, so the bubble you are framing stays
    // at full brightness while the rest of the page recedes.
    boxShadow: '0 0 0 100vmax rgba(20, 18, 26, 0.45)',
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
    overlay.style.background = 'transparent';
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
  setPanelStatus(panel, 'Capture en cours…');

  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'CAPTURE_REQUEST',
      rect,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;

    if (!resp) {
      setPanelError(panel, 'L’extension ne répond pas. Recharge la page et réessaie.', () => runCapture(rect));
      return;
    }
    if (resp.type === 'CAPTURE_ERROR') { setPanelError(panel, resp.message, () => runCapture(rect)); return; }
    if (resp.type !== 'CAPTURE_RESULT') return;

    renderResults(panel, resp.analysis);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes('message channel closed') || msg.includes('Extension context invalidated')) {
      setPanelError(panel, 'L’extension a été mise à jour. Actualise la page et réessaie.', () => runCapture(rect));
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
  setPanelStatus(panel, 'Analyse en cours…');

  const retry = () => runAnalyzeText(clean);
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'ANALYZE_TEXT',
      text: clean,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;

    if (!resp) {
      setPanelError(panel, 'L’extension ne répond pas. Recharge la page et réessaie.', retry);
      return;
    }
    if (resp.type === 'CAPTURE_ERROR') { setPanelError(panel, resp.message, retry); return; }
    if (resp.type !== 'CAPTURE_RESULT') return;

    renderResults(panel, resp.analysis);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes('message channel closed') || msg.includes('Extension context invalidated')) {
      setPanelError(panel, 'L’extension a été mise à jour. Actualise la page et réessaie.', retry);
    } else {
      setPanelError(panel, msg, retry);
    }
  }
}

// ---------------------------------------------------------------------------
// Result panel (Shadow DOM for style isolation)
// ---------------------------------------------------------------------------

// Pretendard when the reader has it installed, the system face otherwise. The
// panel sits on arbitrary pages, so no remote font is ever loaded.
const FONT_STACK = '"Pretendard Variable", Pretendard, system-ui, -apple-system, sans-serif';

// Escape closes the innermost layer first (word card, then the panel). Kept in
// a module variable so a new panel replaces the old listener instead of
// stacking another one.
let panelKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function closePanel(shadow: ShadowRoot) {
  if (activePanel === shadow) activePanel = null;
  if (panelKeyHandler) {
    document.removeEventListener('keydown', panelKeyHandler, true);
    panelKeyHandler = null;
  }
  (shadow.host as HTMLElement).remove();
}

function createPanel(): ShadowRoot {
  const previous = document.getElementById('wkr-host');
  if (previous?.shadowRoot) closePanel(previous.shadowRoot);
  else previous?.remove();

  const host = document.createElement('div');
  host.id = 'wkr-host';
  Object.assign(host.style, {
    position: 'fixed', top: '16px', right: '16px',
    width: '340px', maxWidth: 'calc(100vw - 32px)', zIndex: '2147483647',
    fontFamily: FONT_STACK,
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  shadow.appendChild(styleEl);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Sori');
  panel.innerHTML = `
    <div class="header">
      <span class="title"><svg class="title-mark" viewBox="0 0 64 64" width="18" height="18" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#2f4bd8"/><path fill="#f4f1e9" d="M32.03 50Q28.62 50 25.93 49.35Q23.24 48.69 21.33 47.36Q19.42 46.02 18.34 44.01Q17.27 41.99 17.11 39.38L23.71 37.23Q23.81 39.59 24.88 41.16Q25.96 42.73 27.94 43.46Q29.93 44.19 32.39 44.19Q34.75 44.19 36.37 43.62Q37.99 43.04 38.83 42.07Q39.67 41.1 39.67 39.95Q39.67 38.59 38.62 37.76Q37.57 36.92 35.77 36.34Q33.96 35.77 31.66 35.24Q29.1 34.67 26.61 33.94Q24.12 33.2 22.11 32.05Q20.1 30.9 18.92 29.07Q17.74 27.24 17.74 24.47Q17.74 21.27 19.34 18.94Q20.93 16.62 24.02 15.31Q27.11 14 31.45 14Q35.85 14 38.96 15.28Q42.07 16.56 43.8 18.89Q45.53 21.22 45.68 24.41L38.88 26.3Q38.88 24.67 38.36 23.47Q37.83 22.27 36.89 21.46Q35.95 20.65 34.56 20.23Q33.18 19.81 31.4 19.81Q29.36 19.81 27.87 20.33Q26.38 20.85 25.62 21.74Q24.86 22.63 24.86 23.84Q24.86 25.25 26.03 26.17Q27.21 27.08 29.17 27.66Q31.14 28.23 33.49 28.76Q35.74 29.23 38.07 29.93Q40.4 30.64 42.41 31.76Q44.43 32.89 45.66 34.8Q46.89 36.71 46.89 39.59Q46.89 42.73 45.21 45.08Q43.54 47.44 40.22 48.72Q36.89 50 32.03 50Z"/></svg><span>Sori</span></span>
      <button class="close icon-btn" title="Fermer (Échap)" aria-label="Fermer">${ICON.close}</button>
    </div>
    <div class="body" aria-live="polite"><div class="status">Capture en cours…</div></div>
  `;
  shadow.appendChild(panel);

  shadow.querySelector('.close')!.addEventListener('click', () => closePanel(shadow));
  makeDraggable(host, shadow.querySelector('.header') as HTMLElement);

  panelKeyHandler = (e: KeyboardEvent) => {
    // While a new selection is being drawn, Escape belongs to the overlay.
    if (e.key !== 'Escape' || scanActive) return;
    const pop = shadow.querySelector('.popover');
    if (pop) {
      (pop as HTMLElement & { _dismiss?: () => void })._dismiss?.();
    } else {
      closePanel(shadow);
    }
  };
  document.addEventListener('keydown', panelKeyHandler, true);

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
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="progress-pct">${pct} %</div>
  `;
}

function setPanelError(shadow: ShadowRoot, msg: string, onRetry?: () => void) {
  const body = shadow.querySelector('.body') as HTMLElement;
  body.innerHTML = `
    <div class="error" role="alert">${esc(msg)}</div>
    ${onRetry ? `<button class="btn btn-primary retry">${ICON.refresh}<span>Réessayer</span></button>` : ''}
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
      <div class="status">Aucun texte détecté. Essaie un cadre plus serré autour de la bulle.</div>
      <button class="btn btn-primary scan-again">${ICON.camera}<span>Scanner une autre bulle</span></button>`;
    body.querySelector('.scan-again')!.addEventListener('click', () => activateScan());
    return;
  }

  body.innerHTML = `
    <div class="phrase-card">
      <div class="phrase-head">
        <span class="label">Phrase</span>
        <button class="speak-all icon-btn" title="Écouter la phrase" aria-label="Écouter la phrase">${ICON.speaker}</button>
      </div>
      <div class="phrase" lang="ko"></div>
      <div class="legend"></div>
    </div>
    <button class="btn btn-quiet toggle-tr" aria-expanded="false">
      ${ICON.eye}<span class="toggle-label">Afficher la traduction</span>
    </button>
    <div class="translation hidden">
      <span class="label">Traduction</span>
      <div class="translation-text">${analysis.sentenceTranslation
        ? esc(analysis.sentenceTranslation)
        : '<span class="muted">Traduction indisponible</span>'}</div>
      ${analysis.tone ? `<div class="tone">Ton : ${esc(analysis.tone)}</div>` : ''}
    </div>
    <button class="btn btn-quiet scan-again">${ICON.camera}<span>Scanner une autre bulle</span></button>
    <div class="anki-bar"></div>
  `;

  // Flowing Korean phrase: each word is a chip outlined in its part-of-speech
  // colour. Chips are real buttons so Tab and Enter reach every word.
  const phraseEl = body.querySelector('.phrase') as HTMLElement;
  analysis.words.forEach((info) => {
    const color = posColor(info.pos);
    const w = document.createElement('button');
    w.type = 'button';
    w.className = 'w';
    w.textContent = info.surface;
    w.title = posLabel(info.pos);
    w.style.setProperty('--c', color);
    w.addEventListener('click', () => {
      phraseEl.querySelectorAll('.w.active').forEach((e) => e.classList.remove('active'));
      w.classList.add('active');
      showWordPopover(shadow, w, info);
    });
    phraseEl.appendChild(w);
  });

  // Show / hide translation toggle.
  const tr = body.querySelector('.translation') as HTMLElement;
  const toggle = body.querySelector('.toggle-tr') as HTMLElement;
  const label = body.querySelector('.toggle-label') as HTMLElement;
  toggle.addEventListener('click', () => {
    const hidden = tr.classList.toggle('hidden');
    label.textContent = hidden ? 'Afficher la traduction' : 'Masquer la traduction';
    toggle.setAttribute('aria-expanded', String(!hidden));
  });

  body.querySelector('.speak-all')!.addEventListener('click', () => tts(analysis.text));
  body.querySelector('.scan-again')!.addEventListener('click', () => activateScan());

  // Legend of the parts of speech actually present.
  const present = [...new Set(analysis.words.map((w) => w.pos || 'other'))];
  const legend = body.querySelector('.legend') as HTMLElement;
  legend.innerHTML = present
    .map((p) => {
      const c = posColor(p === 'other' ? '' : p);
      return `<span class="legend-item"><span class="dot" style="background:${c}"></span>${esc(posLabel(p))}</span>`;
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

function cards(n: number, suffix = ''): string {
  return `${n} carte${n > 1 ? 's' : ''}${suffix ? ` ${suffix}${n > 1 ? 's' : ''}` : ''}`;
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
    /* background not ready: show the empty bar */
  }

  if (count === 0) {
    bar.innerHTML = `<span class="anki-count muted">Aucune carte en attente</span>`;
    return;
  }

  bar.innerHTML = `
    <span class="anki-count">${cards(count)} en attente</span>
    <div class="anki-actions">
      <button class="btn btn-quiet btn-sm anki-send">${ICON.send}<span>Tout envoyer vers ${targetName(target)}</span></button>
      <button class="anki-clear icon-btn" title="Vider la file" aria-label="Vider la file">${ICON.close}</button>
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
  bar.innerHTML = `<span class="anki-count muted">Envoi en cours…</span>`;

  let resp: ExtensionMessage | undefined;
  try {
    resp = (await browser.runtime.sendMessage({
      type: 'ANKI_SEND_ALL',
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
  } catch {
    resp = undefined;
  }

  if (!resp || resp.type !== 'ANKI_SEND_ALL_DONE') {
    bar.innerHTML = `<span class="anki-count warn">L’extension ne répond pas. Réessaie.</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 2500);
    return;
  }

  const dest = targetName(resp.target);
  if (resp.ok && resp.failed === 0) {
    bar.innerHTML = `<span class="anki-count ok">${ICON.check}<span>${cards(resp.added, 'envoyée')} vers ${dest}</span></span>`;
  } else if (resp.added > 0) {
    bar.innerHTML = `<span class="anki-count warn">${cards(resp.added, 'envoyée')}, ${resp.failed} en échec · ${resp.remaining} encore en attente.</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 3000);
  } else {
    const why =
      resp.message ||
      (resp.target === 'anki'
        ? 'Impossible de joindre Anki. Ouvre-le avec le module AnkiConnect.'
        : 'Impossible de joindre Sori. Vérifie ta connexion et ton jeton d’accès.');
    bar.innerHTML = `<span class="anki-count warn">${esc(why)}</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 4000);
  }
}

// ---------------------------------------------------------------------------
// Word detail popover
// ---------------------------------------------------------------------------

function showWordPopover(shadow: ShadowRoot, anchor: HTMLElement, info: WordInfo) {
  (shadow.querySelector('.popover') as (HTMLElement & { _dismiss?: () => void }) | null)?._dismiss?.();
  shadow.querySelector('.popover')?.remove();
  anchor.classList.add('active');

  const color = posColor(info.pos);
  const dictForm = info.infinitive || info.base;
  const sentence = currentAnalysis?.text || '';
  const sentenceTr = currentAnalysis?.sentenceTranslation || '';
  const pop = document.createElement('div') as HTMLElement & { _dismiss?: () => void };
  pop.className = 'popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', info.surface);
  pop.innerHTML = `
    <div class="pop-head">
      <span class="pop-word" lang="ko">${esc(info.surface)}</span>
      <button class="pop-close icon-btn" title="Fermer (Échap)" aria-label="Fermer">${ICON.close}</button>
    </div>
    <div class="pop-rom">
      ${info.pos ? `<span class="pop-badge" style="--c:${color}">${esc(posLabel(info.pos))}</span>` : ''}
      <span class="pop-rom-text">[${esc(romanize(info.surface))}]</span>
      <button class="pop-tts icon-btn" title="Prononcer" aria-label="Prononcer">${ICON.speaker}</button>
    </div>
    <div class="pop-trans">${info.translation ? esc(info.translation) : '<span class="muted">Pas de traduction</span>'}</div>
    ${dictForm && dictForm !== info.surface ? `<div class="pop-inf"><span class="label">Forme du dictionnaire</span><b lang="ko">${esc(dictForm)}</b><button class="pop-tts pop-tts-inf icon-btn" title="Prononcer la forme du dictionnaire" aria-label="Prononcer la forme du dictionnaire">${ICON.speaker}</button></div>` : ''}
    ${info.form ? `<div class="pop-form"><span class="label">Forme</span>${esc(info.form)}</div>` : ''}
    ${info.speechLevel ? `<div class="pop-form"><span class="label">Registre</span>${esc(info.speechLevel)}</div>` : ''}
    ${info.meanings.length > 1
      ? `<div class="pop-meanings-wrap"><span class="label">Autres sens</span><ul class="pop-meanings">${info.meanings.slice(0, 5).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`
      : ''}
    ${sentence ? `<div class="pop-example">
      <div class="pop-example-ko" lang="ko">${highlightWord(sentence, info.surface, color)}</div>
      ${sentenceTr ? `<div class="pop-example-en">${esc(`« ${sentenceTr} »`)}</div>` : ''}
    </div>` : ''}
    <button class="btn btn-ink pop-flash">${ICON.plus}<span>Ajouter au deck</span></button>
    <a class="pop-naver" target="_blank" rel="noreferrer" href="https://korean.dict.naver.com/koendict/#/search?range=all&query=${encodeURIComponent(info.infinitive || info.base || info.surface)}">
      ${ICON.external}<span>Ouvrir dans le dictionnaire Naver</span>
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

  // Close on outside click.
  const onDoc = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(pop) && !path.includes(anchor)) dismiss();
  };

  const dismiss = (returnFocus = false) => {
    document.removeEventListener('mousedown', onDoc);
    anchor.classList.remove('active');
    pop.remove();
    if (returnFocus && anchor.isConnected) anchor.focus();
  };
  pop._dismiss = () => dismiss(true);

  pop.querySelector('.pop-tts')!.addEventListener('click', () => tts(info.surface));
  if (dictForm) pop.querySelector('.pop-tts-inf')?.addEventListener('click', () => tts(dictForm));
  pop.querySelector('.pop-close')!.addEventListener('click', () => dismiss(true));

  const ankiBtn = pop.querySelector('.pop-flash') as HTMLButtonElement;
  const ankiIcon = () => ankiBtn.querySelector('svg');
  const ankiLabel = ankiBtn.querySelector('span') as HTMLElement;
  const setIcon = (svg: string) => {
    const tmp = document.createElement('span');
    tmp.innerHTML = svg;
    ankiIcon()?.replaceWith(tmp.firstElementChild!);
  };
  ankiBtn.addEventListener('click', async () => {
    ankiBtn.disabled = true;
    ankiBtn.classList.remove('warn');
    ankiLabel.textContent = 'Ajout en cours…';
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
      setIcon(ICON.check);
      ankiLabel.textContent = resp.sentNow ? `Ajoutée à ${targetName(resp.target)}` : 'Mise en attente';
    } else {
      ankiBtn.classList.add('warn');
      ankiLabel.textContent =
        resp && resp.type === 'ANKI_ADD_DONE' ? (resp.message || 'Gardée en attente') : 'Échec, réessaie';
      ankiBtn.disabled = false;
    }
    void updateAnkiBar(shadow);
  });

  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  // Keyboard users land on the main action; Escape brings them back to the chip.
  ankiBtn.focus({ preventScroll: true });
}

// Wrap occurrences of `word` in the sentence with a POS-colored highlight span.
function highlightWord(sentence: string, word: string, color: string): string {
  const safe = esc(sentence);
  if (!word) return safe;
  return safe
    .split(esc(word))
    .join(`<span class="pop-hl" style="background:${hexA(color, 0.16)};box-shadow:inset 0 -2px 0 ${color}">${esc(word)}</span>`);
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
    /* Sori's palette, same values as the popup and the site. This panel is
       injected over someone else's page, so it is the surface most people
       see. Everything is reset inside the shadow root so the host page's
       styles cannot leak in. */
    --wkr-accent: #2f4bd8;
    --wkr-accent-strong: #2438a8;
    --wkr-accent-soft: #e4e8fb;
    --wkr-celadon: #1f8a70;
    --wkr-celadon-strong: #176b57;
    --wkr-bg: #ffffff;
    --wkr-surface: #f4f1e9;
    --wkr-text: #16141a;
    --wkr-muted: #6a6675;
    --wkr-border: rgba(20, 18, 26, 0.14);
    --wkr-border-edge: rgba(20, 18, 26, 0.24);
    --wkr-ink: #16141a;
    --wkr-error: #c8412f;
    --wkr-error-strong: #9c3122;
    all: initial;
    display: block;
    font-family: ${FONT_STACK};
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, a { font-family: inherit; }
  :focus { outline: none; }
  :focus-visible { outline: 2px solid var(--wkr-accent); outline-offset: 2px; }
  svg { flex: none; }

  .panel {
    font-family: ${FONT_STACK};
    background: var(--wkr-bg);
    color: var(--wkr-text);
    border: 1px solid var(--wkr-border);
    border-radius: 16px;
    box-shadow: 0 12px 28px -16px rgba(20, 18, 26, 0.35);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: min(560px, calc(100vh - 32px));
    font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 10px 10px 14px;
    background: var(--wkr-bg);
    border-bottom: 1px solid var(--wkr-border);
    user-select: none;
  }
  .title {
    display: flex; align-items: baseline; gap: 7px;
    font-size: 14px; font-weight: 700; color: var(--wkr-text);
  }
  .title-mark { display: block; flex-shrink: 0; }

  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; flex: none;
    background: none; border: 1px solid transparent; color: var(--wkr-muted);
    cursor: pointer; padding: 0; border-radius: 10px;
    transition: transform 0.08s ease;
  }
  .icon-btn:hover { color: var(--wkr-text); background: var(--wkr-surface); }
  .icon-btn:active { transform: scale(0.97); }

  .body {
    padding: 12px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 10px;
  }
  .label {
    display: block;
    font-size: 11px; font-weight: 600; line-height: 1.2;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--wkr-muted);
  }
  .status { color: var(--wkr-muted); font-size: 14px; text-align: center; padding: 18px 8px; }
  .muted { color: var(--wkr-muted); }
  .error {
    color: var(--wkr-error-strong); font-size: 14px; padding: 10px 12px;
    background: #fbeeeb; border: 1px solid rgba(200, 65, 47, 0.3); border-radius: 12px;
    line-height: 1.5; word-break: break-word;
  }
  .progress { width: 100%; height: 6px; background: var(--wkr-surface); border-radius: 3px; overflow: hidden; }
  .progress-bar { height: 100%; background: var(--wkr-accent); border-radius: 3px; transition: width 0.2s ease; }
  .progress-pct { font-size: 11px; color: var(--wkr-muted); text-align: center; font-variant-numeric: tabular-nums; }

  /* Buttons: flat fill, 1px border in the pressed shade, press shrinks. */
  .btn {
    --fill: var(--wkr-accent); --edge: var(--wkr-accent-strong);
    display: flex; align-items: center; justify-content: center; gap: 7px;
    width: 100%; min-height: 38px; padding: 8px 14px;
    font-size: 14px; font-weight: 600; line-height: 1.2;
    color: #fff; background: var(--fill); border: 1px solid var(--edge);
    border-radius: 12px; cursor: pointer; text-decoration: none;
    transition: transform 0.08s ease, background-color 0.12s ease;
  }
  .btn:hover:not(:disabled) { background: var(--edge); }
  .btn:active:not(:disabled) { transform: scale(0.97); }
  .btn:disabled { cursor: default; }
  .btn-quiet { --fill: var(--wkr-bg); --edge: var(--wkr-border-edge); color: var(--wkr-text); }
  .btn-quiet:hover:not(:disabled) { background: var(--wkr-surface); }
  .btn-ink { --fill: var(--wkr-ink); --edge: #000000; color: var(--wkr-surface); }
  .btn-sm { width: auto; min-height: 30px; padding: 5px 10px; font-size: 12px; }

  .phrase-card {
    background: var(--wkr-surface); border: 1px solid var(--wkr-border);
    border-radius: 16px; padding: 10px 12px 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .phrase-head { display: flex; align-items: center; justify-content: space-between; margin: -2px -4px -2px 0; }
  .speak-all:hover { color: var(--wkr-accent-strong); background: var(--wkr-bg); }
  .phrase { display: flex; flex-wrap: wrap; gap: 6px; word-break: keep-all; }

  /* Word chips: white face, outline in the part-of-speech colour. */
  .w {
    font-family: inherit; font-size: 18px; font-weight: 600; line-height: 1.3;
    color: var(--wkr-text); background: var(--wkr-bg);
    border: 1px solid var(--c, var(--wkr-border-edge));
    border-radius: 12px; padding: 4px 10px; cursor: pointer;
    transition: transform 0.08s ease, background-color 0.12s ease;
  }
  .w:hover { background: var(--wkr-surface); }
  .w:active { transform: scale(0.97); }
  .w.active { background: var(--wkr-accent-soft); }

  .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--wkr-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  .translation {
    display: flex; flex-direction: column; gap: 4px;
    padding: 10px 12px; background: var(--wkr-accent-soft);
    border: 1px solid rgba(47, 75, 216, 0.18); border-radius: 12px;
  }
  .translation.hidden { display: none; }
  .translation .label { color: var(--wkr-accent-strong); }
  .translation-text { font-size: 16px; line-height: 1.5; color: var(--wkr-text); font-weight: 500; }
  .tone { font-size: 12px; color: var(--wkr-muted); }

  .anki-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: 2px; padding-top: 10px; border-top: 1px solid var(--wkr-border);
    flex-wrap: wrap; min-height: 30px;
  }
  .anki-count { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--wkr-text); line-height: 1.4; }
  .anki-count.muted { color: var(--wkr-muted); }
  .anki-count.ok { color: var(--wkr-celadon-strong); font-weight: 600; }
  .anki-count.warn { color: var(--wkr-error-strong); }
  .anki-actions { display: flex; align-items: center; gap: 4px; }
  .anki-clear:hover { color: var(--wkr-error); }

  .popover {
    position: fixed; width: 290px; max-width: calc(100vw - 16px); z-index: 2147483647;
    max-height: calc(100vh - 16px); overflow-y: auto;
    font-family: ${FONT_STACK};
    font-size: 14px; line-height: 1.5; color: var(--wkr-text);
    background: var(--wkr-bg); border: 1px solid var(--wkr-border); border-radius: 16px;
    box-shadow: 0 12px 28px -16px rgba(20, 18, 26, 0.35);
    padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .pop-head { display: flex; align-items: flex-start; gap: 8px; }
  .pop-word { font-size: 30px; font-weight: 700; line-height: 1.15; color: var(--wkr-text); flex: 1; word-break: keep-all; }
  .pop-close { margin: -4px -4px 0 0; }
  .pop-rom { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: -4px; }
  .pop-badge {
    font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 12px;
    color: var(--c, var(--wkr-muted)); background: var(--wkr-bg);
    border: 1px solid var(--c, var(--wkr-border-edge));
  }
  .pop-rom-text { font-size: 13px; color: var(--wkr-muted); }
  .pop-tts { width: 28px; height: 28px; }
  .pop-tts:hover { color: var(--wkr-accent-strong); }
  .pop-trans { font-size: 16px; font-weight: 600; color: var(--wkr-text); line-height: 1.4; }
  .pop-inf { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; }
  .pop-inf .label, .pop-form .label { display: inline; margin-right: 6px; }
  .pop-inf b { color: var(--wkr-text); font-weight: 700; }
  .pop-tts-inf { width: 26px; height: 26px; margin-left: -4px; }
  .pop-form { font-size: 13px; color: var(--wkr-text); }
  .pop-meanings-wrap { display: flex; flex-direction: column; gap: 4px; }
  .pop-meanings { margin: 0; padding-left: 18px; color: var(--wkr-muted); font-size: 13px; line-height: 1.5; }
  .pop-example {
    background: var(--wkr-surface); border: 1px solid var(--wkr-border); border-radius: 12px;
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
  }
  .pop-example-ko { font-size: 14px; line-height: 1.6; color: var(--wkr-text); word-break: keep-all; }
  .pop-hl { padding: 0 2px; border-radius: 3px; font-weight: 700; }
  .pop-example-en { font-size: 13px; color: var(--wkr-muted); line-height: 1.5; }
  .pop-flash.done { --fill: var(--wkr-celadon); --edge: var(--wkr-celadon-strong); color: #fff; }
  .pop-flash.warn { --fill: var(--wkr-bg); --edge: var(--wkr-error); color: var(--wkr-error-strong); }
  .pop-naver {
    display: flex; align-items: center; gap: 6px;
    color: var(--wkr-muted); text-decoration: none; font-size: 13px;
    padding-top: 10px; border-top: 1px solid var(--wkr-border); border-radius: 0;
  }
  .pop-naver:hover { color: var(--wkr-accent-strong); text-decoration: underline; }
`;
