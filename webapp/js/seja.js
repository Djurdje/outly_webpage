/* Seja uporabnika: prijava prek Supabase, profil iz GET /me (kot SessionStore na iOS).
   Vloge odloca streznik; tu samo beremo, kaj je rekel. */
import { supabase, odjemalec, koNalozen } from "./supabase.js";
import { nastaviObraz } from "./posel.js";
import { send, nastaviObZavrnjeniSeji, pocistiPredpomnilnik, pozabiVseKljuceNakupa, imaShranjenoSejo, vzrokZavrnitve } from "./api.js";
import { ApiError } from "./napake.js";
import { ustvariTrgovino, useStore, lokalno } from "./store.js";
import { nastavitve } from "./nastavitve.js";

export const seja = ustvariTrgovino({
  pripravljena: false,   // prvo branje seje iz localStorage je koncano
  prijavljen: false,
  email: "",
  me: null,              // odgovor GET /me
  meNapaka: null,        // napaka zadnjega nalaganja /me (ne 401)
  obvestilo: ""          // npr. "seja je potekla" - pokaze prijava
});

/** Identiteta za Idempotency-Key nakupa: Supabase uid prijavljenega (drug uporabnik = nov kljuc). */
export const uidSeje = () => zadnjiUid || "";

export const useSeja = (izb = s => s) => useStore(seja, izb);

/* E-naslov, ki ga prijavni tok hrani med koraki (koda iz maila, prijava po ponastavitvi gesla). Brise se ob uspesni
   prijavi (views/prijava.js), ob potrditvi kode in ob odjavi - politika zasebnosti (razdelek 8) to obljublja. */
export const KLJUC_CAKAJOCI_MAIL = "outly_cakajoci_mail";
export const pozabiCakajociMail = () => lokalno.set(KLJUC_CAKAJOCI_MAIL, null);

/** Admin (vloga odloca streznik, GET /me): na demo klubu sme kupovati zaradi testiranja (strežnik ga prepusti). */
export const jeAdmin = me => !!me && me.role === "admin";

/** Onboarding: samo navaden uporabnik brez onboarded_at (business/admin nikoli, kot iOS). */
export const potrebujeOnboarding = me => !!me && (me.role || "user") === "user" && !me.onboarded_at;

let zadnjiUid = null;
const CAKANJE_SEJE_MS = 3000;

export async function zacniSejo() {
  nastaviObZavrnjeniSeji(() => odjava("Your session has expired. Please log in again.", "osvezitev zavrnjena"));
  if (!imaShranjenoSejo()) {
    // Gost: seje ni, aplikacija se izrise takoj; supabase-js se nalozi v ozadju, ko je stran nalozena (faza 5).
    posodobiIzSeje(null);
    seja.set({ pripravljena: true });
    poslusajSejo();   // registrira se ob nalozitvi knjiznice (prijava v aplikaciji jo nalozi)
    const kasneje = () => odjemalec().catch(() => {});
    if (document.readyState === "complete") setTimeout(kasneje, 1500); else window.addEventListener("load", () => setTimeout(kasneje, 1500), { once: true });
    return;
  }
  let s = null;
  // P2 (pregled PR #24): getSession() ob poteklem zetonu in mrtvem omrezju osvezuje 25-35 s (ali visi), aplikacija pa do
  // takrat ne bi pokazala nicesar - vratar brez povezave skenerja ne bi odprl. Po ~3 s odloci imaShranjenoSejo() (I10: seja
  // ostane, zeton se osvezi, ko bo omrezje); poznejsi rezultat ali dogodek onAuthStateChange stanje popravi.
  try {
    s = await Promise.race([
      supabase.auth.getSession().then(r => r.data.session),
      new Promise(ok => setTimeout(() => ok(null), CAKANJE_SEJE_MS))
    ]);
  } catch { s = null; }
  posodobiIzSeje(s);
  // Potekel zeton, ki ga zaradi omrezja zdaj ni mogoce osveziti: uporabnik ostane prijavljen (I10),
  // /me pa pove napako in "Try again".
  if (!s && imaShranjenoSejo()) seja.set({ prijavljen: true });
  seja.set({ pripravljena: true });
  if (s || seja.get().prijavljen) naloziMe();
  poslusajSejo();
}

