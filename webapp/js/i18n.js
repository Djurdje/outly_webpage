/* Jezik: en (privzeto) | sl, enako kot iOS (Jezik.swift). Kljuc je angleski niz;
   slovenski prevodi so v i18n-sl.js. Preklop brez osvezitve strani (trgovina jezik). */
import { ustvariTrgovino, useStore, lokalno } from "./store.js";

/* Slovenski prevodi (~40 KB) se nalozijo samo, ce je izbrana slovenscina (faza 5: manj ob prvem obisku). */
let SL = {};
let slNalozen = null;
function naloziSl() {
  if (!slNalozen) slNalozen = import("./i18n-sl.js").then(m => { SL = m.SL; }).catch(e => { slNalozen = null; throw e; });
  return slNalozen;
}

const KLJUC = "outly_jezik";

function zacetniJezik() {
  const shranjen = lokalno.get(KLJUC);
  if (shranjen === "en" || shranjen === "sl") return shranjen;
  // Kot iOS: slovenscina samo, ce je prvi zeleni jezik naprave slovenski.
  const prvi = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return prvi.toLowerCase().startsWith("sl") ? "sl" : "en";
}

export const jezik = ustvariTrgovino({ koda: zacetniJezik() });
document.documentElement.lang = jezik.get().koda;

/** Pred prvim izrisom: ce je jezik slovenscina, pocakaj na prevode (sicer bi se zaslon najprej pokazal v anglescini). */
export const pripraviJezik = () => (jezik.get().koda === "sl" ? naloziSl().catch(() => {}) : Promise.resolve());

export async function nastaviJezik(koda) {
  if (koda !== "en" && koda !== "sl") return;
  if (koda === "sl") { try { await naloziSl(); } catch { return; } }
  lokalno.set(KLJUC, koda);
  document.documentElement.lang = koda;
  jezik.set({ koda });
}

export const useJezik = () => useStore(jezik, s => s.koda);
export const locale = () => (jezik.get().koda === "sl" ? "sl-SI" : "en-GB");

function vstavi(niz, vrednosti) {
  if (!vrednosti) return niz;
  return niz.replace(/\{(\w+)\}/g, (m, k) => (k in vrednosti ? String(vrednosti[k]) : m));
}

/** t("Hello {name}", { name }) */
export function t(kljuc, vrednosti) {
  let niz = kljuc;
  if (jezik.get().koda === "sl") {
    const p = SL[kljuc];
    if (typeof p === "string") niz = p;
    else if (p && typeof p === "object") niz = p.other || kljuc;
  }
  return vstavi(niz, vrednosti);
}

const pravilaSl = new Intl.PluralRules("sl-SI");
const pravilaEn = new Intl.PluralRules("en-GB");

/** Mnozina: tn("{n} events", n) - v SL slovar poda { one, two, few, other }; v EN "one" pomeni kljuc z "1". */
export function tn(kljucEna, kljucVec, n) {
  const sl = jezik.get().koda === "sl";
  if (sl) {
    const p = SL[kljucVec];
    if (p && typeof p === "object") return vstavi(p[pravilaSl.select(n)] || p.other, { n });
    return vstavi(n === 1 ? t(kljucEna) : t(kljucVec), { n });
  }
  return vstavi(pravilaEn.select(n) === "one" ? kljucEna : kljucVec, { n });
}
