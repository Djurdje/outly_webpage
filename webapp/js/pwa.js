/* PWA (faza 5): registracija service workerja in namestitev na zacetni zaslon.
   Chrome/Android ponudi namestitev (beforeinstallprompt); iOS Safari je nima - tam pokazemo navodila
   (Deli -> Dodaj na zacetni zaslon). Push obvestila niso v obsegu (samo ideja v STATE.md). */
import { ustvariTrgovino, useStore } from "./store.js";

export const pwa = ustvariTrgovino({ ponudba: null, namescena: jeNamescena() });
export const usePwa = () => useStore(pwa);

function jeNamescena() {
  try { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
  catch { return false; }
}
export const jeIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); pwa.set({ ponudba: e }); });
window.addEventListener("appinstalled", () => pwa.set({ ponudba: null, namescena: true }));

/** Chrome: sistemsko okno za namestitev. Vrne true, ce ga je bilo mogoce pokazati. */
export async function namesti() {
  const p = pwa.get().ponudba;
  if (!p) return false;
  pwa.set({ ponudba: null });   // dogodek se uporabi samo enkrat
  try { p.prompt(); const r = await p.userChoice; if (r && r.outcome === "accepted") pwa.set({ namescena: true }); } catch { /* brez */ }
  return true;
}

export function registrirajSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/webapp/sw.js", { scope: "/app/" }).then(() => navigator.serviceWorker.ready).then(reg => {
      // Moduli, ki jih je stran ze nalozila, gredo v predpomnilnik (lupina dela brez povezave ze ob naslednjem odprtju).
      const poti = performance.getEntriesByType("resource")
        .map(r => { try { const u = new URL(r.name); return u.origin === location.origin ? u.pathname : ""; } catch { return ""; } })
        .filter(p => /^\/(webapp|vendor)\//.test(p));
      if (reg.active) reg.active.postMessage({ tip: "shrani", poti });
    }).catch(() => { /* brez SW aplikacija dela naprej */ });
  });
}
