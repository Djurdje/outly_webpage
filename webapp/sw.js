/* Service worker spletne aplikacije (faza 5). Streze se z /webapp/sw.js, velja za /app/ (glava Service-Worker-Allowed
   v _headers). Namen: namestljiva PWA in lupina, ki se odpre tudi brez povezave.
   - Navigacija pod /app/: vedno lupina /app/ (omrezje najprej, ob izpadu shranjena). Tako globoka povezava
     (/app/event/12) ne gre cez korensko index.html in vstop.js.
   - /webapp/* (koda brez razlicice v imenu): omrezje najprej MIMO predpomnilnika brskalnika (cache: "no-cache"),
     shranjeno samo ob izpadu - po objavi nikoli stara koda.
   - /vendor/*, pisave, ikone (razlicica v imenu / se ne spreminjajo): shranjeno najprej.
   - API (backend, Supabase, Cloudinary), vstopnice, ploscice zemljevida: NE prestrezamo (vedno sveze, kot iOS). */
const RAZLICICA = "outly-app-5";   // ob dvigu uskladi tudi webapp/porocilo.js
const LUPINA = "/app/";
const JEDRO = [
  LUPINA, "/webapp/app.css", "/webapp/zagon.js", "/webapp/porocilo.js", "/webapp/js/main.js", "/webapp/manifest.webmanifest",
  "/vendor/preact-10.29.8.module.js", "/vendor/preact-hooks-10.29.8.module.js", "/vendor/htm-3.1.1.module.js",
  "/vendor/qrcode-generator-2.0.4.mjs",
  // Skener vstopnic mora delati tudi, ce se stran odpre brez povezave (issue outly-backend#86): njegova koda in knjiznici
  // (jsQR za branje kode; noble-ed25519 za preverjanje podpisa v brskalnikih brez WebCrypto Ed25519) so vnaprej v predpomnilniku.
  // Seznam vstopnic NI tu: API odgovorov SW ne predpomni, seznam hrani skener sam (IndexedDB, webapp/js/sken/shramba.js).
  "/webapp/js/views/posel-skener.js", "/webapp/js/sken/motor.js", "/webapp/js/sken/podpis.js", "/webapp/js/sken/shramba.js", "/webapp/js/vip.js",
  "/vendor/jsqr-1.4.0.mjs", "/vendor/noble-ed25519-3.2.0.mjs",
  "/vendor/supabase-2.115.0.js", "/supabase-config.js",
  "/assets/fonts/inter-latin-wght-normal.woff2", "/assets/fonts/inter-latin-ext-wght-normal.woff2",
  "/assets/icon-192.png", "/assets/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(RAZLICICA).then(c => c.addAll(JEDRO.map(u => new Request(u, { cache: "no-cache" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x.startsWith("outly-app-") && x !== RAZLICICA).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});

/* Stran po nalaganju poslje seznam modulov, ki jih je nalozila (brez builda seznama ne poznamo vnaprej). */
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.tip !== "shrani" || !Array.isArray(d.poti)) return;
  const poti = d.poti.filter(p => typeof p === "string" && /^\/(webapp|vendor)\/[\w./-]+$/.test(p) && !p.includes(".."));
  e.waitUntil(caches.open(RAZLICICA).then(c => Promise.all(poti.map(p => c.match(p).then(z => z || fetch(p, { cache: "no-cache" })
    .then(odg => { if (odg.ok && pravaVsebina(p, odg)) return c.put(p, odg); }).catch(() => {}))))));
});

/* Shrani samo pravo datoteko: Cloudflare za neznano pot vrne korensko index.html s 200 - HTML pod kljucem JS bi
   (pri /vendor/ "shranjeno najprej") ostal za vedno. HTML je dovoljen samo za lupino. */
const pravaVsebina = (kljuc, odg) => {
  const tip = (odg.headers.get("content-type") || "").toLowerCase();
  return kljuc === LUPINA ? tip.includes("text/html") : !tip.includes("text/html");
};
const shraniOdgovor = (e, kljuc, odg) => {
  if (odg && odg.ok && odg.type === "basic" && pravaVsebina(kljuc, odg)) {
    const kopija = odg.clone();
    e.waitUntil(caches.open(RAZLICICA).then(c => c.put(kljuc, kopija)).catch(() => {}));
  }
  return odg;
};
/* Pri slabem signalu (povezava je, podatki ne tecejo) po 4 s raje shranjena lupina. */
const zOmejitvijo = (obljuba, ms) => new Promise((ok, napaka) => {
  const t = setTimeout(() => napaka(new Error("cas")), ms);
  obljuba.then(v => { clearTimeout(t); ok(v); }, err => { clearTimeout(t); napaka(err); });
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;

  if (r.mode === "navigate") {
    if (!url.pathname.startsWith("/app/")) return;
    const omrezje = fetch(LUPINA, { cache: "no-cache", credentials: "same-origin" });
    e.respondWith(caches.match(LUPINA).then(shranjena => zOmejitvijo(omrezje, shranjena ? 4000 : 60000)
      .then(odg => (odg.ok ? shraniOdgovor(e, LUPINA, odg) : shranjena || odg))
      .catch(() => shranjena || omrezje.catch(() => Response.error()))));
    return;
  }
  const p = url.pathname;
  if (p.startsWith("/webapp/") || p === "/supabase-config.js") {
    // cache: "no-cache": vedno preveri pri strezniku (ETag -> 304). Cloudflare doda max-age=14400 in brez tega bi
    // brskalnik 4 ure po objavi dajal stare module poleg novih (29. 9. 2026: aplikacija obvisela na vrtavki).
    e.respondWith(fetch(new Request(r, { cache: "no-cache" })).then(odg => shraniOdgovor(e, p, odg)).catch(() => caches.match(p).then(z => z || Response.error())));
    return;
  }
  if (p.startsWith("/vendor/") || p.startsWith("/assets/fonts/") || /^\/assets\/icon-\d+\.png$/.test(p)) {
    e.respondWith(caches.match(p).then(z => z || fetch(r).then(odg => shraniOdgovor(e, p, odg))));
  }
});