let poslusam = false;
function poslusajSejo() {
  if (poslusam) return;
  poslusam = true;
  // Prek koNalozen: poslusalec se registrira, ko je odjemalec ustvarjen - tudi ce je prvo nalaganje padlo.
  koNalozen(c => c.auth.onAuthStateChange((dogodek, nova) => {
    const prej = zadnjiUid;
    // SIGNED_OUT, ki ga nismo sprozili mi (odjava()) in po katerem je seja se v shrambi: supabase-js je dogodek poslal, shrambe
    // pa ni pocistil (drug zavihek je ze shranil novo sejo, osvezitev zavrzena). Uporabnik ostane prijavljen - prava odjava
    // (ta ali drug zavihek, dokoncna zavrnitev) seje iz shrambe izbrise. Vzrok javimo, da se vidi, ce se to kdaj zgodi.
    if (dogodek === "SIGNED_OUT" && !izrecnaOdjava && imaShranjenoSejo()) { porociloSeje("nepricakovan SIGNED_OUT, seja v shrambi ostane"); return; }
    posodobiIzSeje(nova);
    if (dogodek === "SIGNED_IN" && nova) zahtevajTrajnoShrambo();
    if (dogodek === "SIGNED_OUT") { seja.set({ me: null }); pocistiPredpomnilnik(); pozabiVseKljuceNakupa(); pocistiNaOdjavi().catch(() => {}); }
    else if (nova && nova.user && nova.user.id !== prej) {
      if (prej) pozabiVseKljuceNakupa();   // drug uporabnik: kljuci nakupov prejsnjega ne smejo ostati
      naloziMe();
    }
  }));
}

function posodobiIzSeje(s) {
  zadnjiUid = s && s.user ? s.user.id : null;
  seja.set({ prijavljen: !!s || imaShranjenoSejo(), email: (s && s.user && s.user.email) || "" });
}

/** GET /me; ob 401 (tudi po osvezitvi) je seja mrtva -> odjava. 503 in omrezje: seja ostane. */
export async function naloziMe() {
  try {
    const me = await send("/me", { auth: true });
    seja.set({ me, meNapaka: null });
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await odjava("Your session has expired. Please log in again.");
      return null;
    }
    seja.set({ meNapaka: e });
    return null;
  }
}

/* M5: seznami vstopnic in dogodkov (webapp/js/sken/shramba.js) so podatki kluba - na skupni napravi ne smejo ostati.
   Vrsta se nepoSlanih skenov NE brise (sicer bi odjava izgubila skene, ki jih vrata se niso poslala). Dinamicni uvoz:
   modul skenerja ni del zagonskega grafa. Ne cakamo dlje kot 1,5 s. */
async function pocistiSkener() {
  try {
    await Promise.race([import("./sken/shramba.js").then(m => m.pocistiPodatkeKluba()), new Promise(ok => setTimeout(ok, 1500))]);
  } catch { /* najboljsi trud */ }
}

/* Poslani skeni so v brskalniku najvec 3 dni (politika zasebnosti): ob vsakem zagonu pobrisemo starejse, za vse klube.
   Klice main.js PO izrisu, brez cakanja. Samo ce je bil skener v tem brskalniku kdaj odprt (id naprave v localStorage):
   sicer ne nalagamo modula in ne ustvarjamo baze IndexedDB obiskovalcem, ki skenerja nikoli niso videli. */
export function pocistiStareSkeneOdZagona() {
  let uporabljen = false;
  try { uporabljen = !!localStorage.getItem("outly_sken_naprava"); } catch { /* brez */ }
  if (!uporabljen) return;
  const zazeni = () => import("./sken/shramba.js").then(m => m.pocistiStareSkene()).catch(() => {});
  if (window.requestIdleCallback) requestIdleCallback(zazeni, { timeout: 5000 }); else setTimeout(zazeni, 3000);
}

