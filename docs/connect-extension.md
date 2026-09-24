# One-click connect: the `/connect-extension` contract

The extension no longer asks people to copy an API token by hand. Its
"Connecter mon compte" button opens `${SITE_URL}/connect-extension` on the
site. That page mints a token for the signed-in account and hands it to the
extension with `window.postMessage`. This file is the whole contract, so the
page can be built without reading the extension's code.

## Where it runs

The extension declares a content script (`entrypoints/connect.content.ts`)
matching only `${SITE_URL}/connect-extension*`, where `SITE_URL` is the
origin baked in at build time from `WXT_SITE_URL` (`https://dokhae.fr` in
production, `http://localhost:3000` for a local build). It runs at
`document_end`. Nothing of the extension runs on any other page of the site.

## Messages

All messages go through `window.postMessage` on the page's own window, with
the site origin as `targetOrigin`. Both sides ignore anything that does not
match exactly.

### 1. Extension to page, on load: `DOKHAE_PRESENT`

```js
{ source: "dokhae-extension", type: "DOKHAE_PRESENT", version: "1.0.0" }
```

Posted once, as soon as the content script runs. If the page has not seen it
(say 1.5 s after load), assume the extension is not installed (or is an old
version) and show a link to the Chrome Web Store instead of the button. Since
the content script runs at `document_end`, register the listener in a script
that runs before that (inline in the HTML, or early in the bundle), or the
notice can be missed. The page can also just send `DOKHAE_CONNECT` and treat
the absence of a reply as "not installed".

### 2. Page to extension: `DOKHAE_CONNECT`

```js
window.postMessage(
  { source: "dokhae-site", type: "DOKHAE_CONNECT", token: "sori_…" },
  location.origin,
)
```

- `token` must match `/^sori_[A-Za-z0-9_-]{20,}$/`, otherwise the message is
  ignored (no reply).
- The extension only accepts it when `event.source === window` and
  `event.origin` is the site origin, so posting from an iframe does not work.
- Send it after a user action (a "Connecter" button click), and only for a
  signed-in account. Minting a fresh token per connect is fine; the site's
  token list then shows it as a device.

### 3. Extension to page: `DOKHAE_CONNECTED`

```js
{
  source: "dokhae-extension",
  type: "DOKHAE_CONNECTED",
  ok: true | false,
  email?: "someone@example.com",  // when ok
  subscribed?: true | false,       // when ok: false means show pricing
  error?: "invalid_token" | "network" | "internal"  // when not ok
}
```

Before replying, the extension calls `GET /api/me` with the token. Only a
token the API accepts replaces the stored one, so a failed connect never
signs a working install out.

| `error` | Meaning | Suggested copy |
|---|---|---|
| `invalid_token` | `/api/me` answered 401 | "Ce jeton a été refusé. Réessaie." |
| `network` | the extension could not reach the API | "Impossible de joindre Dokhae. Vérifie ta connexion." |
| `internal` | anything else (extension updated under the page, …) | "Recharge la page et réessaie." |

On `ok: true`, the page can say "Extension connectée à {email}" and, when
`subscribed` is false, point to `/pricing` (scanning needs a plan). The
popup and the options page pick the new token up on their own.

## Minimal page script

```js
const ORIGIN = location.origin
let present = false
addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== ORIGIN) return
  const d = e.data
  if (d?.source !== "dokhae-extension") return
  if (d.type === "DOKHAE_PRESENT") present = true
  if (d.type === "DOKHAE_CONNECTED") render(d)
})

async function connect() {
  const { token } = await fetch("/api/tokens", { method: "POST" }).then((r) => r.json())
  postMessage({ source: "dokhae-site", type: "DOKHAE_CONNECT", token }, ORIGIN)
}
```

(`/api/tokens` stands for whatever endpoint mints a token for the session.)

## Security notes

- The token only travels inside the page's own window, and the page is on the
  site origin, which already holds the account session.
- The background re-checks that the message came from the connect content
  script on the connect page (`sender.url`) before storing anything.
- The match pattern is on the site origin, which is already a host permission
  of the extension, so this feature adds no permission warning at install.
