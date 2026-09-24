import { SITE_URL } from './config';
import { getSettings } from './settings';
import { fetchAccount, SiteApiError } from './site';

// Access: scanning needs a valid Sori token. Free accounts scan too, on a
// daily allowance the site enforces (it answers free_limit_reached once it is
// spent); only the website deck requires a plan. The verdict is cached in
// storage so we don't hit the site on every scan; a short offline grace period
// keeps a flaky connection from locking a user out mid-session.

export type AccessReason = 'no-token' | 'invalid-token' | 'not-subscribed' | 'offline';

export interface AccessState {
  ok: boolean;
  reason?: AccessReason;
  email?: string;
  plan?: string;
  /** True on a paid plan: unlimited scans and the website deck. */
  subscribed?: boolean;
  freeScansLeft?: number;
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
    const state: AccessState = {
      ok: true,
      email: account.email,
      plan: account.subscribed ? account.plan : 'free',
      subscribed: account.subscribed,
      freeScansLeft: account.freeScansLeft,
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
      return `Sori needs a free account. Sign up at ${SITE_URL}, then paste your access token in the extension settings.`;
    case 'invalid-token':
      return `Your Sori access token was rejected. Create a new one at ${SITE_URL}/account and paste it in the extension settings.`;
    case 'not-subscribed':
      return `Saving words to your Sori deck is part of the paid plan. Upgrade at ${SITE_URL}/pricing; your words wait in the queue until then.`;
    case 'offline':
      return `Could not verify your Sori subscription (site unreachable). Check your connection and try again.`;
    default:
      return `Sori is locked. Sign in on ${SITE_URL} and check your subscription.`;
  }
}

/** Why the website deck is closed to this account, or null when it is open. */
export function deckLock(state: AccessState): AccessState | null {
  if (!state.ok) return state;
  if (!state.subscribed) return { ...state, ok: false, reason: 'not-subscribed' };
  return null;
}
