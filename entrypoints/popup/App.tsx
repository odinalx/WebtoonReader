import { useEffect, useState } from 'react';
import type { ExtensionMessage } from '../../src/types';

type Status = 'idle' | 'activating' | 'error';

interface AccessView {
  ok: boolean;
  reason?: string;
  email?: string;
  plan?: string;
  siteUrl: string;
}

export function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  // null = still checking; the scan button stays enabled meanwhile so a warm
  // cache never blocks a paying user.
  const [access, setAccess] = useState<AccessView | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = (await browser.runtime.sendMessage({
          type: 'ACCESS_CHECK',
        } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
        if (resp && resp.type === 'ACCESS_INFO') {
          setAccess({
            ok: resp.ok, reason: resp.reason, email: resp.email,
            plan: resp.plan, siteUrl: resp.siteUrl,
          });
        }
      } catch {
        /* background not ready — leave the button usable; scans re-check anyway */
      }
    })();
  }, []);

  const startScan = async () => {
    setStatus('activating');
    setError('');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');
      await browser.tabs.sendMessage(tab.id, { type: 'ACTIVATE_SCAN' } satisfies ExtensionMessage);
      window.close();
    } catch (e) {
      const msg = String(e);
      // Content script not yet injected (page loaded before extension)
      if (msg.includes('Could not establish connection')) {
        setError('Reload the page first, then try again.');
      } else {
        setError(msg);
      }
      setStatus('error');
    }
  };

  return (
    <div className="app">
      <div className="logo">
        <svg viewBox="0 0 128 128" width="56" height="56">
          <circle cx="64" cy="64" r="64" fill="#00c73c" />
          <text x="64" y="68" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif"
            fontSize={84} fontWeight="bold" textAnchor="middle" dominantBaseline="central">W</text>
        </svg>
      </div>
      <h1 className="title">Korean Reader</h1>
      <p className="sub">Scan a webtoon speech bubble — or select any Korean text and right-click "Analyze with Korean Reader".</p>

      {access && !access.ok ? (
        <div className="paywall">
          <div className="paywall-title">🔒 Subscription required</div>
          <p className="paywall-text">
            {access.reason === 'no-token' &&
              'Korean Reader now works with a Sori account. Subscribe on the website, then paste your access token in the settings.'}
            {access.reason === 'invalid-token' &&
              'Your access token was rejected. Create a new one on your Sori account page.'}
            {access.reason === 'not-subscribed' &&
              `${access.email ? access.email + ' has' : 'Your account has'} no active plan. Subscribe to unlock the extension.`}
            {access.reason === 'offline' &&
              'Could not reach the Sori site to verify your subscription. Check your connection.'}
          </p>
          <div className="paywall-actions">
            <button
              className="scan-btn"
              onClick={() => browser.tabs.create({
                url: access.reason === 'invalid-token'
                  ? `${access.siteUrl}/account`
                  : `${access.siteUrl}/pricing`,
              })}
            >
              Open Sori website
            </button>
            <button className="settings-link" onClick={() => browser.runtime.openOptionsPage()}>
              Enter access token…
            </button>
          </div>
        </div>
      ) : (
      <button
        className="scan-btn"
        onClick={startScan}
        disabled={status === 'activating'}
      >
        {status === 'activating' ? (
          'Activating…'
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h2l1.5-2h7L19 5h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="13" cy="12" r="3.5" />
            </svg>
            Start Scanning
          </>
        )}
      </button>
      )}

      {status === 'error' && <div className="error">{error}</div>}

      <div className="hint">
        <strong>How to use:</strong>
        <ol>
          <li>Open a webtoon page</li>
          <li>Click "Start Scanning"</li>
          <li>Drag over a speech bubble</li>
          <li>Click words to look them up</li>
        </ol>
      </div>

      <button className="settings-link" onClick={() => browser.runtime.openOptionsPage()}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Settings
      </button>
    </div>
  );
}
