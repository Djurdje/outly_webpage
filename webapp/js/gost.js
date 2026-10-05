/* Nakup vstopnice brez racuna (gost): zeton narocila (guest_token) je skrivnost, s katero kupec odpre svoje vstopnice
   (GET /guest/order, glava X-Guest-Token). Pride s Stripove vrnitve ali iz maila kot ?t=... v URL-ju; takoj ga shranimo
   v sessionStorage (osvezitev strani dela) in ga odstranimo iz naslovne vrstice (zgodovina, Referer). Brez localStorage:
   zeton ne ostane na napravi po zaprtju zavihka; kupec ima povezavo v mailu. */
import "./usmerjanje.js";
const KLJUC = "outly_gost_zeton";
export const jeGostZeton = z => typeof z === "string" && /^[\x21-\x7E]{8,1024}$/.test(z);   // vidni ASCII brez presledka: varen kot vrednost glave

let vPomnilniku = null;   // ce sessionStorage ni na voljo (zasebno okno, blokiran): vsaj do zaprtja strani

export function shraniGostZeton(zeton) {
  if (!jeGostZeton(zeton)) return;
  vPomnilniku = { t: zeton };
  try { sessionStorage.setItem(KLJUC, JSON.stringify(vPomnilniku)); } catch { /* brez */ }
}

export function preberiGostZeton() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KLJUC) || "null");
    if (v && jeGostZeton(v.t)) return { t: v.t };
  } catch { /* brez */ }
  return vPomnilniku && jeGostZeton(vPomnilniku.t) ? vPomnilniku : null;
}

export function pozabiGostZeton() {
  vPomnilniku = null;
  try { sessionStorage.removeItem(KLJUC); } catch { /* brez */ }
}

/** Zeton iz URL-ja: #t=<zeton> (prednostno; fragment nikoli ne gre na streznik ali v Referer) ali ?t=<zeton> (za vsak slucaj).
    Shrani ga in ga takoj odstrani iz naslovne vrstice (replaceState); drugi parametri in fragment ostanejo. Vrne zeton ali null. */
export function prevzemiZetonIzUrl() {
  let zeton = null, najden = false;
  const fr = new URLSearchParams(location.hash.replace(/^#/, ""));
  const q = new URLSearchParams(location.search);
  if (fr.has("t")) { najden = true; zeton = fr.get("t"); fr.delete("t"); }
  if (q.has("t")) { najden = true; if (!jeGostZeton(zeton)) zeton = q.get("t"); q.delete("t"); }
  if (!najden) return null;
  const iskanje = q.toString(), fragment = fr.toString();
  history.replaceState(history.state, "", location.pathname + (iskanje ? "?" + iskanje : "") + (fragment ? "#" + fragment : ""));
  if (!jeGostZeton(zeton)) return null;
  shraniGostZeton(zeton);
  return zeton;
}
/* Ze ob uvozu (pred varovali v main.js App, ki bi pot z ?next= prepisala v prijavo/onboarding): zeton na strani narocila gre
   iz URL-ja v sessionStorage, preden ga kdorkoli prebere. usmerjanje.js uvozimo zaradi vrstnega reda: najprej razresi ?pot=. */
if (location.pathname === "/app/guest/order") prevzemiZetonIzUrl();

/* Stripe: kupec gre na placilno stran in se lahko vrne (cancel_url /app/event/ID?placilo=preklic) - pomnilnik strani je takrat
   izgubljen. Backend dovoli samo 1 neplacano narocilo na e-naslov in dogodek (30 min), nov kljuc bi dal 409; ISTI kljuc
   (isti e-naslov, dogodek, kolicina) vrne isto narocilo in isti checkout_url. Zato kljuc ob preusmeritvi shranimo v sessionStorage
   ({ e-naslov, dogodek, kolicina, kljuc }; datuma rojstva NE) in ga obrazec ob ponovnem odprtju uporabi. */
const KLJUC_NAKUPA = "outly_gost_nakup";
const ZIVLJENJE_NAKUPA_MS = 6 * 3600e3;
export function shraniGostNakup(zapis) {
  try { sessionStorage.setItem(KLJUC_NAKUPA, JSON.stringify({ ...zapis, ob: Date.now() })); } catch { /* brez */ }
}
export function preberiGostNakup(dogodek) {
  try {
    const z = JSON.parse(sessionStorage.getItem(KLJUC_NAKUPA) || "null");
    if (!z) return null;
    if (!(Date.now() - z.ob < ZIVLJENJE_NAKUPA_MS)) { pozabiGostNakup(); return null; }   // potekel: izbrisi (ne samo prezri)
    if (z.d === dogodek && typeof z.e === "string" && Number.isInteger(z.q) && /^[0-9a-f-]{36}$/i.test(z.k || "")) return z;
  } catch { pozabiGostNakup(); }
  return null;
}
/** kljuc (neobvezno): zapis se pobrise samo, ce vsebuje ta kljuc (zavrzen kljuc; zaostal odgovor ne sme pobrisati tujega zapisa). */
export function pozabiGostNakup(kljuc) {
  try {
    if (kljuc) { const z = JSON.parse(sessionStorage.getItem(KLJUC_NAKUPA) || "null"); if (z && z.k !== kljuc) return; }
    sessionStorage.removeItem(KLJUC_NAKUPA);
  } catch { try { sessionStorage.removeItem(KLJUC_NAKUPA); } catch { /* brez */ } }
}

/* ZASTAVICA: nakup brez racuna je privzeto SKRIT (pravno: politika zasebnosti gosta, GDPR 13, se ni objavljena; pravno/2026-10-05-gostujoci-nakup.md 4.2).
   Neprijavljen ob nakupu vidi stari tok (Sign in). Vklop: GOST_NAKUP_JAVNO = true (javna objava) ALI ekipni preklop
   ?gost=1 v URL-ju (zapomni se v localStorage outly_gost=1), ?gost=0 ga izklopi. Stran /app/guest/order deluje vedno (povezava iz maila). */
export const GOST_NAKUP_JAVNO = false;
const KLJUC_ZASTAVICE = "outly_gost";
export function gostNakupVklopljen() {
  let q = null;
  try { q = new URLSearchParams(location.search).get("gost"); } catch { /* brez */ }
  try {
    if (q === "1") localStorage.setItem(KLJUC_ZASTAVICE, "1");
    else if (q === "0") localStorage.removeItem(KLJUC_ZASTAVICE);
  } catch { /* brez shranjevanja: velja samo ta obisk */ }
  if (GOST_NAKUP_JAVNO) return true;
  if (q === "1") return true;
  if (q === "0") return false;
  try { return localStorage.getItem(KLJUC_ZASTAVICE) === "1"; } catch { return false; }
}
gostNakupVklopljen();   // ?gost=1 na kateremkoli /app naslovu se zapomni takoj ob zagonu
