/* Zemljevid (faza 3): MapLibre GL + Protomaps (PMTiles), vse gostovano na outly.si - brez tujih strezni kov
   ploscic (OSM javni strezniki za aplikacije niso dovoljeni). Podatki (karta/*.pmtiles, izrez gradnje Protomaps):
   - slovenija.pmtiles: cela Slovenija do povecave 10 (mesta, ceste),
   - ljubljana.pmtiles, maribor.pmtiles: povecave 11-15 (ulice, stavbe) tam, kjer so klubi.
   Cloudflare Pages dovoli najvec 25 MB na datoteko - za celo Slovenijo z ulicami bo potreben R2 (STATE.md).
   Knjiznice (~1 MB) se nalozijo sele, ko je zemljevid prvic potreben. */
import { jezik } from "./i18n.js";

const V = "/vendor/";
const DATOTEKE = {
  css: V + "maplibre-gl-5.24.0.css",
  maplibre: V + "maplibre-gl-csp-5.24.0.js",
  delavec: V + "maplibre-gl-csp-worker-5.24.0.js",
  pmtiles: V + "pmtiles-4.5.0.js",
  basemaps: V + "protomaps-basemaps-5.7.2.js"
};
const MESTA = [
  { url: "/karta/ljubljana.pmtiles", bbox: [14.35, 45.97, 14.66, 46.15] },
  { url: "/karta/maribor.pmtiles", bbox: [15.55, 46.51, 15.72, 46.60] }
];
/** Najvecja smiselna povecava na tocki: ulice (z16) samo v mestih z arhivom, drugod z12 (sicer prazen zaslon). */
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
/** Nalozi knjiznice enkrat; vrne { maplibregl, pmtiles, basemaps }. */
export function naloziKnjiznice() {
  if (nalaganje) return nalaganje;
  nalaganje = (async () => {
    if (!document.querySelector(`link[href="${DATOTEKE.css}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = DATOTEKE.css;
      document.head.appendChild(l);
    }
    await skripta(DATOTEKE.pmtiles);
    await skripta(DATOTEKE.basemaps);
    await skripta(DATOTEKE.maplibre);
    const { maplibregl, pmtiles, basemaps } = window;
    maplibregl.setWorkerUrl(DATOTEKE.delavec);   // CSP gradnja: delavec z nase domene (brez blob:)
    const protokol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protokol.tile);
    // Vir "mesta": za vsako ploscico izbere arhiv mesta, ki jo pokriva; drugod prazna ploscica (brez napake),
    // pod njo pa se vidi slovenija.pmtiles (povecana).
    const arhivi = MESTA.map(m => ({ ...m, a: new pmtiles.PMTiles(m.url) }));
    maplibregl.addProtocol("mesta", async (params, krmilnik) => {
      const [z, x, y] = params.url.replace("mesta://", "").split("/").map(Number);
      const n = 2 ** z;
      const lng = v => (v / n) * 360 - 180;
      const lat = v => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
      const [z0, z1, s0, s1] = [lng(x), lng(x + 1), lat(y + 1), lat(y)];   // zahod, vzhod, jug, sever ploscice
      // Ploscica ob robu mesta seka bbox, cetudi je njeno sredisce zunaj - zato presek, ne sredisce.
      for (const a of arhivi) {
        if (z1 < a.bbox[0] || z0 > a.bbox[2] || s1 < a.bbox[1] || s0 > a.bbox[3]) continue;
        const r = await a.a.getZxy(z, x, y, krmilnik && krmilnik.signal);
        if (r && r.data) return { data: new Uint8Array(r.data) };
      }
      return { data: new Uint8Array(0) };
    });
    return { maplibregl, pmtiles, basemaps };
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
      // Napisi ulic iz slovenija.pmtiles le do povecave 11 - naprej jih nadomestijo podrobnejsi iz mest. Imena krajev
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
      slo: { type: "vector", url: "pmtiles://" + location.origin + "/karta/slovenija.pmtiles",
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>' },
      mesta: { type: "vector", tiles: ["mesta://{z}/{x}/{y}"], minzoom: 11, maxzoom: 15 }
    },
    layers: [
      ...prilagodiSloje(basemaps.layers("slo", barve, { lang }), "s-", "slo"),
      ...prilagodiSloje(basemaps.layers("mesta", barve, { lang }), "m-", "mesta")
    ]
  };
}
