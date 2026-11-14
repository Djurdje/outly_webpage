/* Prijava z Googlom in Applom. Gumba sta vidna samo za ponudnike, ki so vklopljeni (spodaj).
   GOOGLE (Martin 14. 11. 2026: ime in slika se ne shranjujeta): NE prek Supabase /authorize (ta vedno doda obseg `profile`),
   ampak neposredna preusmeritev na Google (scope=openid email, response_type=id_token, nonce = sha256 surovega noncea, state),
   povratek /app/auth-callback#id_token=..., nato signInWithIdToken (surov nonce) na glavnem odjemalcu. Brez Googlovih skript.
   APPLE: signInWithOAuth (PKCE, locen odjemalec) -> Supabase -> /app/auth-callback?code=... -> exchangeCodeForSession -> setSession.
   Seja nikoli ne nastopa v URL-ju (Google: id_token v fragmentu, ki ga takoj pobrisemo; Apple: enkratna koda). Pogodba: backend
   docs/ARCHITECTURE.md »Prijava z Googlom in Applom« (tocki 1 in 8). Isti kljuci in postopek tece iz landinga (auth.js). */
import { supabase, oauthOdjemalec, KLJUC_OAUTH } from "./supabase.js";
import { TERMS_VERSION } from "./pogoji.js";

/* STIKALO: ponudniki, ki so vklopljeni (Supabase Authentication > Providers). PRAZNO, dokler jih Martin ne vklopi:
   brez vklopljenega ponudnika Supabase vrne golo JSON napako. Ko sta vklopljena: ["google", "apple"]. */
export const OAUTH_PONUDNIKI = [];
/* Spletni Google OAuth client ID (javen; Google Cloud, »Web application«). PRAZEN = gumba Google NI, tudi ob stikalu in ob ?oauth=. */
export const GOOGLE_CLIENT_ID = "";

export const POVRATNA_POT = "/app/auth-callback";
const ZNANI = ["google", "apple"];
export const IME_PONUDNIKA = { google: "Google", apple: "Apple" };
const KLJUC_STIKALA = "outly_oauth";           // sessionStorage: ekipni preklop za ta zavihek
const KLJUC_TOKA = "outly_oauth_tok";          // { next, soglasje, izbris }
const KLJUC_GOOGLE = "outly_oauth_google";     // { nonce, state } (surov nonce ostane samo tu)
export const KLJUC_IZBRIS = "outly_oauth_izbris";   // "pripravljen:<cas>" po uspesni ponovni prijavi za izbris racuna
const OKNO_IZBRISA_MS = 10 * 60 * 1000;

/** Racun iz Googla/Appla (app_metadata.provider): brez gesla. */
export const jeOAuthRacun = p => !!p && p !== "email";

/* Ekipni preklop kot ?gost=1 (gost.js): ?oauth=1 vklopi oba, ?oauth=google,apple izbrana, ?oauth=0 pobrise. Velja za ta zavihek
   (sessionStorage), prebere se ob prvem nalaganju tega modula (odprite /app/login?oauth=1). Google brez GOOGLE_CLIENT_ID ne deluje. */
(function () {
  let q = null;
  try { q = new URLSearchParams(location.search).get("oauth"); } catch { /* brez */ }
  if (q === null) return;
  try {
    if (q === "0") sessionStorage.removeItem(KLJUC_STIKALA);
    else sessionStorage.setItem(KLJUC_STIKALA, q === "1" ? ZNANI.join(",") : q.split(",").filter(p => ZNANI.includes(p)).join(","));
  } catch { /* brez shranjevanja */ }
})();

/** Vklopljeni ponudniki v vrstnem redu prikaza (Google, Apple). */
export function vklopljeniPonudniki() {
  let ekipa = [];
  try { ekipa = (sessionStorage.getItem(KLJUC_STIKALA) || "").split(","); } catch { /* brez */ }
  return ZNANI.filter(p => (OAUTH_PONUDNIKI.includes(p) || ekipa.includes(p)) && (p !== "google" || !!GOOGLE_CLIENT_ID));
}

/** Samo poti znotraj aplikacije (ali domaca stran /about za prijavo z landinga); povratna pot sama ne sme biti cilj (zanka). */
export function varnaPot(n) {
  if (n === "/about") return n;
  return typeof n === "string" && n.startsWith("/app") && !n.startsWith("//") && !/^\/app\/auth-callback(\/|\?|$)/.test(n) ? n : "/app";
}

const nakljucno = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, "0")).join("");
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Pobrise vse stanje prijave (nonce/state, cilj, preverjevalnik kode Apple, seja pomoznega odjemalca). Klic ob uspehu, napaki in »Back«. */
export function pocistiOAuthStanje() {
  try { [KLJUC_TOKA, KLJUC_GOOGLE, KLJUC_IZBRIS].forEach(k => sessionStorage.removeItem(k)); } catch { /* brez */ }
  pocistiPomozni();
}
function pocistiPomozni() {
  // Vsi kljuci pomoznega odjemalca (seja, -user, preverjevalnik kode; ime kljuca preverjevalnika je odvisno od razlicice knjiznice).
  try { Object.keys(localStorage).filter(k => k.startsWith(KLJUC_OAUTH)).forEach(k => localStorage.removeItem(k)); } catch { /* brez */ }
}

