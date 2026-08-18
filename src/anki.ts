import type { AnkiCardDraft, Settings } from './types';

// Talks to the AnkiConnect add-on (https://foosoft.net/projects/anki-connect/),
// which exposes a small JSON-RPC API on http://127.0.0.1:8765 while desktop
// Anki is open. We use it to (auto-)create a structured "Korean Reader" note
// type, store pronunciation audio as media files, and add notes.

// Note type we create and own. Fields mirror the user's deck layout minus the
// Vocab-Pro / Vocab-Hanja / Vocab-Topik fields.
// NOT renamed with the rest of the extension. This string is the note type's
// identifier inside the user's own Anki collection: changing it would make the
// extension create a second, empty type and leave every card already exported
// attached to the old one. The name people see is Sori; this is a key.
const MODEL = 'Korean Reader';
const FIELDS = [
  'Vocab',
  'Vocab-English',
  'Vocab-Sound',
  'Vocab-Dic1',
  'Vocab-Dic2',
  'Vocab-Dic3',
  'Vocab-Dic4',
  'Sentence',
  'Sentence-English',
  'Sentence-Sound',
];

interface AnkiConnectResponse {
  result: unknown;
  error: string | null;
}

async function invoke<T = unknown>(url: string, action: string, params: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch {
    throw new Error(
      'Could not reach Anki. Open desktop Anki with the AnkiConnect add-on installed.'
    );
  }
  if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
  const data = (await res.json()) as AnkiConnectResponse;
  if (data.error) throw new Error(data.error);
  return data.result as T;
}

export interface AnkiSendResult {
  addedIds: string[];   // draft ids that made it into Anki
  failed: number;
  failures: string[];   // "word: reason" for each failure
}

