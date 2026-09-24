import { useCallback, useEffect, useState } from 'react';
import type { ExtensionMessage } from '../../src/types';

type Status = 'idle' | 'activating' | 'error';

interface AccessView {
  ok: boolean;
  reason?: string;
  email?: string;
  plan?: string;
  subscribed?: boolean;
  siteUrl: string;
}

const PLAN_NAMES: Record<string, string> = {
  monthly: 'mensuel',
  yearly: 'annuel',
  lifetime: 'à vie',
};

/** The site's mark: blue tile, an S drawn as a path (same file as the icon). */
function Logo() {
  return (
    <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2f4bd8" />
      <path
        fill="#f4f1e9"
        d="M32.03 50Q28.62 50 25.93 49.35Q23.24 48.69 21.33 47.36Q19.42 46.02 18.34 44.01Q17.27 41.99 17.11 39.38L23.71 37.23Q23.81 39.59 24.88 41.16Q25.96 42.73 27.94 43.46Q29.93 44.19 32.39 44.19Q34.75 44.19 36.37 43.62Q37.99 43.04 38.83 42.07Q39.67 41.1 39.67 39.95Q39.67 38.59 38.62 37.76Q37.57 36.92 35.77 36.34Q33.96 35.77 31.66 35.24Q29.1 34.67 26.61 33.94Q24.12 33.2 22.11 32.05Q20.1 30.9 18.92 29.07Q17.74 27.24 17.74 24.47Q17.74 21.27 19.34 18.94Q20.93 16.62 24.02 15.31Q27.11 14 31.45 14Q35.85 14 38.96 15.28Q42.07 16.56 43.8 18.89Q45.53 21.22 45.68 24.41L38.88 26.3Q38.88 24.67 38.36 23.47Q37.83 22.27 36.89 21.46Q35.95 20.65 34.56 20.23Q33.18 19.81 31.4 19.81Q29.36 19.81 27.87 20.33Q26.38 20.85 25.62 21.74Q24.86 22.63 24.86 23.84Q24.86 25.25 26.03 26.17Q27.21 27.08 29.17 27.66Q31.14 28.23 33.49 28.76Q35.74 29.23 38.07 29.93Q40.4 30.64 42.41 31.76Q44.43 32.89 45.66 34.8Q46.89 36.71 46.89 39.59Q46.89 42.73 45.21 45.08Q43.54 47.44 40.22 48.72Q36.89 50 32.03 50Z"
      />
    </svg>
  );
}

export function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  // null = still checking; the scan button stays enabled meanwhile so a warm
  // cache never blocks a paying user.
  const [access, setAccess] = useState<AccessView | null>(null);

  const check = useCallback(async () => {
    try {
      const resp = (await browser.runtime.sendMessage({
        type: 'ACCESS_CHECK',
        // Fresh every time: someone who just paid should not wait for the cache.
        force: true,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp && resp.type === 'ACCESS_INFO') {
        setAccess({
          ok: resp.ok, reason: resp.reason, email: resp.email,
          plan: resp.plan, subscribed: resp.subscribed, siteUrl: resp.siteUrl,
        });
      }
    } catch {
      /* background not ready: leave the button usable, scans re-check anyway */
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const open = (path: string) => {
    if (access) void browser.tabs.create({ url: `${access.siteUrl}${path}` });
  };

  const startScan = async () => {
    setStatus('activating');
    setError('');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Aucun onglet actif.');
      // The background injects Sori into the tab (activeTab, granted by
      // opening this popup) and opens the scan overlay.
      const resp = (await browser.runtime.sendMessage({
        type: 'START_SCAN',
        tabId: tab.id,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp?.type === 'START_SCAN_DONE' && resp.ok) {
        window.close();
        return;
      }
      throw new Error(
        resp?.type === 'START_SCAN_DONE' && resp.message
          ? resp.message
          : "L'extension ne répond pas. Réessaie.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  const locked = access && !access.ok;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo />
          <span className="brand-name">Sori</span>
        </div>
        {access?.ok && access.plan ? (
          <span className="plan-chip">{PLAN_NAMES[access.plan] ?? access.plan}</span>
        ) : null}
      </header>

      {locked && access.reason === 'not-subscribed' ? (
        <section className="card">
          <h1 className="card-title">Premier mois à 2,99&nbsp;€</h1>
          <p className="card-text">
            Scanner fait partie de l'abonnement, qui débloque aussi la lecture sur le site
            et tes cartes. Le premier mois à 2,99&nbsp;€ est réservé aux nouveaux comptes.
          </p>
          <button className="btn btn-primary" onClick={() => open('/pricing')}>
            Voir les formules
          </button>
          <button className="btn-link" onClick={() => void check()}>
            Déjà abonné&nbsp;? Actualiser
          </button>
        </section>
      ) : locked && (access.reason === 'no-token' || access.reason === 'invalid-token') ? (
        <section className="card">
          <h1 className="card-title">
            {access.reason === 'no-token' ? 'Connecte ton compte' : 'Jeton refusé'}
          </h1>
          <p className="card-text">
            {access.reason === 'no-token'
              ? "Crée un jeton d'accès sur ta page Compte, puis colle-le dans les réglages de l'extension."
              : "Ce jeton ne marche plus. Crées-en un nouveau sur ta page Compte et colle-le dans les réglages."}
          </p>
          <button className="btn btn-primary" onClick={() => open('/account')}>
            Ouvrir mon compte
          </button>
          <button className="btn btn-quiet" onClick={() => browser.runtime.openOptionsPage()}>
            Coller mon jeton
          </button>
        </section>
      ) : locked ? (
        <section className="card">
          <h1 className="card-title">Hors connexion</h1>
          <p className="card-text">
            Impossible de joindre Sori pour vérifier ton abonnement. Vérifie ta connexion.
          </p>
          <button className="btn btn-quiet" onClick={() => void check()}>
            Réessayer
          </button>
        </section>
      ) : (
        <>
          <button
            className="btn btn-primary btn-big"
            onClick={startScan}
            disabled={status === 'activating'}
          >
            {status === 'activating' ? (
              'Activation…'
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
                </svg>
                Scanner une bulle
              </>
            )}
          </button>
          <p className="or">
            ou sélectionne du coréen et fais un clic droit, «&nbsp;Analyser avec Sori&nbsp;»
          </p>

          {status === 'error' && <div className="error">{error}</div>}

          <ol className="steps">
            <li><span>1</span>Ouvre un webtoon</li>
            <li><span>2</span>Encadre une bulle</li>
            <li><span>3</span>Clique un mot, garde-le dans ton deck</li>
          </ol>
        </>
      )}

      <footer className="bottom">
        <button className="btn-link" onClick={() => browser.runtime.openOptionsPage()}>
          Réglages
        </button>
        <span aria-hidden="true">·</span>
        <button className="btn-link" onClick={() => open('/deck')} disabled={!access}>
          Mon deck
        </button>
      </footer>
    </div>
  );
}