/** Zacne prijavo: shrani cilj in cas privolitve (za zapis terms_accepted_at ob prvem vstopu), nato navigacija na Google/Supabase.
    izbris: ponovna prijava pred izbrisom racuna (po povratku zaslon izbrisa dobi znamenje »pripravljen«). */
export async function zacniOAuth(ponudnik, naprej, { izbris = false } = {}) {
  if (!ZNANI.includes(ponudnik)) throw new Error("Neznan ponudnik");
  if (ponudnik === "google" && !GOOGLE_CLIENT_ID) throw new Error("Google ni nastavljen");
  try { sessionStorage.setItem(KLJUC_TOKA, JSON.stringify({ next: varnaPot(naprej), soglasje: new Date().toISOString(), izbris })); } catch { /* brez: cilj je /app */ }
  if (ponudnik === "google") {
    const nonce = nakljucno(), state = nakljucno();
    try { sessionStorage.setItem(KLJUC_GOOGLE, JSON.stringify({ nonce, state })); } catch { throw new Error("Brez sessionStorage"); }
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");   // stalen naslov: preusmeritev iz podatkov ne obstaja
    u.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: location.origin + POVRATNA_POT, response_type: "id_token",
      scope: "openid email",   // BREZ `profile`: ime in slika iz Googla se ne shranjujeta
      nonce: await sha256hex(nonce), state, prompt: "select_account"
    }).toString();
    location.assign(u.href);
    return;
  }
  const c = await oauthOdjemalec();
  const { data, error } = await c.auth.signInWithOAuth({
    provider: ponudnik,
    options: { redirectTo: location.origin + POVRATNA_POT, skipBrowserRedirect: true }   // navigiramo sami, po preverbi naslova (spodaj)
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
  const napaka = get("error");
  const r = { code: q.get("code") || "", idToken: h.get("id_token") || "", state: h.get("state") || q.get("state") || "", napaka, koda: get("error_code") || napaka };
  // Koda, id_token in napaka gredo takoj iz naslovne vrstice (zgodovina, Referer, osvezitev ne sme znova porabiti kode).
  history.replaceState(history.state, "", location.pathname);
  return r;
}
const preberiJson = k => { try { return JSON.parse(sessionStorage.getItem(k) || "null") || null; } catch { return null; } };

async function izvedi() {
  const r = preberiPovratek();
  const tok = preberiJson(KLJUC_TOKA) || {}, google = preberiJson(KLJUC_GOOGLE);
  try { sessionStorage.removeItem(KLJUC_TOKA); sessionStorage.removeItem(KLJUC_GOOGLE); } catch { /* brez */ }
  const naprej = varnaPot(tok.next);
  try {
    if (r.napaka) { pocistiPomozni(); return { napaka: { koda: r.koda } }; }

    if (r.idToken) {   // Google
      // Preverba state PRED klicem Supabase; surov nonce samo od tod (nikoli iz URL-ja). Neujemanje = tuj povratek.
      if (!google || !google.state || !google.nonce || r.state !== google.state) { pocistiPomozni(); return { napaka: { koda: "" } }; }
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: r.idToken, nonce: google.nonce });
      if (error) return { napaka: { e: error } };
      return await koncajVstop((data && data.user) || (data && data.session && data.session.user), tok, naprej);
    }

    if (r.code) {   // Apple (PKCE)
      const c = await oauthOdjemalec();
      const { data, error } = await c.auth.exchangeCodeForSession(r.code);
      if (error) return { napaka: { e: error } };
      const s = data.session;
      // Sejo prevzame glavni odjemalec (isti kljuc in tok kot ostale prijave); pomozni odjemalec je opravil.
      const v = await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      if (v.error) return { napaka: { e: v.error } };
      return await koncajVstop((v.data && v.data.user) || s.user, tok, naprej);
    }

    pocistiPomozni();
    return { prazno: true, naprej };   // brez veljavnega povratka (osvezitev, ročen vnos poti): prijavljen uporabnik gre naprej
  } catch (e) {
    return { napaka: { e } };
  } finally { pocistiPomozni(); }
}

async function koncajVstop(uporabnik, tok, naprej) {
  // Prvi vstop: dokaz privolitve kot pri registraciji. Napaka sejo NE odjavi (zapis se ponovi ob naslednjem vstopu).
  if (uporabnik && !(uporabnik.user_metadata && uporabnik.user_metadata.terms_version)) {
    try { await supabase.auth.updateUser({ data: { terms_version: TERMS_VERSION, terms_accepted_at: tok.soglasje || new Date().toISOString() } }); } catch { /* brez */ }
  }
  if (tok.izbris) { try { sessionStorage.setItem(KLJUC_IZBRIS, "pripravljen:" + Date.now()); } catch { /* brez */ } }
  return { naprej };
}

/** Zaslon izbrisa: ali je uporabnik pravkar opravil ponovno prijavo za izbris (znamenje se vedno porabi). */
export function porabiZnamenjeIzbrisa() {
  let v = "";
  try { v = sessionStorage.getItem(KLJUC_IZBRIS) || ""; sessionStorage.removeItem(KLJUC_IZBRIS); } catch { /* brez */ }
  const m = /^pripravljen:(\d+)$/.exec(v);
  return !!m && Date.now() - Number(m[1]) < OKNO_IZBRISA_MS;
}
