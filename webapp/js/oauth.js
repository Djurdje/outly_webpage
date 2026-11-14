/* Prijava z Googlom in Applom (Supabase OAuth, PKCE). Gumba sta vidna samo za ponudnike, ki so vklopljeni (spodaj).
   Tok: gumb -> signInWithOAuth (URL sestavi knjiznica, brez omrezja) -> navigacija na Supabase /auth/v1/authorize -> ponudnik ->
   Supabase -> /app/auth-callback?code=... (ali ?error=...) -> exchangeCodeForSession -> seja v glavnega odjemalca -> GET /me.
   Preverjevalnik kode ostane v localStorage pod svojim kljucem (KLJUC_OAUTH), zato povratek v drug brskalnik/vgrajeni brskalnik
   ne uspe (to je namen PKCE). Seja v URL-ju nikoli ne nastopa, samo enkratna koda. */
import { supabase, oauthOdjemalec, KLJUC_OAUTH } from "./supabase.js";
import { TERMS_VERSION } from "./pogoji.js";

/* STIKALO: ponudniki, ki so vklopljeni v Supabase (Authentication > Providers). PRAZNO, dokler jih Martin ne vklopi:
   brez vklopljenega ponudnika Supabase na /authorize vrne golo JSON napako. Ko sta vklopljena: ["google", "apple"]. */
export const OAUTH_PONUDNIKI = [];

export const POVRATNA_POT = "/app/auth-callback";
const ZNANI = ["google", "apple"];
const KLJUC_STIKALA = "outly_oauth";
const KLJUC_TOKA = "outly_oauth_tok";

/* Ekipni preklop kot ?gost=1 (gost.js): ?oauth=1 vklopi oba, ?oauth=google,apple izbrana, ?oauth=0 pobrise. Velja za to napravo
   (localStorage), prebere se ob prvem nalaganju tega modula (odprite /app/login?oauth=1). */
function izUrlja() {
  let q = null;
  try { q = new URLSearchParams(location.search).get("oauth"); } catch { /* brez */ }
  if (q === null) return;
  try {
    if (q === "0") localStorage.removeItem(KLJUC_STIKALA);
    else localStorage.setItem(KLJUC_STIKALA, q === "1" ? ZNANI.join(",") : q.split(",").filter(p => ZNANI.includes(p)).join(","));
  } catch { /* brez shranjevanja */ }
}
izUrlja();

/** Vklopljeni ponudniki v vrstnem redu prikaza (Google, Apple). */
export function vklopljeniPonudniki() {
  let ekipa = [];
  try { ekipa = (localStorage.getItem(KLJUC_STIKALA) || "").split(","); } catch { /* brez */ }
  return ZNANI.filter(p => OAUTH_PONUDNIKI.includes(p) || ekipa.includes(p));
}

/** Samo poti znotraj aplikacije; povratna pot sama ne sme biti cilj (zanka). */
export function varnaPot(n) {
  return typeof n === "string" && n.startsWith("/app") && !n.startsWith("//") && !/^\/app\/auth-callback(\/|\?|$)/.test(n) ? n : "/app";
}

/** Zacne prijavo: shrani cilj in cas privolitve (za zapis terms_accepted_at ob prvem vstopu), nato navigacija na Supabase. */
export async function zacniOAuth(ponudnik, naprej) {
  if (!ZNANI.includes(ponudnik)) throw new Error("Neznan ponudnik");
  try { sessionStorage.setItem(KLJUC_TOKA, JSON.stringify({ next: varnaPot(naprej), soglasje: new Date().toISOString() })); } catch { /* brez: cilj je /app */ }
  const c = await oauthOdjemalec();
  const { data, error } = await c.auth.signInWithOAuth({
    provider: ponudnik,
    options: {
      redirectTo: location.origin + POVRATNA_POT,
      skipBrowserRedirect: true,   // navigiramo sami, po preverbi naslova (spodaj)
      ...(ponudnik === "google" ? { queryParams: { prompt: "select_account" } } : {})
    }
  });
  if (error) throw error;
  // Beli seznam: samo Supabasov /authorize nase prijave (navigacija na drug naslov bi bila odprta preusmeritev).
  const cfg = window.OUTLY_SUPABASE;
  const u = new URL(data.url);
  if (u.origin !== new URL(cfg.url).origin || u.pathname !== "/auth/v1/authorize") throw new Error("Nepricakovan naslov prijave");
  location.assign(u.href);
}

/* ---- Povratek (/app/auth-callback) ---- */
let tece = null;   // ponovni izris (leno nalaganje, menjava jezika) ne sme dvakrat porabiti kode
export function dokoncajOAuth() {
  if (!tece) tece = izvedi();
  return tece;
}

function preberiPovratek() {
  const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const get = k => q.get(k) || h.get(k) || "";
  const r = { code: q.get("code") || "", napaka: get("error"), koda: get("error_code") || get("error") };
  // Koda in napaka gresta takoj iz naslovne vrstice (zgodovina, Referer, osvezitev ne sme znova porabiti kode).
  history.replaceState(history.state, "", location.pathname);
  return r;
}

async function izvedi() {
  const r = preberiPovratek();
  let tok = {};
  try { tok = JSON.parse(sessionStorage.getItem(KLJUC_TOKA) || "{}") || {}; sessionStorage.removeItem(KLJUC_TOKA); } catch { /* brez */ }
  const naprej = varnaPot(tok.next);
  if (r.napaka) return { napaka: { koda: r.koda } };
  if (!r.code) return { napaka: { koda: "" } };
  try {
    const c = await oauthOdjemalec();
    const { data, error } = await c.auth.exchangeCodeForSession(r.code);
    if (error) { pocistiPomozni(); return { napaka: { e: error } }; }
    const s = data.session;
    // Sejo prevzame glavni odjemalec (isti kljuc in tok kot ostale prijave); pomozni odjemalec je opravil.
    const v = await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    pocistiPomozni();
    if (v.error) return { napaka: { e: v.error } };
    const uporabnik = (v.data && v.data.user) || s.user;
    // Prvi vstop: dokaz privolitve kot pri registraciji. Napaka sejo NE odjavi (zapis se ponovi ob naslednjem vstopu).
    if (uporabnik && !(uporabnik.user_metadata && uporabnik.user_metadata.terms_version)) {
      try { await supabase.auth.updateUser({ data: { terms_version: TERMS_VERSION, terms_accepted_at: tok.soglasje || new Date().toISOString() } }); } catch { /* brez */ }
    }
    return { naprej };
  } catch (e) {
    pocistiPomozni();
    return { napaka: { e } };
  }
}

function pocistiPomozni() {
  // Vsi kljuci pomoznega odjemalca (seja, -user, preverjevalnik kode; ime kljuca preverjevalnika je odvisno od razlicice knjiznice).
  try { Object.keys(localStorage).filter(k => k.startsWith(KLJUC_OAUTH)).forEach(k => localStorage.removeItem(k)); } catch { /* brez */ }
}
