import { SITE_URL } from './config';
import { romanize } from './romanize';
import type { AnalysisResult, AnkiCardDraft } from './types';

// Client for the Sori website's extension API (see the site's src/routes/api).
// Auth is a personal bearer token ("sori_…") the user creates on /account.

export interface SiteAccount {
  email: string;
  name: string;
  plan: string;
  subscribed: boolean;
}

// Error carrying the HTTP status + the site's machine-readable `error` code
// ("subscription_required", …) so callers can react to specific failures.
export class SiteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

async function request(token: string, path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${SITE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new SiteApiError(`Could not reach ${SITE_URL}. Is the site up?`, 0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const message =
      typeof body.message === 'string' ? body.message
      : typeof body.error === 'string' ? body.error
      : `Sori API error (HTTP ${res.status})`;
    throw new SiteApiError(message, res.status, code);
  }
  return body;
}

/** GET /api/me — validates the token and reports the subscription state. */
export async function fetchAccount(token: string): Promise<SiteAccount> {
  const body = (await request(token, '/api/me')) as Partial<SiteAccount>;
  return {
    email: String(body.email ?? ''),
    name: String(body.name ?? ''),
    plan: String(body.plan ?? 'none'),
    subscribed: Boolean(body.subscribed),
  };
}

/**
 * POST /api/analyze — Korean text in, analysed words out.
 *
 * This pipeline (Kiwi segmentation + translation + grammar) used to run
 * locally: Kiwi's wasm in a sandboxed iframe, driven from the offscreen
 * document. It moved to the server so the mobile app and this extension share
 * one implementation — and so the ~84 MB Kiwi model ships once, not with every
 * copy of the extension.
 *
 * OCR stays local. It's free, offline, and Tesseract is good at the crisp
 * rendered text of a webtoon panel.
 */
export async function analyzeOnSite(token: string, text: string): Promise<AnalysisResult> {
  const body = (await request(token, '/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })) as Partial<AnalysisResult>;
  return {
    text: String(body.text ?? ''),
    sentenceTranslation: String(body.sentenceTranslation ?? ''),
    tone: String(body.tone ?? ''),
    words: Array.isArray(body.words) ? body.words : [],
  };
}

// Shape POSTed to /api/cards (the site's WordInput schema).
function toWordInput(card: AnkiCardDraft) {
  const term = (card.base || card.infinitive || card.word).trim().slice(0, 60);
  const translation =
    dedupe([card.wordTranslation, ...card.meanings]).join('; ').slice(0, 200) || term;
  return {
    term,
    reading: romanize(term),
    translation,
    example: card.sentence,
    exampleTranslation: card.sentenceTranslation,
    source: card.source || 'Webtoon Korean Reader',
  };
}

/** POST /api/cards — save one captured word into the user's Sori deck. */
export async function sendCardToSite(
  token: string,
  card: AnkiCardDraft
): Promise<'added' | 'exists'> {
  const body = (await request(token, '/api/cards', {
    method: 'POST',
    body: JSON.stringify(toWordInput(card)),
  })) as { status?: string };
  return body.status === 'exists' ? 'exists' : 'added';
}

export interface SiteSendResult {
  addedIds: string[]; // draft ids accepted by the site (incl. duplicates)
  failed: number;
  failures: string[]; // "word: reason" for each failure
}

/** Send a batch of queued cards to the site; mirrors sendCardsToAnki's shape. */
export async function sendCardsToSite(
  token: string,
  cards: AnkiCardDraft[]
): Promise<SiteSendResult> {
  const addedIds: string[] = [];
  const failures: string[] = [];
  for (const card of cards) {
    try {
      await sendCardToSite(token, card);
      addedIds.push(card.id);
    } catch (e) {
      failures.push(`${card.word}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { addedIds, failed: failures.length, failures };
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
