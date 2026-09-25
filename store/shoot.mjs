#!/usr/bin/env node
/**
 * Regenerates the Chrome Web Store visuals in store/assets/: the five
 * 1280x800 screenshots and the 440x280 promo tile. The product frames come
 * from the real extension on Odin's webtoon page; the layout (Dok's mark,
 * title, subtitle, framed capture) is an HTML page rendered by Chromium with
 * the site's fonts, so a new logo or wording is one run away.
 *
 *   (cd ../WebtoonReader_Websites && docker compose up -d)           # site on :3000
 *   WXT_SITE_URL=http://localhost:3000 SORI_SCREENSHOTS=1 npm run build
 *   SORI_TOKEN=sori_… NODE_PATH=<dir with playwright-core> node store/shoot.mjs
 *
 * SORI_TOKEN: an API token of a subscribed account on that site.
 * Rebuild the release extension afterwards (npm run build): the screenshot
 * build must never ship.
 */
import { createServer } from "node:http"
import { readFile, mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname, resolve, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright-core")

const here = dirname(fileURLToPath(import.meta.url))
const ext = resolve(here, "../.output/chrome-mv3")
const site = resolve(here, "../../WebtoonReader_Websites")
const out = join(here, "assets")
const raw = await mkdtemp(join(tmpdir(), "dokhae-store-"))
const TOKEN = process.env.SORI_TOKEN
if (!TOKEN) throw new Error("Set SORI_TOKEN to an API token of a subscribed account.")
const CHROMIUM = process.env.CHROMIUM ?? "/usr/bin/chromium"
const CHIP = process.env.SORI_CHIP ?? "어떻게"

// One local server: the webtoon page, the site's fonts and mascot, the raw frames.
const ROOTS = {
  page: join(site, "scripts/screenshots"),
  fonts: join(site, "public/fonts"),
  mascot: join(site, "public/mascot"),
  raw,
}
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" }
const server = createServer(async (req, res) => {
  const [, root, ...rest] = decodeURIComponent(new URL(req.url, "http://x").pathname).split("/")
  const rel = rest.join("/")
  if (!ROOTS[root] || rel.includes("..")) return res.writeHead(404).end()
  try {
    const body = await readFile(join(ROOTS[root], rel))
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] ?? "application/octet-stream" }).end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(0)
const BASE = `http://localhost:${server.address().port}`
const PAGE = `${BASE}/page/real-panel.html`

/* ------------------------------------------------------------ raw frames */

// Close to the 1040x585 frame, so the panel shows at almost its real size.
const W = 1120
const H = 630
const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "dokhae-ext-")), {
  executablePath: CHROMIUM,
  headless: false,
  viewport: { width: W, height: H },
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent("serviceworker")
const extId = new URL(sw.url()).host

async function popupShot(file) {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: 300, height: 560 })
  await p.goto(`chrome-extension://${extId}/popup.html`)
  await p.waitForTimeout(1500)
  // The test account's address stays out of the store listing.
  await p.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes("@")) n.nodeValue = "toi@exemple.fr"
  })
  await p.locator("body > *").first().screenshot({ path: join(raw, file) })
  await p.close()
}

// The popup before and after connecting the account.
await sw.evaluate(() => chrome.storage.local.set({ settings: {} }))
await popupShot("popup-connect.png")
await sw.evaluate((token) => chrome.storage.local.set({ settings: { siteToken: token } }), TOKEN)
await popupShot("popup-ready.png")

const page = await ctx.newPage()
await page.goto(PAGE, { waitUntil: "networkidle" })
await page.bringToFront()
await sw.evaluate(async (url) => {
  const [tab] = await chrome.tabs.query({ url: `${url}*` })
  await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_SCAN" })
}, PAGE)
await page.waitForTimeout(500)
const box = await page.evaluate(() => {
  const r = document.querySelector("[data-capture]").getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
await page.mouse.move(box.x, box.y)
await page.mouse.down()
await page.mouse.move(box.x + box.w, box.y + box.h, { steps: 12 })
await page.waitForTimeout(300)
await page.screenshot({ path: join(raw, "capture.png") })
await page.mouse.up()

const firstChip = page.locator("button.w").first()
await firstChip.waitFor({ timeout: 60_000 })
await page.waitForTimeout(800)
await page.screenshot({ path: join(raw, "panel.png") })
const chip = page.locator("button.w", { hasText: CHIP })
await ((await chip.count()) ? chip.first() : firstChip).click()
await page.waitForTimeout(900)
await page.screenshot({ path: join(raw, "word.png") })
await page.getByRole("button", { name: /Ajouter au deck/ }).first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: join(raw, "deck.png") })
await ctx.close()

/* ------------------------------------------------------------ layouts */

