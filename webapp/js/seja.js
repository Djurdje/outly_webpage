/* Seja uporabnika: prijava prek Supabase, profil iz GET /me (kot SessionStore na iOS).
   Vloge odloca streznik; tu samo beremo, kaj je rekel. */
import { supabase, odjemalec, koNalozen } from "./supabase.js";
import { nastaviObraz } from "./posel.js";
import { send, nastaviObZavrnjeniSeji, pocistiPredpomnilnik, pozabiKljucNakupa, imaShranjenoSejo } from "./api.js";
import { ApiError } from "./napake.js";
import { ustvariTrgovino, useStore } from "./store.js";
import { nastavitve } from "./nastavitve.js";

export const seja = ustvariTrgovino({
  pripravljena: false,   // prvo branje seje iz localStorage je koncano
  prijavljen: false,
  email: "",
  me: null,              // odgovor GET /me
  meNapaka: null,        // napaka zadnjega nalaganja /me (ne 401)
  obvestilo: ""          // npr. "seja je potekla" - pokaze prijava
});

/** Identiteta za Idempotency-Key nakupa (drug uporabnik = nov kljuc). */
export const uporabnikNakupa = () => { const s = seja.get(); return String((s.me && s.me.id) || s.email || ""); };

export const useSeja = (izb = s => s) => useStore(seja, izb);

/** Onboarding: samo navaden uporabnik brez onboarded_at (business/admin nikoli, kot iOS). */
export const potrebujeOnboarding = me => !!me && (me.role || "user") === "user" && !me.onboarded_at;

let zadnjiUid = null;
const CAKANJE_SEJE_MS = 3000;

export async function zacniSejo() {
  nastaviObZavrnjeniSeji(() => odjava("Your session has expired. Please log in again."));
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
    posodobiIzSeje(nova);
    if (dogodek === "SIGNED_OUT") { seja.set({ me: null }); pocistiPredpomnilnik(); pozabiKljucNakupa(); }
    else if (nova && nova.user && nova.user.id !== prej) naloziMe();
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

export async function odjava(obvestilo = "") {
  // Lokalne nastavitve niso vezane na racun - na skupni napravi jih ob odjavi pocistimo (zasebnost).
  try { localStorage.removeItem("outly_nastavitve"); } catch { /* brez */ }
  nastavitve.set({ genres: [], maxKm: 20, ageMin: 18, ageMax: 30, priceMin: 0, priceMax: 3000, shranjeno: false });
  nastaviObraz("club");   // obraz lastnika (klubski/osebni) je vezan na prijavljeno osebo
  await pocistiSkener();
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* lokalno vseeno pocistimo */ }
  pocistiPredpomnilnik();
  pozabiKljucNakupa();   // Idempotency-Key nakupa je vezan na uporabnika: naslednji uporabnik ga ne sme podedovati
  seja.set({ prijavljen: false, me: null, meNapaka: null, obvestilo });
}

export function nastaviMe(me) { seja.set({ me }); }

/** PATCH /me vrne samo osnovna polja (brez clubs, pending_*): zdruzi s trenutnim profilom, da znacke in
    klubi ne izginejo do naslednjega GET /me. */
export const zdruzi = novi => ({ ...(seja.get().me || {}), ...(novi || {}) });
