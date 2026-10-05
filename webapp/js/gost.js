/* Nakup vstopnice brez racuna (gost): zeton narocila (guest_token) je skrivnost, s katero kupec odpre svoje vstopnice
   (GET /guest/order, glava X-Guest-Token). Pride s Stripove vrnitve ali iz maila kot ?t=... v URL-ju; takoj ga shranimo
   v sessionStorage (osvezitev strani dela) in ga odstranimo iz naslovne vrstice (zgodovina, Referer). Brez localStorage:
   zeton ne ostane na napravi po zaprtju zavihka; kupec ima povezavo v mailu. */
const KLJUC = "outly_gost_zeton";
export const jeGostZeton = z => typeof z === "string" && /^[\x21-\x7E]{8,1024}$/.test(z);   // vidni ASCII brez presledka: varen kot vrednost glave

let vPomnilniku = null;   // ce sessionStorage ni na voljo (zasebno okno, blokiran): vsaj do zaprtja strani

/** test = nakup v testnem nacinu (nic se ni zaracunalo) - samo za napis na strani narocila. */
export function shraniGostZeton(zeton, test = false) {
  if (!jeGostZeton(zeton)) return;
  vPomnilniku = { t: zeton, test: !!test };
  try { sessionStorage.setItem(KLJUC, JSON.stringify(vPomnilniku)); } catch { /* brez */ }
}

export function preberiGostZeton() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KLJUC) || "null");
    if (v && jeGostZeton(v.t)) return { t: v.t, test: !!v.test };
  } catch { /* brez */ }
  return vPomnilniku && jeGostZeton(vPomnilniku.t) ? vPomnilniku : null;
}

export function pozabiGostZeton() {
  vPomnilniku = null;
  try { sessionStorage.removeItem(KLJUC); } catch { /* brez */ }
}

/** ?t=<zeton> iz URL-ja: shrani ga in ga odstrani iz naslovne vrstice (replaceState). Vrne zeton ali null. */
export function prevzemiZetonIzUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has("t")) return null;
  const zeton = q.get("t");
  q.delete("t");
  const ostalo = q.toString();
  history.replaceState(history.state, "", location.pathname + (ostalo ? "?" + ostalo : "") + location.hash);
  if (!jeGostZeton(zeton)) return null;
  const prej = preberiGostZeton();
  shraniGostZeton(zeton, !!(prej && prej.t === zeton && prej.test));
  return zeton;
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
