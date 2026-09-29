/* Service worker spletne aplikacije (faza 5). Streze se z /webapp/sw.js, velja za /app/ (glava Service-Worker-Allowed
   v _headers). Namen: namestljiva PWA in lupina, ki se odpre tudi brez povezave.
   - Navigacija pod /app/: vedno lupina /app/ (omrezje najprej, ob izpadu shranjena). Tako globoka povezava
     (/app/event/12) ne gre cez korensko index.html in vstop.js.
   - /webapp/* (koda brez razlicice v imenu): omrezje najprej, shranjeno samo ob izpadu - po objavi nikoli stara koda.
   - /vendor/*, pisave, ikone (razlicica v imenu / se ne spreminjajo): shranjeno najprej.
   - API (backend, Supabase, Cloudinary), vstopnice, ploscice zemljevida: NE prestrezamo (vedno sveze, kot iOS). */
const RAZLICICA = "outly-app-1";
const LUPINA = "/app/";
const JEDRO = [
  LUPINA, "/webapp/app.css", "/webapp/js/main.js", "/webapp/manifest.webmanifest",
  "/vendor/preact-10.29.8.module.js", "/vendor/preact-hooks-10.29.8.module.js", "/vendor/htm-3.1.1.module.js",
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
  e.waitUntil(caches.open(RAZLICICA).then(c => Promise.all(poti.map(p => c.match(p).then(z => z || c.add(p).catch(() => {}))))));
});

const shraniOdgovor = (kljuc, odg) => {
  if (odg && odg.ok && odg.type === "basic") { const kopija = odg.clone(); caches.open(RAZLICICA).then(c => c.put(kljuc, kopija)); }
  return odg;
};

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;

  if (r.mode === "navigate") {
    if (!url.pathname.startsWith("/app/")) return;
    e.respondWith(fetch(LUPINA, { cache: "no-cache", credentials: "same-origin" })
      .then(odg => (odg.ok ? shraniOdgovor(LUPINA, odg) : caches.match(LUPINA).then(z => z || odg)))
      .catch(() => caches.match(LUPINA).then(z => z || Response.error())));
    return;
  }
  const p = url.pathname;
  if (p.startsWith("/webapp/") || p === "/supabase-config.js") {
    e.respondWith(fetch(r).then(odg => shraniOdgovor(p, odg)).catch(() => caches.match(p).then(z => z || Response.error())));
    return;
  }
  if (p.startsWith("/vendor/") || p.startsWith("/assets/fonts/") || /^\/assets\/icon-\d+\.png$/.test(p)) {
    e.respondWith(caches.match(p).then(z => z || fetch(r).then(odg => shraniOdgovor(p, odg))));
  }
});