const NAME = `<span class="name">Dokhae</span>`
const CSS = `
  @font-face { font-family: Bricolage; src: url(/fonts/bricolage-grotesque-latin-v1.woff2) format("woff2"); font-weight: 200 800; }
  @font-face { font-family: Pretendard; src: url(/fonts/pretendard-sori-v1.woff2) format("woff2"); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #f4f1e9; color: #16141a; font-family: Pretendard, sans-serif; overflow: hidden; }
  .name { font-family: Bricolage; font-weight: 700; letter-spacing: -0.02em; }
  .brand { position: absolute; top: 20px; left: 30px; display: flex; align-items: center; gap: 8px; font-size: 21px; }
  .brand img { height: 1.5em; }
  h1 { font-family: Bricolage; font-weight: 700; letter-spacing: -0.02em; font-size: 42px; text-align: center; padding-top: 52px; }
  .sub { text-align: center; color: #6a6675; font-size: 17px; margin-top: 10px; }
  .frame { position: absolute; left: 120px; top: 162px; width: 1040px; height: 585px; border-radius: 16px; overflow: hidden;
           box-shadow: 0 30px 70px -30px rgba(20,18,26,.5); background: #16141a; }
  .frame img { width: 100%; height: 100%; object-fit: cover; }
  .pops { position: absolute; top: 170px; left: 0; right: 0; display: flex; justify-content: center; align-items: flex-start; gap: 44px; }
  .pops figure { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .pops img { width: 300px; border-radius: 14px; box-shadow: 0 24px 60px -28px rgba(20,18,26,.5); border: 1px solid rgba(20,18,26,.1); }
  .pops figcaption { font-size: 14px; color: #6a6675; }
`
const shots = [
  { file: "screenshot-1-capture.png", img: "capture.png", title: "Encadre une bulle, Dokhae lit le coréen", sub: "La lecture du texte se fait sur ton ordinateur, en quelques secondes." },
  { file: "screenshot-2-panel.png", img: "panel.png", title: "Chaque mot souligné selon sa nature", sub: "Nom, verbe, particule : la grammaire de la phrase se lit d’un coup d’œil." },
  { file: "screenshot-3-word.png", img: "word.png", title: "Touche un mot : sens, forme, prononciation", sub: "Forme du dictionnaire, registre, phrase d’exemple et audio." },
  { file: "screenshot-4-deck.png", img: "deck.png", title: "Garde tes mots, révise-les sur Dokhae", sub: "Un clic sur « Ajouter au deck » et le mot rejoint tes révisions." },
  {
    file: "screenshot-5-popup.png",
    title: "Connecte ton compte en un clic",
    sub: "Puis scanne depuis l’icône, ou sélectionne du coréen et fais un clic droit.",
    body: `<div class="pops"><figure><img src="/raw/popup-connect.png"><figcaption>1. Connecter mon compte</figcaption></figure><figure><img src="/raw/popup-ready.png"><figcaption>2. Scanner une bulle</figcaption></figure></div>`,
  },
]

const browser = await chromium.launch({ executablePath: CHROMIUM })
const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await mkdir(out, { recursive: true })
for (const s of shots) {
  const body = s.body ?? `<div class="frame"><img src="/raw/${s.img}"></div>`
  await tab.goto(PAGE) // same origin for fonts and frames
  await tab.setContent(
    `<style>${CSS}</style><div class="brand"><img src="/mascot/dok-tete.svg" alt="">${NAME}</div><h1>${s.title}</h1><p class="sub">${s.sub}</p>${body}`,
    { waitUntil: "networkidle" },
  )
  await tab.evaluate(() => document.fonts.ready)
  await tab.screenshot({ path: join(out, s.file) })
  console.log("wrote", s.file)
}

// The small promo tile: Dok, the name, 독해, the promise.
await tab.setViewportSize({ width: 440, height: 280 })
await tab.setContent(
  `<style>${CSS}
    .promo { position: absolute; inset: 0; padding: 0 34px; display: flex; flex-direction: column; justify-content: center; }
    .top { display: flex; align-items: center; gap: 16px; }
    .top img { height: 84px; }
    .top .name { font-size: 50px; line-height: 1; }
    .ko { font-size: 20px; font-weight: 700; color: #2f4bd8; margin-top: 4px; }
    .tag { font-size: 21px; font-weight: 700; line-height: 1.35; margin-top: 22px; }
    .tag u { text-decoration: underline dotted #1f8a70 3px; text-underline-offset: 6px; }
  </style>
  <div class="promo"><div class="top"><img src="/mascot/dok-tete.svg" alt=""><div>${NAME}<div class="ko" lang="ko">독해</div></div></div>
  <p class="tag">Tes webtoons en coréen,<br>compris <u>mot</u> à <u>mot</u>.</p></div>`,
  { waitUntil: "networkidle" },
)
await tab.evaluate(() => document.fonts.ready)
await tab.screenshot({ path: join(out, "promo-small-440x280.png") })
console.log("wrote promo-small-440x280.png")
await browser.close()
server.close()
