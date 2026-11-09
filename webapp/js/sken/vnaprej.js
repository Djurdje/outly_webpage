/* Priprava skenerja vnaprej (issue outly-backend#406): vratar ne sme cakati na prenos sele ob odprtju skenerja - v kleti brez
   signala bi bil seznam prazen. Ko prijavljen clan kluba odpre poslovni del ali klubski Profil, v ozadju pripravimo isto, kar
   skener prenese ob odprtju (kljuc, dogodki, seznam vstopnic aktivnih dogodkov): isti klici prek posel.js -> api.js send(),
   ista shramba (shramba.js), isti zapisi (motor.js pripravi()). Tiho, nikoli ne blokira prikaza. Modul se nalozi dinamicno
   (main.js) in samo za clane klubov. */
import { seja, uidSeje } from "../seja.js";
import { obraz, idKluba } from "../posel.js";
import { ustvariMotor, skenerOdprt } from "./motor.js";
import { pocistiPodatkeKlubov } from "./shramba.js";

const MEJA_MS = 10 * 60000;          // najvec 1 priprava na klub na 10 min
const zadnjaPriprava = new Map();    // uid:klub -> cas zadnjega poskusa
const vTeku = new Set();

const VLOGE_SKENERJA = ["owner", "manager", "doorman"];   // bartender ne skenira (posel.js: brez vrstice "Scan ticket"); scan-key bi dal 403

/** Klub, ki ga je vredno pripraviti za to pot, ali null. Skener sam (biz-scan) pripravlja sam. */
export function klubZaPripravo(pot, me) {
  if (!pot || !me) return null;
  const klubi = Array.isArray(me.clubs) ? me.clubs : [];
  if (pot.ime === "biz-scan") return null;
  if (pot.ime && pot.ime.startsWith("biz")) {
    const id = idKluba(pot.params && pot.params.klub);
    return id !== null && klubi.some(k => Number(k.club_id) === id && VLOGE_SKENERJA.includes(k.role)) ? id : null;
  }
  if (pot.ime === "profile" && me.role === "business" && obraz.get().vrednost === "club") {
    const lastnistvo = klubi.find(k => k.role === "owner");   // lastnik sme skenirati
    return lastnistvo ? idKluba(lastnistvo.club_id) : null;
  }
  return null;
}

/** Pripravi skener kluba v ozadju. Vrne true/false (poskus je tekel / ni), nikoli ne vrze. */
export async function pripraviSkener(klub) {
  try {
    const s = seja.get();
    if (!s.prijavljen || !klub || vTeku.has(klub)) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;   // brez povezave ni kaj prenesti; brez zaznamka
    const uid = uidSeje(), kljuc = uid + ":" + klub;   // zaznamek je vezan na racun: naslednji uporabnik na isti strani ga ne podeduje
    const zdaj = Date.now();
    if (zdaj - (zadnjaPriprava.get(kljuc) || 0) < MEJA_MS) return false;
    zadnjaPriprava.set(kljuc, zdaj);
    vTeku.add(klub);
    // Oznaka za ciscenje ob zagonu (seja.js pocistiStareSkeneOdZagona): seznami z imeni imetnikov potecejo po 3 dneh tudi, ce skenerja nikoli ne odprejo.
    try { localStorage.setItem("outly_sken_priprava", "1"); } catch { /* brez */ }
    try { await ustvariMotor({ klub }).pripravi(); }
    finally { vTeku.delete(klub); }
    // Odjava (ali zamenjava racuna) med prenosom: zapisani seznami ne smejo ostati (odjava jih je pobrisala, mi smo jih zapisali znova).
    // Samo nas klub (pocistiPodatkeKluba bi pobrisal tudi pravkar pripravljene sezname drugih klubov / novega uporabnika). uid "" ob zacetku
    // (seja se ni bila nastavljena) in kasneje nastavljen ni zamenjava racuna.
    if (!seja.get().prijavljen || (uid && uidSeje() !== uid)) { zadnjaPriprava.delete(kljuc); await pocistiPodatkeKlubov([klub]); }
    return true;
  } catch { return false; }
}
