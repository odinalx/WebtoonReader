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
        d="M20.67 49V42.97H30.56Q33.44 42.97 35.35 41.71Q37.25 40.45 38.23 38.03Q39.21 35.61 39.21 32.1Q39.21 29.22 38.59 27.13Q37.98 25.05 36.77 23.71Q35.55 22.37 33.73 21.7Q31.9 21.03 29.42 21.03H20.67V15H29.17Q35.35 15 39.26 17.01Q43.18 19.02 45.03 22.75Q46.89 26.49 46.89 31.69Q46.89 35.61 45.96 38.49Q45.03 41.38 43.46 43.38Q41.89 45.39 39.83 46.63Q37.77 47.87 35.45 48.43Q33.13 49 30.76 49ZM17.11 49V15H24.53V49Z"
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
      // The background injects Dokhae into the tab (activeTab, granted by
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
          <span className="brand-name">Dokhae</span>
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
            Impossible de joindre Dokhae pour vérifier ton abonnement. Vérifie ta connexion.
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
            ou sélectionne du coréen et fais un clic droit, «&nbsp;Analyser avec Dokhae&nbsp;»
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
