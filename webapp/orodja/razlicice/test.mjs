// Regresijski test zagona /app po objavi: pomesane stare in nove razlicice modulov
// ("does not provide an export named ...", incident 29. 9. 2026 in Sentry OUTLY-WEBAPP-7 / OUTLY-WEBAPP-A, 26. 10. in 6. 11. 2026).
//
// Uporaba (iz korena repozitorija, Playwright + Chromium):
//   node webapp/orodja/razlicice/test.mjs              # A = trenutne datoteke (git ls-files), B = A + umetna sprememba
//   node webapp/orodja/razlicice/test.mjs --ref main   # A = koda s commita (na kodi pred 11/2026 "slab-signal" PADE)
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
const ref = iRef >= 0 ? argumenti.splice(iRef, 2)[1] : "";
const izbrani = argumenti;

// --- razlicici A in B v zacasni mapi ---
const DATOTEKE = ["app", "webapp", "vendor", "assets/fonts", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-32.png",
  "supabase-config.js", "seja-fetch.js", "favicon.ico"];
const ZAC = fs.mkdtempSync(path.join(os.tmpdir(), "outly-razlicice-"));
const A = path.join(ZAC, "A"), B = path.join(ZAC, "B");
fs.mkdirSync(A);
if (ref) {
  execFileSync("sh", ["-c", `git archive ${JSON.stringify(ref)} ${DATOTEKE.join(" ")} | tar -x -C ${JSON.stringify(A)}`], { cwd: KOREN });
} else {
  const seznam = execFileSync("git", ["ls-files", "-z", ...DATOTEKE], { cwd: KOREN }).toString().split("\0").filter(Boolean);
  for (const f of seznam) { fs.mkdirSync(path.dirname(path.join(A, f)), { recursive: true }); fs.copyFileSync(path.join(KOREN, f), path.join(A, f)); }
}
fs.cpSync(A, B, { recursive: true });
fs.appendFileSync(path.join(B, "webapp/js/oblika.js"), "\nexport const testnaIzvozB = 1;\n");
const podatki = path.join(B, "webapp/js/podatki.js");
fs.writeFileSync(podatki, 'import { testnaIzvozB } from "./oblika.js";\nvoid testnaIzvozB;\n' + fs.readFileSync(podatki, "utf8"));
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

async function stanjeStrani(page) {
  return page.evaluate(() => {
    const k = document.getElementById("aplikacija");
    if (!k) return "brez-korena";
    if (k.querySelector('[role="alert"]') && /could not start|ni zagnal/i.test(k.textContent)) return "gumb-napaka";
    if (k.querySelector(".nalaganje-zacetno")) return "vrtavka";
    return "zagnano";
  }).catch(() => "navigacija");
}
async function pocakajZagon(page, ms = 15000) {
  const konec = Date.now() + ms;
  while (Date.now() < konec) { if (await stanjeStrani(page) === "zagnano") return true; await pocakaj(200); }
  return false;
}
const verzija = page => page.evaluate(() => import("/webapp/js/oblika.js").then(m => ("testnaIzvozB" in m ? "B" : "A"))).catch(e => "? " + e.message);

async function scenarij(ime, { sw = true, fail = [], nostoreA = [], offline = false, nato = false, izbrisi = "", znova = false }) {
  // Tuji strezniki (backend, Supabase) niso dosegljivi - test ne sme klicati produkcije.
  const brskalnik = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });
  const ctx = await brskalnik.newContext({ serviceWorkers: sw ? "allow" : "block", viewport: { width: 393, height: 852 } });
  const page = await ctx.newPage();
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
    await ctl(`root=${encodeURIComponent(B)}&fail=${offline ? "*" : fail.join(",")}`);
    if (offline) await ctx.setOffline(true);
    const napake = new Set();
    let nalaganj = 0;
    page.on("pageerror", e => napake.add(String(e.message).slice(0, 140)));
    page.on("framenavigated", f => { if (f === page.mainFrame()) nalaganj++; });
    await page.goto(`${BASE}/app/`).catch(() => {});
    await pocakaj(12000);
    const stanje = await stanjeStrani(page);
    const izid = { ime, stanje, verzija: stanje === "zagnano" ? await verzija(page) : "-", nalaganj, napake: [...napake] };
    if (znova && stanje === "zagnano") {   // 3) brez povezave "Try again" / "Reload" (outlyObnovi(true)) mora stran res osveziti
      const prej = nalaganj;
      await page.evaluate(() => window.outlyObnovi(true));
      await pocakaj(4000);
      izid.znova = nalaganj > prej && (await pocakajZagon(page)) ? await verzija(page) : "ni osvezitve";
    }
    if (nato) {   // 3) omrezje spet dobro: drugi naslednji zagon mora dati B (prvi osvezi shrambo / namesti nov SW)
      if (offline) await ctx.setOffline(false);
      await ctl(`root=${encodeURIComponent(B)}`);
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
