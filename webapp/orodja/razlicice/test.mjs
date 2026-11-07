// Regresijski test zagona /app po objavi: pomesane stare in nove razlicice modulov
// ("does not provide an export named ...", incident 29. 9. 2026 in Sentry OUTLY-WEBAPP-7 / OUTLY-WEBAPP-A, 26. 10. in 6. 11. 2026).
//
// Uporaba (iz korena repozitorija, Playwright + Chromium):
//   node webapp/orodja/razlicice/test.mjs              # A = HEAD (commit), B = A + umetna sprememba
//   node webapp/orodja/razlicice/test.mjs --ref main   # A = koda s commita (na kodi pred 11/2026 "slab-signal" PADE)
//   node webapp/orodja/razlicice/test.mjs --delovno    # A = delovno drevo (necommitane spremembe; samo med razvojem)
//   node webapp/orodja/razlicice/test.mjs slab-signal  # samo izbrani scenariji
//
// A = razlicica pred objavo, B = po objavi: B v oblika.js doda izvoz, ki ga podatki.js uvozi (kot #103 normalizirajKmalu).
// Lokalni streznik (streznik.mjs) posnema Cloudflare Pages, VKLJUCNO s pastjo max-age=14400 na /webapp/* in s prekinjenimi
// povezavami (slab signal). BREZ page.route - ta izklopi HTTP predpomnilnik in test ne bi nic dokazal.
// Izhod 0 = vsi scenariji kot pricakovano, 1 = vsaj eden ne. Traja ~3 min.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TU = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.resolve(TU, "../../..");
function nalozi(ime) {
  for (const od of [path.join(KOREN, "package.json"), "/opt/node-tools/node_modules/"]) {
    try { return createRequire(od)(ime); } catch { /* naslednji */ }
  }
  throw new Error("Ni paketa " + ime + " (npm i playwright ali globalna namestitev)");
}
const { chromium } = nalozi("playwright");

const argumenti = process.argv.slice(2);
const iRef = argumenti.indexOf("--ref");
const ref = iRef >= 0 ? argumenti.splice(iRef, 2)[1] : "HEAD";
if (!ref || ref.startsWith("--")) { console.error("--ref rabi commit ali vejo (npr. --ref main)"); process.exit(2); }
const iDelovno = argumenti.indexOf("--delovno");
const delovno = iDelovno >= 0 && argumenti.splice(iDelovno, 1).length > 0;
const izbrani = argumenti;

// --- razlicici A in B v zacasni mapi ---
const DATOTEKE = ["app", "webapp", "vendor", "assets/fonts", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-32.png",
  "supabase-config.js", "seja-fetch.js", "favicon.ico"];
const ZAC = fs.mkdtempSync(path.join(os.tmpdir(), "outly-razlicice-"));
const A = path.join(ZAC, "A"), B = path.join(ZAC, "B");
fs.mkdirSync(A);
if (!delovno) {
  const tar = path.join(ZAC, "a.tar");
  execFileSync("git", ["archive", "-o", tar, ref, "--", ...DATOTEKE], { cwd: KOREN });
  execFileSync("tar", ["-xf", tar, "-C", A]);
  console.log("A = " + execFileSync("git", ["rev-parse", "--short", ref], { cwd: KOREN }).toString().trim());
} else {
  console.log("A = delovno drevo (necommitane spremembe)");
  const seznam = execFileSync("git", ["ls-files", "-z", ...DATOTEKE], { cwd: KOREN }).toString().split("\0").filter(Boolean);
  for (const f of seznam) { fs.mkdirSync(path.dirname(path.join(A, f)), { recursive: true }); fs.copyFileSync(path.join(KOREN, f), path.join(A, f)); }
}
fs.cpSync(A, B, { recursive: true });
fs.appendFileSync(path.join(B, "webapp/js/oblika.js"), "\nexport const testnaIzvozB = 1;\n");
const podatki = path.join(B, "webapp/js/podatki.js");
fs.writeFileSync(podatki, 'import { testnaIzvozB } from "./oblika.js";\nvoid testnaIzvozB;\n' + fs.readFileSync(podatki, "utf8"));
const leni = path.join(B, "webapp/js/views/kmalu-klub.js");   // leno nalozen zaslon, ki ga ni v JEDRU (/app/soon/:slug)
fs.writeFileSync(leni, 'import { testnaIzvozB } from "../oblika.js";\nvoid testnaIzvozB;\n' + fs.readFileSync(leni, "utf8"));
for (const [f, re] of [["webapp/sw.js", /(const RAZLICICA = "[^"]+)"/], ["webapp/porocilo.js", /(var RAZLICICA = "[^"]+)"/]]) {
  const p = path.join(B, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(re, '$1-B"'));   // nova razlicica SW (kot ob pravi objavi)
}