// Send a batch of cards to Anki, resolving pronunciation audio for each via the
// supplied callback (which returns a data: URL, or null when audio is unavailable).
export async function sendCardsToAnki(
  settings: Settings,
  cards: AnkiCardDraft[],
  resolveAudio: (text: string) => Promise<string | null>
): Promise<AnkiSendResult> {
  const url = (settings.ankiConnectUrl || 'http://127.0.0.1:8765').trim();
  const deck = settings.ankiDeck.trim() || 'Sori';

  // Fails fast (and clearly) if Anki / AnkiConnect isn't reachable.
  await invoke(url, 'version', {});
  await invoke(url, 'createDeck', { deck });
  await ensureModel(url);

  const addedIds: string[] = [];
  const failures: string[] = [];

  for (const card of cards) {
    try {
      await addOneCard(url, deck, card, resolveAudio);
      addedIds.push(card.id);
    } catch (e) {
      failures.push(`${card.word}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { addedIds, failed: failures.length, failures };
}

const CARD = 'Recognition';

// Create the "Korean Reader" note type the first time we need it, and keep its
// template + styling in sync with the extension on every send (so changes here
// reach an already-created model — AnkiConnect's createModel is create-only).
async function ensureModel(url: string): Promise<void> {
  const names = await invoke<string[]>(url, 'modelNames', {});

  if (!names.includes(MODEL)) {
    await invoke(url, 'createModel', {
      modelName: MODEL,
      inOrderFields: FIELDS,
      css: MODEL_CSS,
      isCloze: false,
      cardTemplates: [{ Name: CARD, Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE }],
    });
    return;
  }

  // Model already exists — refresh its look so our latest design applies.
  await invoke(url, 'updateModelStyling', { model: { name: MODEL, css: MODEL_CSS } });
  const templates = await invoke<Record<string, unknown>>(url, 'modelTemplates', {
    modelName: MODEL,
  });
  const cardName = Object.keys(templates)[0] ?? CARD;
  await invoke(url, 'updateModelTemplates', {
    model: { name: MODEL, templates: { [cardName]: { Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE } } },
  });
}

async function addOneCard(
  url: string,
  deck: string,
  card: AnkiCardDraft,
  resolveAudio: (text: string) => Promise<string | null>
): Promise<void> {
  // The Vocab field + dictionary links + word audio use the NORMAL form (드롭
  // particles/politeness): 사과를→사과, 허락하다니→허락하다. The Sentence keeps the
  // original phrase and highlights the surface word that actually appears there.
  const normal = card.base || card.infinitive || card.word;
  const dq = encodeURIComponent(normal);

  const gloss = dedupe([card.wordTranslation, ...card.meanings]).join('; ');

  const wordSound = await storeAudio(url, resolveAudio, normal, 'w');
  const sentSound = card.sentence
    ? await storeAudio(url, resolveAudio, card.sentence, 's')
    : '';

  const fields: Record<string, string> = {
    Vocab: esc(normal),
    'Vocab-English': esc(gloss),
    'Vocab-Sound': wordSound,
    'Vocab-Dic1': `https://ko.dict.naver.com/#/search?range=all&query=${dq}`,
    'Vocab-Dic2': `https://korean.dict.naver.com/koendict/#/search?range=all&query=${dq}`,
    'Vocab-Dic3': `https://dic.daum.net/search.do?q=${dq}`,
    'Vocab-Dic4': `https://krdict.korean.go.kr/eng/dicSearch/search?nation=eng&nationCode=6&ParaWordNo=&mainSearchWord=${dq}`,
    Sentence: card.sentence ? highlight(card.sentence, card.word) : '',
    'Sentence-English': esc(card.sentenceTranslation),
    'Sentence-Sound': sentSound,
  };

  await invoke(url, 'addNote', {
    note: {
      deckName: deck,
      modelName: MODEL,
      fields,
      options: { allowDuplicate: true },
      tags: ['korean-reader'],
    },
  });
}

// Resolve + store audio for `text`, returning the `[sound:...]` tag (or '' if none).
async function storeAudio(
  url: string,
  resolveAudio: (text: string) => Promise<string | null>,
  text: string,
  kind: 'w' | 's'
): Promise<string> {
  let dataUrl: string | null = null;
  try {
    dataUrl = await resolveAudio(text);
  } catch {
    dataUrl = null;
  }
  if (!dataUrl) return '';

  const filename = `kr_${kind}_${rand()}.mp3`;
  await invoke(url, 'storeMediaFile', { filename, data: stripDataUrl(dataUrl) });
  return `[sound:${filename}]`;
}

// Wrap occurrences of the vocab word inside the sentence with a highlight span.
function highlight(sentence: string, word: string): string {
  const s = esc(sentence);
  const w = esc(word);
  if (!w) return s;
  return s.split(w).join(`<span class="hl">${w}</span>`);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Card template (front = word; back = meaning, audio, dictionaries, sentence)
// ---------------------------------------------------------------------------

const FRONT_TEMPLATE = `<table style="margin-left: auto; margin-right: auto"><tbody><tr><td><div style='font-family: nanumgothic; font-size: 6vw;'>{{Vocab}}</div></td><td><div style='font-family: nanummyeonjo; font-size: 6vw;'>{{Vocab}}</div></td></tr><tr><td><div style='font-family: nanumgothic; font-size: 12px;'>{{Vocab}}</div></td><td><div style='font-family: nanumpenscript; font-size: 7vw;'>{{Vocab}}</div></td></tr></tbody></table>`;

const BACK_TEMPLATE = `{{FrontSide}}
<br>
<hr id=answer>
<br>
{{Vocab-English}}
<br>

<div style='font-family: arial; font-size: 12px;'>Sentence</div>

{{#Sentence}}
<div style='font-family: nanumgothic; font-size: 17px; padding-top: 4px'>{{Sentence}}</div>
<div style='font-family: nanumgothic; font-size: 11px;'></div>
<div style='font-family: arial; font-size: 14px; padding-top: 10px'>{{Sentence-English}}</div>
{{/Sentence}}
{{^Sentence}}
<div style='font-family: nanumgothic; font-size: 20px; padding: 5px'>-</div>
{{/Sentence}}

<br>

<div style='font-size: 12px'><a href="{{Vocab-Dic1}}">Naver KR</a> | <a href="{{Vocab-Dic2}}">Naver KR-EN</a> | <a href="{{Vocab-Dic3}}">Daum</a> | <a href="{{Vocab-Dic4}}">NIKL KR-EN</a></div>

<br>

{{Vocab-Sound}}{{Sentence-Sound}}`;

const MODEL_CSS = `.card {
 font-family: arial;
 font-size: 20px;
 text-align: center;
 color: white;
 background-color: black;
}
td {
    padding: 15px;
}
a:link, a:visited, a:active {
  color: cyan;
}
.hl {
  color: #ff7043;
  font-weight: bold;
}
@font-face {
  font-family: nanumgothic;
  src: url("_NanumGothic-Regular.ttf");
}
@font-face {
  font-family: nanummyeonjo;
  src: url("_NanumMyeongjo-Regular.ttf");
}
@font-face {
  font-family: nanumpenscript;
  src: url("_NanumPenScript-Regular.ttf");
}`;
