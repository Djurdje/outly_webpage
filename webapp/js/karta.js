/* Zemljevid (faza 3): MapLibre GL + Protomaps (vektorske ploscice OSM), vse gostovano na outly.si - brez tujih
   streznikov ploscic (OSM javni strezniki za aplikacije niso dovoljeni). Podatki: karta/<razlicica>/
   - slo/{z}/{x}/{y}.pbf: cela Slovenija do povecave 10 (kraji, ceste),
   - mesta/{z}/{x}/{y}.pbf: povecave 11-15 (ulice, stavbe) v Ljubljani in Mariboru,
   - seznam.json: katere ploscice obstajajo (manjkajoce bi Cloudflare zamenjal s korensko index.html).
   Ploscice so staticne datoteke, ker Cloudflare Pages NE podpira HTTP Range (.pmtiles arhiv tam ne dela - preverjeno
   29. 9. 2026). Nastanejo iz izreza Protomaps z karta/razpakiraj.mjs. Shranjene so stisnjene (gzip), razsirimo jih tu.
   Knjiznice (~1 MB) se nalozijo sele, ko je zemljevid prvic potreben. */
import { jezik } from "./i18n.js";

const V = "/vendor/";
const DATOTEKE = {
  css: V + "maplibre-gl-5.24.0.css",
  maplibre: V + "maplibre-gl-csp-5.24.0.js",
  delavec: V + "maplibre-gl-csp-worker-5.24.0.js",
  basemaps: V + "protomaps-basemaps-5.7.2.js"
};
const PODATKI = "/karta/v20260929/";   // nova razlicica = nova mapa (predpomnilnik 1 dan)
// Obmocja z ulicami (mesta/): Ljubljana, Maribor.
const MESTA = [
  { bbox: [14.35, 45.97, 14.66, 46.15] },
  { bbox: [15.55, 46.51, 15.72, 46.60] }
];
/** Najvecja smiselna povecava na tocki: ulice (z16) samo v mestih s podatki ulic, drugod z12 (sicer prazen zaslon). */
export const povecavaZa = (lng, lat) =>
  (MESTA.some(m => lng >= m.bbox[0] && lng <= m.bbox[2] && lat >= m.bbox[1] && lat <= m.bbox[3]) ? 16 : 12);
export const SLOVENIJA = [[13.37, 45.42], [16.62, 46.88]];
export const LJUBLJANA = [14.5058, 46.0569];

function skripta(src) {
  return new Promise((ok, napaka) => {
    const s = document.createElement("script");
    s.src = src; s.async = false;
    s.onload = ok; s.onerror = () => { s.remove(); napaka(new Error("Nalaganje " + src)); };
    document.head.appendChild(s);
  });
}

let nalaganje = null;
/** Nalozi knjiznice in seznam ploscic enkrat; vrne { maplibregl, basemaps }. */
export function naloziKnjiznice() {
  if (nalaganje) return nalaganje;
  nalaganje = (async () => {
    // Ploscice so gzip; brez DecompressionStream (Safari < 16.4) zemljevid ne gre - ostane seznam klubov.
    if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream ni podprt");
    if (!document.querySelector(`link[href="${DATOTEKE.css}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = DATOTEKE.css;
      document.head.appendChild(l);
    }
    await skripta(DATOTEKE.basemaps);
    await skripta(DATOTEKE.maplibre);
    const { maplibregl, basemaps } = window;
    maplibregl.setWorkerUrl(DATOTEKE.delavec);   // CSP gradnja: delavec z nase domene (brez blob:)
    const seznami = {};
    await Promise.all(["slo", "mesta"].map(async ime => {
      const r = await fetch(PODATKI + ime + "/seznam.json");
      if (!r.ok) throw new Error("seznam ploscic " + r.status);
      seznami[ime] = new Set(await r.json());   // HTML (Cloudflare) -> SyntaxError -> seznam klubov
    }));
    // outly://slo/z/x/y: ploscica, ce obstaja; sicer prazna (brez zahteve - Cloudflare bi vrnil index.html).
    maplibregl.addProtocol("outly", async (params, krmilnik) => {
      const [ime, ...zxy] = params.url.replace("outly://", "").split("/");
      const kljuc = zxy.join("/");
      if (!seznami[ime] || !seznami[ime].has(kljuc)) return { data: new Uint8Array(0) };
      const r = await fetch(PODATKI + ime + "/" + kljuc + ".pbf", { signal: krmilnik && krmilnik.signal });
      if (!r.ok) throw new Error("ploscica " + r.status);
      let b = new Uint8Array(await r.arrayBuffer());
      if (b[0] === 0x3c) return { data: new Uint8Array(0) };   // "<": Cloudflare je namesto ploscice vrnil index.html
      if (b[0] === 0x1f && b[1] === 0x8b) {   // gzip (ce ga CDN ni ze razsiril)
        b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
      }
      return { data: b };
    });
    return { maplibregl, basemaps };
  })();
  nalaganje.catch(() => { nalaganje = null; });
  return nalaganje;
}

/* Pisave gostimo sami pod kratkimi imeni (brez presledkov v poti). */
const PISAVE = { "Noto Sans Regular": "noto-regular", "Noto Sans Medium": "noto-medium", "Noto Sans Italic": "noto-italic" };
function prilagodiSloje(sloji, predpona, samo) {
  return sloji
    // Brez ikon tock (POI): sprite Protomaps nima zapisane licence, zemljevid klubov je brez njih preglednejsi.
    .filter(s => !(s.layout && s.layout["icon-image"]))
    .filter(s => (samo === "mesta" ? s.type !== "background" : true))
    .map(s => {
      const n = { ...s, id: predpona + s.id };
      if (n.layout && Array.isArray(n.layout["text-font"])) {
        n.layout = { ...n.layout, "text-font": n.layout["text-font"].map(f => PISAVE[f] || "noto-regular").slice(0, 1) };
      }
      // Napisi ulic iz slo/ le do povecave 11 - naprej jih nadomestijo podrobnejsi iz mest. Imena krajev
      // ostanejo (zunaj LJ/MB sicer ne bi bilo nobenega napisa); podvojena imena v mestih skrije trk napisov.
      if (samo === "slo" && n.type === "symbol" && n["source-layer"] !== "places") n.maxzoom = Math.min(n.maxzoom ?? 24, 11);
      if (samo === "mesta") n.minzoom = Math.max(n.minzoom ?? 0, 11);
      return n;
    });
}

/** Slog temnega zemljevida (Protomaps "dark"), imena v jeziku aplikacije. */
export function slog({ basemaps }) {
  const lang = jezik.get().koda === "sl" ? "sl" : "en";
  const barve = basemaps.namedFlavor("dark");
  return {
    version: 8,
    glyphs: location.origin + "/karta/pisave/{fontstack}/{range}.pbf",
    sources: {
      slo: { type: "vector", tiles: ["outly://slo/{z}/{x}/{y}"], minzoom: 0, maxzoom: 10,
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>' },
      mesta: { type: "vector", tiles: ["outly://mesta/{z}/{x}/{y}"], minzoom: 11, maxzoom: 15 }
    },
    layers: [
      ...prilagodiSloje(basemaps.layers("slo", barve, { lang }), "s-", "slo"),
      ...prilagodiSloje(basemaps.layers("mesta", barve, { lang }), "m-", "mesta")
    ]
  };
}