// --- streznik in pomozne funkcije ---
const PORT = 8790 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PORT}`;
const streznik = spawn(process.execPath, [path.join(TU, "streznik.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => streznik.stdout.once("data", ok));
const ctl = q => fetch(`${BASE}/__ctl?${q}`).then(r => r.json());
const pocakaj = ms => new Promise(ok => setTimeout(ok, ms));

// Vsak klic v stran ima mejo: zamrznjena stran (npr. navigacija, ki obvisi ob zamenjavi SW) ne sme zamrzniti testa.
const zMejo = (obljuba, ms, sicer) => Promise.race([obljuba, pocakaj(ms).then(() => sicer)]);
async function stanjeStrani(page) {
  return zMejo(page.evaluate(() => {
    const k = document.getElementById("aplikacija");
    if (!k) return "brez-korena";
    if (k.querySelector('[role="alert"]') && /could not start|ni zagnal/i.test(k.textContent)) return "gumb-napaka";
    if (k.querySelector('[role="alert"]') && /longer than usual|dlje kot/i.test(k.textContent)) return "pocasi";
    if (k.querySelector(".nalaganje-zacetno")) return "vrtavka";
    return "zagnano";
  }).catch(() => "navigacija"), 5000, "zamrznjeno");
}
async function pocakajZagon(page, ms = 15000) {
  const konec = Date.now() + ms;
  while (Date.now() < konec) { if (await stanjeStrani(page) === "zagnano") return true; await pocakaj(200); }
  return false;
}
const verzija = page => zMejo(page.evaluate(() => import("/webapp/js/oblika.js").then(m => ("testnaIzvozB" in m ? "B" : "A"))).catch(e => "? " + e.message), 8000, "zamrznjeno");

async function scenarij(ime, { sw = true, fail = [], nostoreA = [], offline = false, nato = false, izbrisi = "", znova = false, leni = false, hang = [], cakaj = 12000, odgovori = false, natoNovaStran = false, uvozi = "", ocisti = false }) {
  // Tuji strezniki (backend, Supabase) niso dosegljivi - test ne sme klicati produkcije.
  const brskalnik = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });
  const ctx = await brskalnik.newContext({ serviceWorkers: sw ? "allow" : "block", viewport: { width: 393, height: 852 } });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(25000);
  try {
    // 1) Uporabnik je /app odprl pred objavo (A): SW namescen, predpomnilnik napolnjen.
    await ctl(`root=${encodeURIComponent(A)}&nostore=${nostoreA.join(",")}`);
    await page.goto(`${BASE}/app/`);
    if (!await pocakajZagon(page)) throw new Error("A se ni zagnal");
    if (sw) {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await pocakaj(2500);
      await page.reload();
      if (!await pocakajZagon(page)) throw new Error("A (2. nalaganje) se ni zagnal");
      if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) throw new Error("SW ne nadzoruje strani");
      await pocakaj(2500);   // krog "shrani"
    }
    if (izbrisi) await page.evaluate(async p => { for (const k of await caches.keys()) await (await caches.open(k)).delete(p); }, izbrisi);
    // 2) Objava B; omrezje: nekatere datoteke ne pridejo (prekinjena povezava).
    // Brez povezave: navigator.onLine=false (setOffline) IN streznik prekine vse - setOffline v Chromiumu ne zajame vseh zahtev SW.
    await ctl(`root=${encodeURIComponent(B)}&fail=${offline ? "*" : fail.join(",")}&hang=${hang.join(",")}`);
    if (offline) await ctx.setOffline(true);
    // Hladen predpomnilnik brskalnika (spominski + HTTP; shramba SW ostane) - kot ponovno odprta aplikacija po dolgem casu.
    if (ocisti) { const cdp = await ctx.newCDPSession(page); await cdp.send("Network.clearBrowserCache"); await cdp.detach(); }
    const napake = new Set();
    let nalaganj = 0, polnih = 0;   // nalaganj steje tudi pushState; polnih samo prava nalaganja dokumenta
    page.on("domcontentloaded", () => polnih++);
    page.on("pageerror", e => napake.add(String(e.message).slice(0, 140)));
    page.on("framenavigated", f => { if (f === page.mainFrame()) nalaganj++; });
    await page.goto(`${BASE}/app/`, { waitUntil: "commit" }).catch(() => {});   // "commit": pri viseci zahtevi load ne pride
    await pocakaj(cakaj);
    const stanje = await stanjeStrani(page);
    const izid = { ime, stanje, verzija: stanje === "zagnano" ? await verzija(page) : "-", nalaganj, napake: [...napake] };
    if (uvozi && stanje === "zagnano") {   // 3) leno nalozen modul (npr. skener) v ze odprti aplikaciji, njegova datoteka visi
      const t0 = Date.now();
      izid.uvoz = await zMejo(page.evaluate(p => import(p).then(() => "ok", e => "napaka " + e.message), uvozi), 25000, "visi");
      izid.uvozS = Math.round((Date.now() - t0) / 1000);
    }
    if (leni && stanje === "zagnano") {   // 3) iz shrambe zagnana stran odpre zaslon, ki ga ni v shrambi (pride z omrezja, B)
      // Pricakovano (pregled PR #104, 2. krog): zaslon pokaze "Try again", stran se SAMA NE osvezi (sicer pri pocasnih
      // napakah omrezja samodejna zanka osvezitev z vrtavko - leno() je omejen na 1x/60 s, krog pa lahko traja dlje).
      const prej = polnih;
      await page.evaluate(() => import("/webapp/js/usmerjanje.js").then(m => m.navigiraj("/app/soon/test")));
      await pocakaj(20000);
      izid.leni = await stanjeStrani(page);
      izid.leniOsvezitev = polnih - prej;
      izid.leniTryAgain = await page.evaluate(() => /could not be loaded|ni bilo mogo/.test(document.body.textContent));
      izid.samodejnih = await page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem("outly_obnova_samodejno") || "[]").length; } catch { return -1; } });
      if (izid.leni === "zagnano" && !izid.leniTryAgain) izid.leniVerzija = await verzija(page);
    }
    if (znova && stanje === "zagnano") {   // 3) brez povezave "Try again" / "Reload" (outlyObnovi(true)) mora stran res osveziti
      const prej = nalaganj;
      await page.evaluate(() => window.outlyObnovi(true));
      await pocakaj(4000);
      izid.znova = nalaganj > prej && (await pocakajZagon(page)) ? await verzija(page) : "ni osvezitve";
    }
    if (nato) {   // 3) omrezje spet dobro: drugi naslednji zagon mora dati B (prvi osvezi shrambo / namesti nov SW)
      if (offline) await ctx.setOffline(false);
      await ctl(`root=${encodeURIComponent(B)}${odgovori ? "&odgovori=1" : ""}`);
      if (natoNovaStran) {   // zapri + odpri aplikacijo (nova stran v istem brskalniku: ista shramba in SW)
        await page.close().catch(() => {});
        const nova = await ctx.newPage(); nova.setDefaultNavigationTimeout(25000);
        await nova.goto(`${BASE}/app/`).catch(() => {});   // eno odprtje (druga navigacija v isti strani = znana zamrznitev)
        izid.nato = (await pocakajZagon(nova)) ? await verzija(nova) : await stanjeStrani(nova);
        return izid;
      }
      await page.goto(`${BASE}/app/`).catch(() => {});
      await pocakajZagon(page);
      await pocakaj(3000);
      await page.goto(`${BASE}/app/`).catch(() => {});
      izid.nato = (await pocakajZagon(page)) ? await verzija(page) : await stanjeStrani(page);
    }
    return izid;
  } catch (e) {
    return { ime, stanje: "NAPAKA TESTA", napaka: e.message };
  } finally { await brskalnik.close(); }
}

const SLAB_SIGNAL = ["/webapp/js/oblika.js", "/webapp/porocilo.js"];
// [opis, nastavitve, pricakovano]
const SCENARIJI = {
  // Sentry OUTLY-WEBAPP-A: SW nadzoruje stran, objava B, slab signal -> oblika.js (in porocilo.js) ne prideta z omrezja,
  // SW ju vrne iz shrambe (A), ostalo pride z omrezja (B). Pricakovano: zagon iz shrambe (A), najvec 2 nalaganji.
  "slab-signal": [{ fail: SLAB_SIGNAL, nato: true }, i => i.stanje === "zagnano" && i.verzija === "A" && i.nalaganj <= 2 && i.nato === "B"],
  // Stran iz shrambe odpre leno nalozen zaslon, ki ga v shrambi ni (pregled PR #104, S-2): ne sme koncati s
  // celozaslonskim "Outly could not start" - aplikacija ostane zagnana (zaslon lahko pokaze "Try again").
  "slab-signal-leni": [{ fail: SLAB_SIGNAL, leni: true, nato: true }, i => i.stanje === "zagnano" && i.verzija === "A" && i.leni === "zagnano" && i.leniOsvezitev === 0 && i.leniTryAgain && i.nato === "B"],
  // Brez SW (zasebno okno, brskalnik v aplikaciji): leni zaslon iz nove objave ob starih modulih. Samodejna obnova iz leno()
  // mora iti skozi varovalo 3/5 min (pregled PR #104, 3. krog: sicer pri pocasnih napakah zanka) - 1 osvezitev, nato B.
  "brez-sw-leni": [{ sw: false, leni: true }, i => i.stanje === "zagnano" && i.verzija === "A" && i.leni === "zagnano" && i.leniOsvezitev === 1 && i.samodejnih === 1 && i.leniVerzija === "B"],
  // outly-backend#396: povezava "visi" (signal je, podatki ne tecejo) - oblika.js ne odgovori nikoli. S SW: po 30 s brez izrisa
  // zagon.js zazene stran iz shrambe (A). Ko se omrezje vrne: zapri + odpri aplikacijo -> B. (Znano: polna osvezitev ZE ODPRTE
  // strani takrat v Chromiumu pogosto obvisi - predaja starega SW novemu; zato test odpre novo stran.) Prej: vecna vrtavka.
  "visi": [{ hang: ["/webapp/js/oblika.js"], cakaj: 45000, nato: true, natoNovaStran: true }, i => i.stanje === "zagnano" && i.verzija === "A" && i.nalaganj <= 2 && i.nato === "B"],
  // Visi glava strani (zagon.js, app.css): SW po 6 s vrne kopijo - aplikacija se zazene (prej prazna stran za vedno, pregled S-1).
  "visi-glava": [{ hang: ["/webapp/zagon.js", "/webapp/app.css"], cakaj: 30000, ocisti: true }, i => i.stanje === "zagnano"],
  // Skener v ze odprti aplikaciji, njegova datoteka visi: SW po 6 s vrne kopijo iz shrambe (JEDRO) - prej vrtavka (pregled S-2).
  "visi-skener": [{ hang: ["/webapp/js/views/posel-skener.js"], uvozi: "/webapp/js/views/posel-skener.js" }, i => i.stanje === "zagnano" && i.uvoz === "ok" && i.uvozS <= 12],
  // Brez SW (ni shrambe): po najvec ~30 s gumb "Reload" namesto vecne vrtavke (oblika.js ni v HTTP predpomnilniku).
  "visi-brez-sw": [{ sw: false, nostoreA: ["/webapp/js/oblika.js"], hang: ["/webapp/js/oblika.js"], cakaj: 38000 }, i => i.stanje === "pocasi"],
  // Shramba nima vse kode za zagon (+ omrezje je ne da): zagon iz shrambe ni mogoc -> gumb, brez zanke osvezitev.
  "nepopolna-shramba": [{ fail: SLAB_SIGNAL, izbrisi: "/webapp/js/oblika.js" }, i => i.stanje === "gumb-napaka" && i.nalaganj <= 2],
  // Brez SW: HTTP predpomnilnik (max-age=14400) ima star oblika.js, podatki.js ni bil shranjen -> mesanica; zagon.js popravi (B).
  "http-predpomnilnik": [{ sw: false, nostoreA: ["/webapp/js/podatki.js"] }, i => i.stanje === "zagnano" && i.verzija === "B" && i.nalaganj <= 2],
  // Navadna objava, dobro omrezje: B brez napak in brez dodatne osvezitve.
  "objava": [{}, i => i.stanje === "zagnano" && i.verzija === "B" && i.nalaganj === 1 && i.napake.length === 0],
  // Brez povezave: A iz shrambe SW (delovanje brez povezave, tudi skener).
  // Brez povezave "Try again" na leno nalozenem zaslonu (npr. skener po zamenjavi shrambe) mora stran osveziti iz shrambe
  // (do 11/2026 gumb ni naredil nic - skener je ostal mrtev do ponovnega odprtja aplikacije).
  "brez-povezave": [{ offline: true, znova: true }, i => i.stanje === "zagnano" && i.verzija === "A" && i.napake.length === 0 && i.znova === "A"],
};

let padlo = 0;
try {
  for (const ime of (izbrani.length ? izbrani : Object.keys(SCENARIJI))) {
    if (!SCENARIJI[ime]) throw new Error("Ni scenarija " + ime);
    const [nastavitve, pricakovano] = SCENARIJI[ime];
    const izid = await scenarij(ime, nastavitve);
    const ok = pricakovano(izid);
    if (!ok) padlo++;
    console.log((ok ? "OK   " : "PADE ") + JSON.stringify(izid));
  }
} finally {
  streznik.kill();
  fs.rmSync(ZAC, { recursive: true, force: true });
}
console.log(padlo ? `${padlo} scenarijev PADE` : "vsi scenariji OK");
process.exit(padlo ? 1 : 0);