/* Vse, kar mora ob odjavi izginiti iz brskalnika: nastavitve, obraz profila, seznami skenerja. Isto tece, ko odjavo zazna
   odjemalec Supabase v tem ali v DRUGEM zavihku (dogodek SIGNED_OUT), ne samo ob kliku "Log out" v tem zavihku. */
async function pocistiNaOdjavi() {
  // Lokalne nastavitve niso vezane na racun - na skupni napravi jih ob odjavi pocistimo (zasebnost).
  try { localStorage.removeItem("outly_nastavitve"); } catch { /* brez */ }
  nastavitve.set({ genres: [], maxKm: 20, ageMin: 18, ageMax: 30, priceMin: 0, priceMax: 3000, shranjeno: false });
  nastaviObraz("club");   // obraz lastnika (klubski/osebni) je vezan na prijavljeno osebo
  await pocistiSkener();
}

/* Odjava, ki jo je sprozil uporabnik ali nasa koda (ne supabase-js sam): SIGNED_OUT med njo je pricakovan. */
let izrecnaOdjava = false;

/* Brskalnik naj shrambe te strani (in s tem seje) ne izprazni ob pomanjkanju prostora. Tiho, enkrat na nalaganje strani, samo po
   prijavi. Firefox ob persist() pokaze vprasanje uporabniku - tam ne kliccemo. Chrome odloci sam (priljubljenost, namestitev), Safari
   vrne true/false brez vprasanja. Ne obljublja nic: ITP v Safariju 7-dnevne omejitve s tem ne izklopi (to dela samo namestitev na
   zacetni zaslon). */
let trajnoZahtevano = false;
function zahtevajTrajnoShrambo() {
  if (trajnoZahtevano) return;
  trajnoZahtevano = true;
  try {
    if (/Firefox\//.test(navigator.userAgent)) return;
    const sh = navigator.storage;
    if (sh && sh.persist) Promise.resolve(sh.persisted ? sh.persisted() : false).then(ze => ze || sh.persist()).catch(() => {});
  } catch { /* brez */ }
}

/* Sentry (webapp/porocilo.js): samo kategorija in koda napake - nobenih osebnih podatkov, zetonov ali e-naslovov. */
function porociloSeje(besedilo) {
  try {
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    if (window.outlyPorociloNapake) window.outlyPorociloNapake(new Error(`Seja: ${besedilo}; standalone=${standalone}`));
  } catch { /* brez */ }
}

export async function odjava(obvestilo = "", vzrok = "") {
  if (obvestilo || vzrok) {   // prisilna odjava (ne klik "Log out"): zapisemo, zakaj
    const z = vzrokZavrnitve();
    porociloSeje(`prisilna odjava (${vzrok || "401 /me"})${z ? `, supabase ${z.status} ${z.koda}` : ""}`);
  }
  izrecnaOdjava = true;
  pozabiCakajociMail();   // e-naslov iz prijavnega toka ne sme ostati na skupni napravi
  await pocistiNaOdjavi();
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* lokalno vseeno pocistimo */ }
  pocistiPredpomnilnik();
  pozabiVseKljuceNakupa();   // Idempotency-Key nakupa je vezan na uporabnika: naslednji uporabnik ga ne sme podedovati
  seja.set({ prijavljen: false, me: null, meNapaka: null, obvestilo });
  izrecnaOdjava = false;
}

export function nastaviMe(me) { seja.set({ me }); }

/** PATCH /me vrne samo osnovna polja (brez clubs, pending_*): zdruzi s trenutnim profilom, da znacke in
    klubi ne izginejo do naslednjega GET /me. */
export const zdruzi = novi => ({ ...(seja.get().me || {}), ...(novi || {}) });
