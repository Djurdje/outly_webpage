/* Usmerjanje z zgodovino brskalnika: vsak zaslon ima svoj URL (/app/event/12 ...), gumb Nazaj
   v brskalniku dela, povezave se lahko delijo. Cloudflare Pages vse /app/* streze z app/index.html
   (_redirects), zato je vsak URL tudi vstopna tocka. */
import { ustvariTrgovino, useStore } from "./store.js";

const POTI = [
  ["/app", "home"],
  ["/app/search", "search"],
  ["/app/map", "map"],
  ["/app/profile", "profile"],
  ["/app/events", "events"],
  ["/app/interested", "interested"],
  ["/app/genre/:genre", "genre"],
  ["/app/event/:id", "event"],
  ["/app/club/:id", "club"],
  ["/app/tickets", "tickets"],
  ["/app/login", "login"],
  ["/app/register", "register"],
  ["/app/verify", "verify"],
  ["/app/forgot", "forgot"],
  ["/app/onboarding", "onboarding"],
  ["/app/language", "language"],
  ["/app/account", "account"],
  ["/app/account/personal", "personal"],
  ["/app/account/security", "security"],
  ["/app/account/preferences", "preferences"],
  ["/app/account/my-preferences", "my-preferences"],
  ["/app/account/delete", "delete"],
  ["/app/account/creator", "creator"],
  ["/app/payment", "payment"],
  ["/app/help", "help"],
  ["/app/help/:id", "article"],
  ["/app/about", "about"],
  ["/app/friends", "friends"],
  ["/app/friends-plans", "friends-plans"],
  ["/app/my-clubs", "my-clubs"],
  ["/app/invites", "invites"],
  // Poslovni del (faza 4): klub je v poti, vsak klic ga poslje v glavi X-Outly-Club.
  ["/app/business/:klub", "biz"],
  ["/app/business/:klub/settings", "biz-settings"],
  ["/app/business/:klub/dashboard", "biz-dashboard"],
  ["/app/business/:klub/staff/:clan", "biz-staff"],
  ["/app/business/:klub/events", "biz-events"],
  ["/app/business/:klub/events/new", "biz-event-new"],
  ["/app/business/:klub/events/:dogodek/edit", "biz-event-edit"],
  ["/app/business/:klub/events/:dogodek/tickets", "biz-event-tickets"],
  ["/app/business/:klub/team", "biz-team"],
  ["/app/business/:klub/info", "biz-info"],
  ["/app/business/:klub/location", "biz-location"],
  ["/app/business/:klub/bar-prices", "biz-bar-prices"],
  ["/app/business/:klub/scan", "biz-scan"]
].map(([vzorec, ime]) => {
  const imena = [];
  const re = new RegExp("^" + vzorec.replace(/:(\w+)/g, (m, k) => { imena.push(k); return "([^/]+)"; }) + "/?$");
  return { re, imena, ime };
});

export function razcleni(pathname) {
  for (const p of POTI) {
    const m = p.re.exec(pathname);
    if (m) {
      const params = {};
      p.imena.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { ime: p.ime, params };
    }
  }
  return { ime: "notfound", params: {} };
}

/* Globoka povezava prek preusmeritve (webapp/vstop.js): /app/?pot=/app/event/12 -> /app/event/12.
   Samo poti znotraj aplikacije. */
(function () {
  const pot = new URLSearchParams(location.search).get("pot");
  if (!pot) return;
  try {
    // Normaliziran URL (../, %2e ...) mora ostati na istem izvoru IN pod /app/.
    const u = new URL(pot, location.origin);
    if (u.origin === location.origin && u.pathname.startsWith("/app/")) {
      history.replaceState(history.state, "", u.pathname + u.search + location.hash);
    }
  } catch { /* neveljavna pot - ostanemo na /app/ */ }
})();

/* /app brez posevnice ni v obsegu service workerja (/app/) - kanonicni naslov je /app/ (sicer brez povezave ne dela). */
if (location.pathname === "/app") history.replaceState(history.state, "", "/app/" + location.search + location.hash);

let stevec = (history.state && history.state.k) || 0;
let globina = (history.state && history.state.g) || 0;
const drsenja = new Map();   // kljuc vnosa -> scrollY

function trenutno(smer) {
  const { ime, params } = razcleni(location.pathname);
  return {
    ime, params, smer,
    pot: location.pathname,
    iskanje: new URLSearchParams(location.search),
    kljuc: (history.state && history.state.k) || 0
  };
}

if (!history.state || history.state.k === undefined) {
  history.replaceState({ k: stevec, g: globina }, "", location.href);
}

export const usmerjanje = ustvariTrgovino(trenutno("zacetek"));
export const usePot = () => useStore(usmerjanje);

export function navigiraj(url, { zamenjaj = false } = {}) {
  const cilj = new URL(url, location.origin);
  if (cilj.pathname === "/app") cilj.pathname = "/app/";
  if (cilj.origin !== location.origin || !cilj.pathname.startsWith("/app")) { location.href = cilj.href; return; }
  if (cilj.pathname + cilj.search === location.pathname + location.search && !zamenjaj) return;
  drsenja.set(usmerjanje.get().kljuc, window.scrollY);
  stevec += 1;
  if (zamenjaj) history.replaceState({ k: stevec, g: globina }, "", cilj.pathname + cilj.search);
  else { globina += 1; history.pushState({ k: stevec, g: globina }, "", cilj.pathname + cilj.search); }
  usmerjanje.set(trenutno(zamenjaj ? "zamenjava" : "naprej"));
}

/** Nazaj v aplikaciji: ce smo prisli od drugod (deljena povezava), gremo na Home. */
export function nazaj(rezerva = "/app") {
  if (globina > 0) history.back();
  else navigiraj(rezerva, { zamenjaj: true });
}

window.addEventListener("popstate", () => {
  drsenja.set(usmerjanje.get().kljuc, window.scrollY);
  globina = (history.state && history.state.g) || 0;
  usmerjanje.set(trenutno("nazaj"));
});

/** Po izrisu zaslona: ob "nazaj" obnovi drsenje (podatki pridejo asinhrono - poskusa do 1,5 s). */
export function obnoviDrsenje(pot) {
  if (pot.smer !== "nazaj") { window.scrollTo(0, 0); return; }
  const cilj = drsenja.get(pot.kljuc) || 0;
  const zacetek = performance.now();
  const poskusi = () => {
    const najvec = document.documentElement.scrollHeight - window.innerHeight;
    if (najvec >= cilj || performance.now() - zacetek > 1500) { window.scrollTo(0, Math.min(cilj, Math.max(0, najvec))); return; }
    requestAnimationFrame(poskusi);
  };
  requestAnimationFrame(poskusi);
}

/* Klik na <a href="/app/..."> ne nalozi strani znova. */
document.addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (!href || !href.startsWith("/app")) return;
  e.preventDefault();
  navigiraj(href);
});
