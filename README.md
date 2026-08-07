# Webtoon Korean Reader

A Chrome/Chromium extension that turns any Korean webtoon panel into a study tool.
Drag-select a speech bubble and it will:

- **OCR** the Korean text (bundled Tesseract `best` model — runs offline on your machine, no API keys),
- **translate** the sentence and break it into words **colored by part of speech**,
- give each word a **pronunciation** (audio), meanings, dictionary form, and **Naver dictionary** links,
- let you **save words to your Sori deck** (default) or **send them to Anki** as richly-formatted
  cards (word + audio + example sentence + audio), via the AnkiConnect add-on.

> **Requires a Sori subscription.** The extension unlocks against a personal access token
> from your [Sori](../WebtoonReader_Websites) account — it calls `GET /api/me` to confirm the
> token is valid and the account is subscribed before it will scan. Create an account,
> subscribe, and generate a token on `/account`, then paste it into the extension's Settings.
> (OCR, translation, and dictionary lookups still run locally/against public endpoints — the
> subscription is the gate, not a per-scan service.)

---

## Contents

- [What it is & why](#what-it-is--why)
- [How it works](#how-it-works)
  - [Word colors](#word-colors)
- [Install](#install)
  - [Option A — Download & unpack](#option-a--download--unpack-no-build-needed)
  - [Option B — Build from source](#option-b--build-from-source)
- [How to use](#how-to-use)
- [Anki setup](#anki-setup-one-time)
- [Technology](#technology)
- [Development](#development)
- [Optional: Naver Cloud](#optional-naver-cloud-paid-off-by-default)

---

## What it is & why

Reading webtoons is a great way to learn Korean, but the text lives inside images,
so you can't select it, copy it, or run it through a dictionary. This extension
bridges that gap: you draw a box over a speech bubble and it reads the Korean out
of the picture, explains it, and turns the words you care about into flashcards —
without ever leaving the page.

It's built to be **self-contained on the recognition side**. The OCR engine and
its Korean language model are bundled in the extension, so recognition happens on
your own machine with no API keys and no network round-trip. Word segmentation,
translation, and part-of-speech tagging run on the Sori server (shared with the
mobile app); pronunciation and dictionary lookups use public endpoints. An
optional paid upgrade (Naver Cloud) exists but is off by default.

Access is gated by a **Sori subscription**: the extension verifies your account
token against the [Sori website](../WebtoonReader_Websites) before scanning, and
saves captured words to your Sori deck (with Anki as an alternative destination).
See [Connecting your Sori account](#connecting-your-sori-account-required) below.

---

## How it works

A scan flows through four stages:

1. **Capture (content script + background).** When you drag a box, the content
   script records the rectangle and asks the background service worker to take a
   screenshot of the visible tab. The background crops to your selection and
   lightly pre-processes the image (greyscale + contrast) to help OCR.

2. **OCR (offscreen document).** The cropped image is handed to an *offscreen
   document* running Tesseract.js with the Korean model. This indirection is
   deliberate: a content script lives in the **page's** origin, where spinning up
   the Tesseract worker (an extension-origin script) is a cross-origin security
   error. The offscreen document runs in the **extension's** origin, where it's
   allowed — and the worker, wasm core, and language data are all bundled locally
   so strict site CSPs can't block them.

3. **Translation & grammar (Sori server).** The recognized text is `POST`ed to
   `/api/analyze`, which cleans OCR artifacts, splits the text into word-units
   with the Kiwi morphological analyzer, translates the sentence, and looks each
   word up for its English meaning, **part of speech**, and dictionary form.
   Conjugated/particle-attached forms are normalized (e.g. a trailing particle is
   stripped, and `-기` nominalized verbs like 보호하기 are traced back to 보호하다)
   so they classify correctly instead of falling through as "unknown".

   This used to run locally, with Kiwi's wasm in a sandboxed iframe — its
   Emscripten glue JITs bindings via `new Function(...)`, which only a sandboxed
   page's CSP permits — and an ~84 MB model shipped inside every install. Moving
   it to the server means the extension and the [mobile app](https://github.com/odinalx/SoriApp)
   share one implementation, and the extension is ~85 MB lighter. The trade-off
   is that analysis now needs a connection; **OCR stays local**, so it still
   works offline up to this point.

4. **Render & study (content script).** Results appear in a draggable panel: the
   sentence as flowing, color-coded words; a toggleable translation; a "speak"
   button; and a part-of-speech legend. Click a word for a popover with its
   meaning, pronunciation, dictionary form, and Naver links — and an **Add to
   Anki** button.

**Pronunciation** is resolved through a fallback chain — Naver dictionary audio
for single dictionary words, then (if configured) Clova Voice, then Google TTS —
and played from the offscreen document, or embedded into Anki cards as `[sound:]`.

### Word colors

Each part of speech gets its own color; words the analyzer can't classify stay a
neutral grey:

| noun | verb | adjective | adverb | pronoun | numeral | particle | conjunction |
|------|------|-----------|--------|---------|---------|----------|-------------|
| blue | red  | green     | orange | indigo  | teal    | pink     | gold        |

---

## Install

### Option A — Download & unpack (no build needed)

1. Go to the [**Releases**](https://github.com/odinalx/Language-Extensions/releases) page and download the latest `webtoon-korean-reader-*-chrome.zip`.
2. **Unzip** it anywhere (you'll get a folder containing `manifest.json`).
3. Open your browser and visit `chrome://extensions`.
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the unzipped folder.
6. Pin the **W** icon from the toolbar's puzzle-piece menu.

> The zip already contains the OCR model, so recognition needs no download and no
> network. Analysis (words, translation, grammar) calls the Sori API, so that
> step needs a connection.

### Option B — Build from source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/odinalx/Language-Extensions.git
cd Language-Extensions
npm install        # postinstall downloads the Korean OCR model (~12 MB)
npm run build      # outputs .output/chrome-mv3/
```

Then load the **`.output/chrome-mv3`** folder via **Load unpacked** (steps 3–6 above).

After changing code, re-run `npm run build` and click the **↻ reload** icon on the
extension's card in `chrome://extensions`.

---

## Connecting your Sori account (required)

The extension is subscription-gated and won't scan until it's linked to a
subscribed [Sori](../WebtoonReader_Websites) account:

1. Create an account on the Sori site and **subscribe** (`/pricing`).
2. Go to **`/account`** and generate a personal access token (`sori_…`). It's
   shown once — copy it.
3. Open the extension's **Settings** page (button in the popup) and paste the
   token. The extension calls `GET /api/me` to confirm the token is valid and the
   account is subscribed; the verdict is cached (with a short offline grace
   period) so it doesn't re-check on every scan.

Captured words are saved to your **Sori deck** by default (`POST /api/cards`);
choose **Anki** instead in Settings if you prefer local flashcards (see
[Anki setup](#anki-setup-one-time)).

## How to use

1. **Open a webtoon page** (e.g. comic.naver.com). Chrome can't screenshot
   `chrome://` pages, the Web Store, or PDFs, so use a normal site.
2. **Click the W toolbar icon → Start Scanning.** The cursor becomes a crosshair
   and the page scroll locks.
3. **Drag a rectangle** over a single speech bubble. Tighter crops = better OCR.
4. **Read the result.** The panel (top-right, draggable by its header) shows the
   Korean sentence with each word colored by part of speech. Toggle **Show
   translation** for the English, and **Speak phrase** to hear it.
5. **Click any word** for a popover: meaning, POS tag, dictionary form (for
   verbs/adjectives), a pronounce button, and a Naver dictionary link.
6. **Build flashcards.** Click **Add to flashcards** on a word — it joins a
   session queue (the panel shows the count). Keep scanning and adding; when
   you're done, hit **Send all** to push the whole batch to your chosen
   destination (your Sori deck by default, or Anki). (Or enable "send each card
   immediately" in Settings.)
7. **Scan again** without reopening the popup using the button in the panel.

---

## Anki setup (one time, optional)

Anki is the **alternative** flashcard destination — skip this section if you're
saving to your Sori deck (the default). To send to Anki instead, pick it in
Settings; cards are delivered through the
[**AnkiConnect**](https://ankiweb.net/shared/info/2055492159) add-on.

1. In desktop Anki, install AnkiConnect (Tools → Add-ons → Get Add-ons → code `2055492159`) and restart.
2. Open the extension's **Settings** page (button in the popup). It shows the exact
   `chrome-extension://<id>` origin to copy.
3. In Anki: **Tools → Add-ons → AnkiConnect → Config**, add that origin to
   `webCorsOriginList`:
   ```json
   "webCorsOriginList": ["http://localhost", "chrome-extension://<your-id>"]
   ```
4. Keep Anki open while sending cards.

The extension auto-creates a **“Korean Reader”** note type — front: the Korean
word; back: English meaning, word audio, four dictionary links (Naver KR /
Naver KR-EN / Daum / NIKL KRDict), and the example sentence (with the studied
word highlighted) plus its audio and translation. Set your target deck and the
optional "send immediately" toggle in Settings.

> The cards use the Nanum fonts. If your Anki profile doesn't already have them,
> drop `_NanumGothic-Regular.ttf`, `_NanumMyeongjo-Regular.ttf`,
> `_NanumPenScript-Regular.ttf` into your `collection.media` folder (free from
> [Google Fonts](https://fonts.google.com/?query=nanum)).

---

## Technology

| Area | Choice | Notes |
|------|--------|-------|
| Framework | [WXT](https://wxt.dev/) | MV3 extension tooling (Vite under the hood) |
| Language | TypeScript | |
| UI | React (popup & options) + vanilla DOM in a Shadow DOM (in-page panel) | Shadow DOM isolates the panel from page styles |
| OCR | [Tesseract.js](https://github.com/naptha/tesseract.js) v5, `kor` `best` model | Runs in an **offscreen document**; worker + wasm + model bundled locally |
| Segmentation, translation & POS | [Sori website](../WebtoonReader_Websites) API (`POST /api/analyze`) | Kiwi word-units + sentence translation + per-word dictionary/part-of-speech, shared with the mobile app |
| Pronunciation | Naver dict audio → Clova Voice (optional) → Google TTS | Played from the offscreen document; embedded in Anki cards |
| Dictionary | Naver / Daum / NIKL KRDict deep links | |
| Account / paywall | [Sori website](../WebtoonReader_Websites) API (`GET /api/me`) | Subscription-gated; token created on `/account` |
| Flashcards | Sori deck (`POST /api/cards`, default) or [AnkiConnect](https://foosoft.net/projects/anki-connect/) | Anki path auto-creates the note type, stores audio media, adds notes |
| Optional | Naver Cloud (CLOVA OCR + Clova Voice) | Paid, hidden by default |

**Architecture at a glance:**

```
popup (React)  ──ACTIVATE_SCAN──▶  content script  ──CAPTURE_REQUEST──▶  background (service worker)
                                   (drag overlay,                         │  screenshot → crop → preprocess
                                    result panel,                         │  OCR  ─▶  offscreen document (Tesseract)
                                    word popover)  ◀──CAPTURE_RESULT───   │  translate + grammar
                                        │                                 │  audio  ─▶  offscreen (playback)
                                        └──ANKI_ADD / SEND_ALL──────────▶ └─ AnkiConnect (localhost:8765)
```

---

## Development

```bash
npm run dev    # launches Chromium with the extension + live reload
npm run build  # production build → .output/chrome-mv3/
npm run zip    # packaged zip → .output/webtoon-korean-reader-<version>-chrome.zip
```

To cut a release, run `npm run zip` and attach the generated zip to a GitHub Release.

---

## Optional: Naver Cloud (paid, off by default)

The reader works fully free with Tesseract OCR + Google voice/translation. For
higher-quality OCR and a more natural Korean voice you can wire in Naver Cloud
(CLOVA OCR + Clova Voice). That UI is hidden by default — flip `SHOW_NAVER_CLOUD`
to `true` in `entrypoints/options/App.tsx` to expose the key fields.
