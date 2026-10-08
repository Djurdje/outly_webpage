/* Casovno okno skeniranja (8. 10. 2026, Martin): vratar NE izbira dogodka - dogodek se prebere iz kode QR.
   Vstopnica velja za skeniranje, ce je njen dogodek AKTIVEN: zdaj je med 12 h pred zacetkom in 6 h po koncu.
   Konec = end_at, ce ga ni, zacetek + 12 h (enako kot prej privzetiDogodek). Vse konstante in pravila so samo tu
   (cista datoteka brez uvozov, da jo preizkusi tudi node); iOS dela isto vzporedno. Vrata se odprejo 12 h pred
   zacetkom kot na backendu (SKEN_REZERVA_PRED_ZACETKOM_MS). */

const URA = 3600 * 1000;
export const OKNO_PRED_MS = 12 * URA;        // skeniranje se odpre toliko pred zacetkom
export const OKNO_PO_MS = 6 * URA;           // in se zapre toliko po koncu
export const PRIVZETO_TRAJANJE_MS = 12 * URA; // dogodek brez end_at

const cas = v => { const m = Date.parse(v); return Number.isFinite(m) ? m : null; };

/** Samo objavljeni dogodki. Ce odgovor statusa ne vsebuje (starejsi zapis v shrambi), dogodka ne zavrnemo. */
export const jeObjavljen = e => !e || typeof e.status !== "string" || e.status === "published";

/** Konec dogodka v ms (end_at, sicer zacetek + 12 h); null, ce zacetka ni. */
export function konecDogodka(e) {
  const z = cas(e && e.start_at);
  if (z === null) return null;
  const k = cas(e.end_at);
  return k !== null ? k : z + PRIVZETO_TRAJANJE_MS;
}

/** Ali je dogodek zdaj v oknu [zacetek - 12 h, konec + 6 h] (meji sta vkljuceni). */
export function jeAktiven(e, zdaj = Date.now()) {
  if (!e || !jeObjavljen(e)) return false;
  const z = cas(e.start_at);
  if (z === null) return false;
  return zdaj >= z - OKNO_PRED_MS && zdaj <= konecDogodka(e) + OKNO_PO_MS;
}

/** VSI aktivni dogodki, po zacetku. */
export function aktivniDogodki(dogodki, zdaj = Date.now()) {
  return (Array.isArray(dogodki) ? dogodki : []).filter(e => jeAktiven(e, zdaj)).sort((a, b) => cas(a.start_at) - cas(b.start_at) || a.id - b.id);
}

/** Naslednji dogodek, katerega skeniranje se se ni odprlo (najblizji zacetek); sicer null. */
export function naslednjiDogodek(dogodki, zdaj = Date.now()) {
  let najboljsi = null;
  for (const e of Array.isArray(dogodki) ? dogodki : []) {
    const z = cas(e && e.start_at);
    if (z === null || !jeObjavljen(e) || zdaj >= z - OKNO_PRED_MS) continue;
    if (!najboljsi || z < cas(najboljsi.start_at)) najboljsi = e;
  }
  return najboljsi;
}

/** Cas, ko se skeniranje dogodka odpre (ms). */
export const odpreSeOb = e => cas(e && e.start_at) - OKNO_PRED_MS;
