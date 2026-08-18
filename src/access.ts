import { SITE_URL } from './config';
import { getSettings } from './settings';
import { fetchAccount, SiteApiError } from './site';

// Paywall: the extension only works with a valid Sori token attached to a
// subscribed account. The verdict is cached in storage so we don't hit the
// site on every scan; a short offline grace period keeps a flaky connection
// from locking a paying user out mid-session.

export type AccessReason = 'no-token' | 'invalid-token' | 'not-subscribed' | 'offline';

export interface AccessState {
  ok: boolean;
  reason?: AccessReason;
  email?: string;
  plan?: string;
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
      ? { ok: true, email: account.email, plan: account.plan, checkedAt: Date.now() }
      : {
          ok: false,
          reason: 'not-subscribed',
          email: account.email,
          plan: account.plan,
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
      return `Sori requires a subscription. Create an account at ${SITE_URL}, subscribe, then paste your access token in the extension settings.`;
    case 'invalid-token':
      return `Your Sori access token was rejected. Create a new one at ${SITE_URL}/account and paste it in the extension settings.`;
    case 'not-subscribed':
      return `Your Sori account has no active subscription. Pick a plan at ${SITE_URL}/pricing to unlock the extension.`;
    case 'offline':
      return `Could not verify your Sori subscription (site unreachable). Check your connection and try again.`;
    default:
      return `Sori is locked. Sign in on ${SITE_URL} and check your subscription.`;
  }
}
