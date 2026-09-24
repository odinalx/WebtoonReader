import { SITE_URL } from './config';
import { getSettings } from './settings';
import { fetchAccount, SiteApiError } from './site';

// Access: scanning needs a valid Sori token on an account with a plan. There
// is no free tier (the way in is a cheap first month), so a valid token on an
// account without a plan is locked with `not-subscribed`. The verdict is
// cached in storage so we don't hit the site on every scan; a short offline
// grace period keeps a flaky connection from locking a user out mid-session.

export type AccessReason = 'no-token' | 'invalid-token' | 'not-subscribed' | 'offline';

export interface AccessState {
  ok: boolean;
  reason?: AccessReason;
  email?: string;
  plan?: string;
  /** True on a paid plan. Without one the extension stays locked. */
  subscribed?: boolean;
  checkedAt: number; // when the site last gave a definitive answer
}

const CACHE_KEY = 'accessState';
const FRESH_MS = 10 * 60 * 1000; // trust a cached verdict this long
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000; // stay unlocked offline this long

async function readCache(): Promise<AccessState | null> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as AccessState | undefined) ?? null;
}

async function writeCache(state: AccessState): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: state });
}

/** Check (with caching) whether the extension is unlocked. */
export async function getAccess(force = false): Promise<AccessState> {
  const settings = await getSettings();
  const token = settings.siteToken.trim();
  if (!token) return { ok: false, reason: 'no-token', checkedAt: Date.now() };

  const cached = await readCache();
  if (!force && cached && Date.now() - cached.checkedAt < FRESH_MS) return cached;

  try {
    const account = await fetchAccount(token);
    const state: AccessState = account.subscribed
      ? {
          ok: true,
          email: account.email,
          plan: account.plan,
          subscribed: true,
          checkedAt: Date.now(),
        }
      : {
          ok: false,
          reason: 'not-subscribed',
          email: account.email,
          plan: 'none',
          subscribed: false,
          checkedAt: Date.now(),
        };
    await writeCache(state);
    return state;
  } catch (e) {
    if (e instanceof SiteApiError && e.status === 401) {
      const state: AccessState = { ok: false, reason: 'invalid-token', checkedAt: Date.now() };
      await writeCache(state);
      return state;
    }
    // Network problem (or the site is down): honour the last definitive OK for
    // a while, otherwise report we're locked because we can't verify.
    if (cached?.ok && Date.now() - cached.checkedAt < OFFLINE_GRACE_MS) return cached;
    return { ok: false, reason: 'offline', checkedAt: cached?.checkedAt ?? 0 };
  }
}

/** Human message shown in the result panel / popup when locked. */
export function lockMessage(state: AccessState): string {
  switch (state.reason) {
    case 'no-token':
      return `Connecte ton compte Sori\u00a0: crée un jeton d'accès sur ${SITE_URL}/account, puis colle-le dans les réglages de l'extension.`;
    case 'invalid-token':
      return `Ton jeton d'accès a été refusé. Crées-en un nouveau sur ${SITE_URL}/account et colle-le dans les réglages de l'extension.`;
    case 'not-subscribed':
      return `Scanner fait partie de l'abonnement Sori. Le premier mois est à 3,99\u00a0€\u00a0: ${SITE_URL}/pricing`;
    case 'offline':
      return `Impossible de vérifier ton abonnement (site injoignable). Vérifie ta connexion et réessaie.`;
    default:
      return `Sori est verrouillé. Connecte-toi sur ${SITE_URL} et vérifie ton abonnement.`;
  }
}

/** Why the website deck is closed to this account, or null when it is open. */
export function deckLock(state: AccessState): AccessState | null {
  if (!state.ok) return state;
  if (!state.subscribed) return { ...state, ok: false, reason: 'not-subscribed' };
  return null;
}
