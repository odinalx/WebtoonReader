import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type ExtensionMessage, type Settings } from '../../src/types';
import { getSettings, saveSettings, hasVoiceCreds } from '../../src/settings';
import { fetchDecks, type SiteDeck } from '../../src/site';
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
  // The token as stored, not as typed: the deck list is fetched with it, and
  // refetching on every keystroke of a half-pasted token is pointless traffic.
  const [savedToken, setSavedToken] = useState('');

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setSavedToken(s.siteToken);
    });
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
    setSavedToken(settings.siteToken);
    // Re-verify with the (possibly new) token so the status badge is honest.
    void refreshAccess(true);
  };

  return (
    <div className="page">
      <header className="page-head">
        <span className="eyebrow">Dokhae · 독해</span>
        <h1>Réglages</h1>
        <p className="lead">
          Connecte ton compte Dokhae ci-dessous. Les mots que tu captures vont
          dans ton deck Dokhae (ou dans Anki, si tu préfères).
        </p>
      </header>

      <section>
        <div className="sec-head">
          <h2>Compte Dokhae</h2>
          <AccessBadge access={access} checking={checking} />
        </div>
        <ol className="steps hint">
          <li>
            Crée un compte gratuit sur{' '}
            <a href={`${SITE_URL}/login`} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}</a>.
          </li>
          <li>
            Sur <a href={`${SITE_URL}/account`} target="_blank" rel="noreferrer">ta page compte</a>,
            crée un <em>jeton d’accès</em>.
          </li>
          <li>Colle-le ici.</li>
        </ol>
        <label>
          <span className="field-label">Jeton d’accès</span>
          <input
            type="password"
            placeholder="sori_…"
            value={settings.siteToken}
            onChange={(e) => update({ siteToken: e.target.value })}
          />
        </label>
        <div className="actions">
          <button className="btn btn-primary" onClick={onSave} disabled={checking}>
            {checking ? 'Vérification…' : 'Enregistrer et vérifier'}
          </button>
        </div>
        {access && !access.ok && (
          <p className="hint warn-hint">
            {access.reason === 'no-token' && 'Aucun jeton pour l’instant. Crée un compte gratuit sur le site et colle ton jeton ici.'}
            {access.reason === 'invalid-token' && 'Ce jeton a été refusé. Crées-en un nouveau sur ta page compte.'}
            {access.reason === 'offline' && 'Impossible de joindre le site Dokhae pour vérifier. Vérifie ta connexion.'}
          </p>
        )}
      </section>

      <section>
        <div className="sec-head">
          <h2>Cartes</h2>
        </div>
        <p className="hint">Où envoyer les mots quand tu cliques sur « Ajouter au deck » ?</p>
        <label className="checkbox">
          <input
            type="radio"
            name="flashcard-target"
            checked={settings.flashcardTarget === 'site'}
            onChange={() => update({ flashcardTarget: 'site' })}
          />
          <span>
            <strong>Site Dokhae</strong> (par défaut)<br />
            Les cartes arrivent dans ton deck en ligne. Révise-les partout sur{' '}
            <a href={`${SITE_URL}/study`} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}/study</a>.
          </span>
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="flashcard-target"
            checked={settings.flashcardTarget === 'anki'}
            onChange={() => update({ flashcardTarget: 'anki' })}
          />
          <span>
            <strong>Anki (ordinateur)</strong><br />
            Envoie les cartes dans Anki via le module AnkiConnect.
          </span>
        </label>

        {settings.flashcardTarget === 'site' && (
          <DeckPicker
            token={savedToken}
            value={settings.soriDeckId}
            onChange={(soriDeckId) => update({ soriDeckId })}
          />
        )}
      </section>

      {settings.flashcardTarget === 'anki' && (
        <section>
          <div className="sec-head">
            <h2>Configuration d’Anki</h2>
            <span className="badge on">AnkiConnect</span>
          </div>
          <p className="hint">
            Anki doit être ouvert sur ton ordinateur avec le module gratuit{' '}
            <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer">
              AnkiConnect
            </a>. <strong>À faire une seule fois :</strong> dans Anki, ouvre{' '}
            <em>Outils → Modules → AnkiConnect → Configuration</em> et ajoute l’origine
            de l’extension à <code>webCorsOriginList</code> :
          </p>
          <pre className="origin-box">
{`"webCorsOriginList": [
    "http://localhost",
    "${extensionOrigin}"
]`}
          </pre>
          <label>
            <span className="field-label">Adresse d’AnkiConnect</span>
            <input
              type="text"
              placeholder="http://127.0.0.1:8765"
              value={settings.ankiConnectUrl}
              onChange={(e) => update({ ankiConnectUrl: e.target.value })}
            />
          </label>
          <label>
            <span className="field-label">Nom du deck</span>
            <input
              type="text"
              placeholder="Dokhae"
              value={settings.ankiDeck}
              onChange={(e) => update({ ankiDeck: e.target.value })}
            />
            <span className="field-hint">
              Les cartes utilisent un type de note « Korean Reader » que l’extension crée
              toute seule (mot, traduction, son, 4 dictionnaires, phrase d’exemple).
            </span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.ankiAutoSend}
              onChange={(e) => update({ ankiAutoSend: e.target.checked })}
            />
            <span>
              Envoyer chaque carte à Anki tout de suite (sinon elles attendent dans une file
              que tu vides avec « Tout envoyer vers Anki »).
            </span>
          </label>
        </section>
      )}

      {SHOW_NAVER_CLOUD && (<>
      <section>
        <div className="sec-head">
          <h2>Clova Voice (prononciation)</h2>
          <span className={hasVoiceCreds(settings) ? 'badge on' : 'badge'}>
            {hasVoiceCreds(settings) ? 'active' : 'Google TTS utilisé'}
          </span>
        </div>
        <p className="hint">
          Naver Cloud → Services → <strong>Clova Voice (Premium)</strong>. Enregistre une
          application, puis copie son <em>API Key ID</em> et son <em>API Key</em>.
        </p>
        <label>
          <span className="field-label">API Key ID</span>
          <input
            type="text"
            placeholder="X-NCP-APIGW-API-KEY-ID"
            value={settings.voiceApiKeyId}
            onChange={(e) => update({ voiceApiKeyId: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">API Key</span>
          <input
            type="password"
            placeholder="X-NCP-APIGW-API-KEY"
            value={settings.voiceApiKey}
            onChange={(e) => update({ voiceApiKey: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Voix</span>
          <select
            value={settings.voiceSpeaker}
            onChange={(e) => update({ voiceSpeaker: e.target.value })}
          >
            <option value="nara">nara (féminine)</option>
            <option value="nminyoung">nminyoung (féminine)</option>
            <option value="nyejin">nyejin (féminine)</option>
            <option value="njihun">njihun (masculine)</option>
            <option value="njinho">njinho (masculine)</option>
          </select>
        </label>
      </section>
      </>)}

      <div className="actions">
        <button className="btn btn-primary" onClick={onSave}>Enregistrer</button>
        {saved && <span className="saved-note" role="status">Réglages enregistrés</span>}
      </div>
    </div>
  );
}

function AccessBadge({ access, checking }: { access: AccessView | null; checking: boolean }) {
  if (checking) return <span className="badge">vérification…</span>;
  if (!access) return <span className="badge">inconnu</span>;
  if (access.ok) {
    return (
      <span className="badge on">
        {access.email ? `${access.email} · ${access.plan}` : access.plan}
      </span>
    );
  }
  return <span className="badge locked">verrouillé</span>;
}

/**
 * Which Dokhae deck captured words land in.
 *
 * The decks are the site's, so they're fetched rather than typed: a name typed
 * here would create nothing and file words nowhere. The list reloads whenever
 * the saved token changes, since without a valid token there is nothing to ask.
 */
function DeckPicker({
  token,
  value,
  onChange,
}: {
  token: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [decks, setDecks] = useState<SiteDeck[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const clean = token.trim();
    if (!clean) {
      setDecks(null);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setDecks(await fetchDecks(clean));
    } catch (e) {
      setDecks(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // A deck deleted on the site would otherwise fail silently: the server falls
  // back to the first deck, and words would quietly pile up somewhere else.
  const missing = Boolean(value) && decks !== null && !decks.some((d) => d.id === value);

  return (
    <label>
      <span className="field-label">Deck</span>
      <select
        value={missing ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || decks === null}
      >
        <option value="">
          {decks === null ? 'Connecte d’abord ton compte' : 'Premier deck (par défaut)'}
        </option>
        {(decks ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.count})
          </option>
        ))}
      </select>
      <span className="field-hint">
        {error
          ? `Impossible de charger tes decks${NB}: ${error}`
          : missing
            ? 'Le deck choisi n’existe plus. Les mots vont dans ton premier deck jusqu’à ce que tu en choisisses un autre.'
            : (
              <>
                Crée et renomme tes decks sur{' '}
                <a href={`${SITE_URL}/deck`} target="_blank" rel="noreferrer">
                  ta page deck
                </a>
                .{' '}
                <button type="button" className="linkish" onClick={() => void load()}>
                  Recharger
                </button>
              </>
            )}
      </span>
    </label>
  );
}

const NB = '\u00a0';

const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;

// Naver Clova Voice settings are set aside for now: the code stays but the UI
// is hidden. Flip to true to bring the section back.
const SHOW_NAVER_CLOUD = false;
