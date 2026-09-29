/* Odjemalec Supabase Auth (isti projekt kot iOS in outly.si). Seja je v localStorage pod privzetim kljucem,
   ki ga uporablja tudi auth.js na outly.si - prijava na strani in v spletni aplikaciji je ena.
   supabase-js (~54 KB) se nalozi LENO (faza 5): gost brez shranjene seje ga ob zagonu ne potrebuje, zato ne
   zadrzi prvega izrisa. `supabase.auth.X(...)` vedno vrne obljubo (kot supabase-js) in pocaka na knjiznico. */
function skripta(src) {
  return new Promise((ok, napaka) => {
    const s = document.createElement("script");
    s.src = src; s.async = false;
    s.onload = ok; s.onerror = () => { s.remove(); napaka(new Error("Nalaganje " + src)); };
    document.head.appendChild(s);
  });
}

let obljuba = null;
let odjemalecPripravljen = null;
const cakajo = [];
/** fn(odjemalec) se izvede, ko je odjemalec ustvarjen - pred katerimkoli klicem prek njega (npr. poslusalec seje). */
export function koNalozen(fn) { if (odjemalecPripravljen) fn(odjemalecPripravljen); else cakajo.push(fn); }

/** Ustvarjen odjemalec (knjiznica in nastavitve se nalozita ob prvem klicu). */
export function odjemalec() {
  if (!obljuba) {
    obljuba = (async () => {
      if (!window.OUTLY_SUPABASE) await skripta("/supabase-config.js");
      if (!window.supabase) await skripta("/vendor/supabase-2.115.0.js");
      const cfg = window.OUTLY_SUPABASE;
      const c = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Prijava in ponastavitev gesla gresta s kodo iz maila (kot iOS), ne s povezavo.
          detectSessionInUrl: false
        }
      });
      odjemalecPripravljen = c;
      cakajo.splice(0).forEach(fn => { try { fn(c); } catch { /* brez */ } });
      return c;
    })();
    obljuba.catch(() => { obljuba = null; });   // ob izpadu omrezja poskusimo znova ob naslednjem klicu
  }
  return obljuba;
}

export const supabase = {
  auth: new Proxy({}, { get: (_, ime) => (...argumenti) => odjemalec().then(c => c.auth[ime](...argumenti)) })
};
