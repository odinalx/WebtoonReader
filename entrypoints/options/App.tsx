import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type ExtensionMessage, type Settings } from '../../src/types';
import { getSettings, saveSettings, hasVoiceCreds } from '../../src/settings';
import { SITE_URL } from '../../src/config';

interface AccessView {
  ok: boolean;
  reason?: string;
  email?: string;
  plan?: string;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [access, setAccess] = useState<AccessView | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
    void refreshAccess(false);
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  };

  const refreshAccess = async (force: boolean) => {
    setChecking(true);
    try {
      const resp = (await browser.runtime.sendMessage({
        type: 'ACCESS_CHECK', force,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp && resp.type === 'ACCESS_INFO') {
        setAccess({ ok: resp.ok, reason: resp.reason, email: resp.email, plan: resp.plan });
      }
    } catch {
      setAccess(null);
    }
    setChecking(false);
  };

  const onSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    // Re-verify with the (possibly new) token so the status badge is honest.
    void refreshAccess(true);
  };

  return (
    <div className="page">
      <h1>Korean Reader — Settings</h1>
      <p className="lead">
        Korean Reader requires a <strong>Sori</strong> subscription. Connect your account
        below; captured words are saved to your Sori deck (or to Anki if you prefer).
      </p>

      <section>
        <div className="sec-head">
          <h2>Sori account</h2>
          <AccessBadge access={access} checking={checking} />
        </div>
        <p className="hint">
          1. Create an account and subscribe at{' '}
          <a href={`${SITE_URL}/pricing`} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}</a>.{' '}
          2. On <a href={`${SITE_URL}/account`} target="_blank" rel="noreferrer">your account page</a>,
          create an <em>access token</em>. 3. Paste it here.
        </p>
        <label>
          Access token
          <input
            type="password"
            placeholder="sori_…"
            value={settings.siteToken}
            onChange={(e) => update({ siteToken: e.target.value })}
          />
        </label>
        <div className="actions">
          <button className="save" onClick={onSave} disabled={checking}>
            {checking ? 'Verifying…' : 'Save & verify'}
          </button>
        </div>
        {access && !access.ok && (
          <p className="hint warn-hint">
            {access.reason === 'no-token' && 'No token yet — the extension stays locked until you add one.'}
            {access.reason === 'invalid-token' && 'This token was rejected. Create a new one on your account page.'}
            {access.reason === 'not-subscribed' && (
              <>Your account has no active plan. <a href={`${SITE_URL}/pricing`} target="_blank" rel="noreferrer">Subscribe</a> to unlock the extension.</>
            )}
            {access.reason === 'offline' && 'Could not reach the Sori site to verify. Check your connection.'}
          </p>
        )}
      </section>

      <section>
        <div className="sec-head">
          <h2>Flashcards</h2>
        </div>
        <p className="hint">Where should “Add to flashcards” send words?</p>
        <label className="checkbox">
          <input
            type="radio"
            name="flashcard-target"
            checked={settings.flashcardTarget === 'site'}
            onChange={() => update({ flashcardTarget: 'site' })}
          />
          <strong>Sori website</strong> (default) — cards land in your online deck; study
          them anywhere at{' '}
          <a href={`${SITE_URL}/study`} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}/study</a>.
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="flashcard-target"
            checked={settings.flashcardTarget === 'anki'}
            onChange={() => update({ flashcardTarget: 'anki' })}
          />
          <strong>Anki desktop</strong> — send cards to Anki via the AnkiConnect add-on.
        </label>
      </section>

      {settings.flashcardTarget === 'anki' && (
        <section>
          <div className="sec-head">
            <h2>Anki setup</h2>
            <span className="badge on">AnkiConnect</span>
          </div>
          <p className="hint">
            Requires desktop Anki running with the free{' '}
            <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer">
              AnkiConnect
            </a>{' '}
            add-on. <strong>One-time setup:</strong> in Anki, open{' '}
            <em>Tools → Add-ons → AnkiConnect → Config</em> and add this extension's
            origin to <code>webCorsOriginList</code>:
          </p>
          <pre className="origin-box">
{`"webCorsOriginList": [
    "http://localhost",
    "${extensionOrigin}"
]`}
          </pre>
          <label>
            AnkiConnect URL
            <input
              type="text"
              placeholder="http://127.0.0.1:8765"
              value={settings.ankiConnectUrl}
              onChange={(e) => update({ ankiConnectUrl: e.target.value })}
            />
          </label>
          <label>
            Deck name
            <input
              type="text"
              placeholder="Korean Reader"
              value={settings.ankiDeck}
              onChange={(e) => update({ ankiDeck: e.target.value })}
            />
            <span className="field-hint">
              Cards use a “Korean Reader” note type that the extension creates
              automatically (Vocab, English, sound, 4 dictionaries, example sentence).
            </span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.ankiAutoSend}
              onChange={(e) => update({ ankiAutoSend: e.target.checked })}
            />
            Send each card to Anki immediately (otherwise they wait in a queue you flush with “Send all to Anki”).
          </label>
        </section>
      )}

      {SHOW_NAVER_CLOUD && (<>
      <section>
        <div className="sec-head">
          <h2>Clova Voice (pronunciation)</h2>
          <span className={hasVoiceCreds(settings) ? 'badge on' : 'badge'}>
            {hasVoiceCreds(settings) ? 'active' : 'using Google TTS'}
          </span>
        </div>
        <p className="hint">
          Naver Cloud → Services → <strong>Clova Voice (Premium)</strong>. Register an
          application, then copy its <em>API Key ID</em> and <em>API Key</em>.
        </p>
        <label>
          API Key ID
          <input
            type="text"
            placeholder="X-NCP-APIGW-API-KEY-ID"
            value={settings.voiceApiKeyId}
            onChange={(e) => update({ voiceApiKeyId: e.target.value })}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            placeholder="X-NCP-APIGW-API-KEY"
            value={settings.voiceApiKey}
            onChange={(e) => update({ voiceApiKey: e.target.value })}
          />
        </label>
        <label>
          Voice
          <select
            value={settings.voiceSpeaker}
            onChange={(e) => update({ voiceSpeaker: e.target.value })}
          >
            <option value="nara">nara (female)</option>
            <option value="nminyoung">nminyoung (female)</option>
            <option value="nyejin">nyejin (female)</option>
            <option value="njihun">njihun (male)</option>
            <option value="njinho">njinho (male)</option>
          </select>
        </label>
      </section>
      </>)}

      <div className="actions">
        <button className="save" onClick={onSave}>Save</button>
        {saved && <span className="saved-note">Saved ✓</span>}
      </div>
    </div>
  );
}

function AccessBadge({ access, checking }: { access: AccessView | null; checking: boolean }) {
  if (checking) return <span className="badge">checking…</span>;
  if (!access) return <span className="badge">unknown</span>;
  if (access.ok) {
    return (
      <span className="badge on">
        {access.email ? `${access.email} · ${access.plan}` : 'subscribed'}
      </span>
    );
  }
  return <span className="badge">locked</span>;
}

const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;

// Naver Clova Voice settings are set aside for now — the code stays but the UI
// is hidden. Flip to true to bring the section back.
const SHOW_NAVER_CLOUD = false;
