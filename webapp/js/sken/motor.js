/* Skener vstopnic na vratih - jedro brez izrisa (issue Djurdje/outly-backend#86; zasnova: backend docs/STATE.md,
   invarianti I6 in I14). Martinova zahteva: skeniranje na vratih NE SME pasti - ne ob izpadu backenda, interneta v
   klubu ali Supabase. Zato telefon vstopnico preveri SAM:
     1. podpis kode v2 (Ed25519) z javnim kljucem (GET /business/scan-key),
     2. dogodek v kodi je AKTIVEN (od 8. 10. 2026 vratar dogodka ne izbira: aktivni so vsi dogodki kluba, kjer je zdaj med
        12 h pred zacetkom in 6 h po koncu - glej okno.js), vstopnica ni med prenesenimi (transferred_serials),
     3. stanje po seznamu TISTEGA dogodka (GET /business/events/:id/scan-list, prenesen za vsak aktivni dogodek) in po
        skenih, opravljenih na tej napravi. Koda dogodka izven okna -> rdece "NOT TODAY'S EVENT".
   Veljaven sken gre takoj v TRAJNO vrsto (shramba.js) in se poslje s POST /business/tickets/scan-batch - takoj, nato
   vsakih nekaj sekund, z odlaganjem ob napaki. Streznik ostane razsodnik: ce reci already_used za sken, ki smo ga
   lokalno spustili, je to KONFLIKT (dva telefona brez povezave sta spustila isto vstopnico) in je viden v vmesniku.
   Stara koda v1 se da preveriti samo na strezniku: s povezavo POST /business/tickets/scan, brez nje rumeno opozorilo.
   Vsi klici gredo prek posel.js poslovno() -> api.js send() (zeton, X-Outly-Club, 401 -> osvezi, 503 ne odjavi). */
import { ustvariTrgovino } from "../store.js";
import { poslovno } from "../posel.js";
import { ApiError, sporocilo } from "../napake.js";
import { razcleniQr, izBase64url, preverjevalnik, podpisVeljaven } from "./podpis.js";
import { odpriShrambo, zahtevajTrajno } from "./shramba.js";
import { aktivniDogodki, naslednjiDogodek, jeAktiven, konecDogodka, OKNO_PO_MS } from "./okno.js";

const URA = 3600 * 1000;
const PRVI_PRENOS_JITTER_MS = 30000;   // dogodek vstopi v okno med delovanjem: prvi prenos seznama cez 0-30 s (ne vsi skenerji hkrati)
const PO_POVEZAVI_JITTER_MS = 15000;    // osvezitev ob vrnitvi povezave cez 0-15 s
const NE_DANES_SVEZ_MS = 5 * 60000;     // seznam dogodkov, mlajsi od tega, je dovolj svez: znan dogodek izven okna ne rabi klica
const NE_DANES_MEJA_MS = 4500;          // trda meja na celotno osvezitev ob ne-danes (sken ne sme viseti dlje)
const URA_NAPAKA_MS = 5 * 60000;          // razlika ure telefona in streznika, od katere opozorimo
const OSVEZI_DOGODKE_MS = 30 * 60000;   // seznam dogodkov kluba (tezji poizvedba, 1000+ telefonov): redko; okno pa se preracuna vsak tik
const OSVEZI_SEZNAM_MS = 120000;       // ~vsake 2 min (+- jitter, da 1000 telefonov ne trka hkrati)
const JITTER_MS = 15000;
const TIK_MS = 5000;
const NAJVEC_ODLASANJA_MS = 30000;
const KOS_PAKETA = 200;                 // backend sprejme <= 500
const BRANJE_SERIAL_MS = 400;          // P3: najdlje cakamo na branje shrambe pri odlocitvi o skenu (pod Web Lockom) ...
const BRANJE_VSE_MS = 1000;            // ... in pred posiljanjem vrste; potem naprej iz pomnilnika
const ZAKAJ_SHRANI_MS = 1500;           // sken potrdimo, ko je trajno zapisan - a nikoli cakamo dlje
const CAKANJE_STREZNIKA_MS = 8000;      // sken s kodo v1: vratar ne sme cakati 30 s na mrtvo omrezje
const OBDRZI_POSLANE_MS = 3 * 24 * URA; // poslani skeni ostanejo za dvojni sken do osvezitve seznama

export const jeOnline = () => (typeof navigator === "undefined" || navigator.onLine !== false);

/** Odgovor skenerja (ScanResult). Streznik ga vrne tudi s 400/403/404/409 (iOS scanTicket enako). */
export async function skenirajVstopnico(klub, qr, moznosti = {}) {
  try {
    return await poslovno(klub, "/business/tickets/scan", { method: "POST", body: { qr }, ...moznosti });
  } catch (e) {
    if (e instanceof ApiError && [400, 403, 404, 409].includes(e.status)) {
      let r = null;
      try { r = JSON.parse(e.raw); } catch { r = null; }
      if (r && typeof r.result === "string") return r;
    }
    throw e;
  }
}

export function uuid() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* Napaka, ki pomeni "streznika ni" (omrezje, 5xx, prekinjeno): sken ostane v vrsti, povezava je "ne".
   4xx (npr. 403: vloga odvzeta) pomeni, da je streznik odgovoril - to je napaka, ne izpad. */
const jeIzpad = e => !(e instanceof ApiError) || e.status === -1 || e.status === 0 || e.status >= 500;

/* Casovna meja na CEL klic (K1, pregled PR #24). Samo prekinitev fetch-a ne zadostuje: api.js send() najprej caka
   trenutniZeton() (Supabase getSession), ki ob poteklem zetonu in mrtvem omrezju osvezuje ~30 s ali neomejeno, in tisti
   cas se AbortSignal ne dotakne. Zato Promise.race z zakasnitvijo, ki vrze ApiError(-1): klicatelj se vedno sprosti
   (posiljam/osvezujem/vrstni red skenov), pozni klic pa gre v prazno (api.js surovKlic ze preklicanega klica ne poslje).
   Streznik je pri scan-batch idempotenten, zato je ponovitev po meji varna. */
async function zMejo(ms, f) {
  const k = new AbortController();
  let t = 0;
  const rok = new Promise((_, napaka) => { t = setTimeout(() => { k.abort(); napaka(new ApiError(-1, "No response.")); }, ms); });
  const klic = Promise.resolve().then(() => f(k.signal));
  klic.catch(() => {});   // pozna napaka klica po izteku meje ne sme postati nezajeta zavrnitev
  try { return await Promise.race([klic, rok]); } finally { clearTimeout(t); }
}

/* Web Locks (kjer so): ena lokalna odlocitev naenkrat v VSEH zavihkih istega brskalnika. */
function zKljucem(ime, f) {
  try { if (navigator.locks && navigator.locks.request) return navigator.locks.request(ime, f); } catch { /* brez */ }
  return f();
}

const cas = v => { const m = Date.parse(v); return Number.isFinite(m) ? m : null; };
const zakasni = ms => new Promise(ok => setTimeout(ok, ms));
const UUID_NAPRAVE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- dogodki kluba ---------- */

/** Dogodki, ki jih vratar utegne skenirati: katerih okno (konec + 6 h) se ni zaprlo (tudi veckdnevni, ki se traja) in ki se
    zacnejo v 30 dneh (odgovor GET /business/events -> kratek seznam). */
export function obdelajDogodke(v, zdaj = Date.now()) {
  return (Array.isArray(v) ? v : [])
    .map(e => ({ id: Number(e && e.id), title: String((e && e.title) || ""), start_at: (e && e.start_at) || null, end_at: (e && e.end_at) || null,
      status: e && typeof e.status === "string" ? e.status : "" }))
    .filter(e => Number.isInteger(e.id) && e.id > 0 && cas(e.start_at) !== null && konecDogodka(e) + OKNO_PO_MS >= zdaj && cas(e.start_at) <= zdaj + 30 * 24 * URA && (!e.status || e.status === "published"))
    .sort((a, b) => cas(a.start_at) - cas(b.start_at));
}

/* ---------- motor ---------- */

/** Motor za en klub in VSE njegove aktivne dogodke (okno.js). Stanje za izris je v `stanje` (trgovina: useStore).
    Aktivni dogodki so v `stanje.aktivni` ([{ id, title, start_at, end_at }]), naslednji dogodek v `stanje.naslednji`. */
export function ustvariMotor({ klub }) {
  const stanje = ustvariTrgovino({
    pripravljen: false, nacinShrambe: "", preverjanje: "",        // preverjanje: "" (se ne vemo) | "webcrypto" | "noble" | "ni"
    povezava: jeOnline(), caka: 0, vstopilo: 0, konflikti: [],
    seznamCas: null, seznamStevilo: 0, imaKljuc: false,
    sinhroniziram: false, osvezujem: false, napakaSinh: "", napakaSeznama: "", shranjevanjeNapaka: false,
    aktivni: [], naslednji: null, dogodkov: 0, dogodkiPripravljeni: false,    // pripravljeni: seznam dogodkov je znan (iz shrambe ali omrezja)
    dogodkiOmrezje: "", nalagamDogodke: false,                    // dogodkiOmrezje: "" (se ne vemo) | "ok" | "napaka"
    seznamManjka: [], uraNapacna: false, znovuNapaka: false                            // seznamManjka: aktivni dogodki brez seznama [{ id, title }]; uraNapacna: ura telefona se razlikuje od strezniske
  });

  let shramba = null, deviceId = "", kljuc = null;                // kljuc: { kid, javni: Uint8Array }
  let dogodki = [];                                               // dogodki kluba (obdelajDogodke), iz shrambe ali omrezja
  const seznami = new Map();                                      // id aktivnega dogodka -> { seznam: Map serial -> vrstica | null, prenesene: Set, cas }
  const skeni = new Map();                                        // client_scan_id -> zapis (vsi skeni kluba na tej napravi)
  const poSerialu = new Map();                                    // serial -> zapis (prvi sken te vstopnice)
  let omrezje = jeOnline();
  let posiljam = false, osvezujem = false, zivo = false, nalagamDogodke = false;
  let casovnik = 0, odloziPosiljanje = 0, aktivniKljuc = "", zadnjeOsvezitevNeDanes = 0, dogodkiCas = 0;
  const zadnjiGen = new Map();   // id dogodka -> zadnji generated_at (predpomnjeno telo ob 304 ne sme biti merilo ure)
  let uraPrejsnja = 0;           // predznak zadnje sveze meritve ure (0 = v mejah)
  let naslednjiPoslji = 0, naslednjiOsvezi = 0, napakPoslji = 0, napakOsvezi = 0, naslednjiUskladi = 0, naslednjiDogodki = 0, napakDogodki = 0;
  let veriga = Promise.resolve();

  const povezava = () => jeOnline() && omrezje;
  const objavi = (delno = {}) => {
    let caka = 0, vstopilo = 0;
    const konflikti = [];
    for (const r of skeni.values()) {
      if (r.klub !== klub) continue;
      if (r.stanje === "caka") caka++;
      if (seznami.has(r.dogodek)) vstopilo++;
      if (r.konflikt && !r.videl) konflikti.push(konfliktZaIzris(r));
    }
    konflikti.sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
    // Cas prenosa = NAJSTAREJSI med aktivnimi (ce katerega se nimamo, "ni prenesen"); stevilo = vsota vstopnic.
    let seznamCas = null, seznamStevilo = 0, vsi = seznami.size > 0;
    for (const x of seznami.values()) {
      if (x.cas === null) vsi = false; else if (seznamCas === null || x.cas < seznamCas) seznamCas = x.cas;
      if (x.seznam) seznamStevilo += x.seznam.size;
    }
    const akt = delno.aktivni || stanje.get().aktivni;
    const manjka = akt.filter(e => { const x = seznami.get(e.id); return x && x.cas === null; }).map(e => ({ id: e.id, title: e.title }));
    stanje.set({ povezava: povezava(), caka, vstopilo, konflikti, seznamCas: vsi ? seznamCas : null, seznamStevilo, imaKljuc: !!kljuc, seznamManjka: manjka, ...delno });
  };
  const konfliktZaIzris = r => {
    const e = seznami.get(r.dogodek);
    const v = e && e.seznam && e.seznam.get(r.serial);
    return {
      id: r.id, serial: r.serial, scanned_at: r.scanned_at, rezultat: r.rezultat, used_at_streznik: r.used_at_streznik || null,
      imetnik: (v && v.holder_username) || "", lokalno: r.lokalno
    };
  };
  const omrezjeJe = ok => { omrezje = ok; if (stanje.get().povezava !== povezava()) stanje.set({ povezava: povezava() }); };
  const shrani = async rec => {
    try { await Promise.race([shramba.skenPut(rec), zakasni(ZAKAJ_SHRANI_MS).then(() => { throw new Error("shramba: cas"); })]); }
    catch { stanje.set({ shranjevanjeNapaka: true }); }
    try { if (kanal) kanal.postMessage({ klub, od: deviceId + ":" + zavihek }); } catch { /* brez */ }
  };

  /* --- vec zavihkov (M4) ---
     Isti brskalnik ima lahko skener odprt v vec zavihkih (in PWA + zavihek). Vsak sken je svoj zapis v shrambi (IndexedDB:
     en zapis, localStorage: en kljuc), zato sočasen zapis ne izgubi skena. Pred odlocitvijo se serial prebere iz shrambe
     (dvojni sken v drugem zavihku), po spremembi druge zavihke obvesti BroadcastChannel (+ pocasno ponovno branje v tik()). */
  const zavihek = uuid().slice(0, 8);
  let kanal = null;
  const vkljuci = r => {
    if (!r || typeof r.id !== "string" || r.klub !== klub) return false;
    const nas = skeni.get(r.id);
    if (!nas) { skeni.set(r.id, r); }
    else if (nas.stanje === "caka" && r.stanje === "poslan") Object.assign(nas, r);
    else { if (r.videl && !nas.videl) nas.videl = true; return false; }
    const rec = skeni.get(r.id), prvi = poSerialu.get(rec.serial);
    if (!prvi || rec.scanned_at < prvi.scanned_at) poSerialu.set(rec.serial, rec);
    return true;
  };
  /* P3: branje shrambe ima casovno mejo. Obvisel IndexedDB (iOS Safari po vrnitvi iz ozadja) sicer ustavi vse skene v vseh
     zavihkih (uskladiSerial je pod Web Lockom) in posiljanje (posiljam ostane true). Ob izteku odlocimo iz pomnilnika. */
  const meja = (obljuba, ms) => Promise.race([obljuba, zakasni(ms).then(() => { throw new Error("shramba: cas"); })]);
  async function uskladiSerial(serial) {
    try { for (const r of await meja(shramba.skeniPoSerialu(serial), BRANJE_SERIAL_MS)) vkljuci(r); } catch { /* brez: odloci pomnilnik (poSerialu) */ }
  }
  async function uskladi(ms = BRANJE_VSE_MS) {
    let spremenjeno = false;
    try { for (const r of await meja(shramba.skeniVsi(), ms)) if (vkljuci(r)) spremenjeno = true; } catch { /* brez */ }
    if (spremenjeno) objavi();
    return spremenjeno;
  }

  /* --- kljuc in seznam --- */
  function sprejmiKljuc(k) {
    if (!k || k.alg !== "Ed25519" || typeof k.public_key !== "string" || typeof k.kid !== "string" || !k.kid) throw new Error("kljuc");
    const javni = izBase64url(k.public_key);
    if (javni.length !== 32) throw new Error("kljuc");
    return { kid: k.kid, javni, surov: k.public_key };
  }
  async function naloziKljuc() {
    const k = sprejmiKljuc(await zMejo(10000, signal => poslovno(klub, "/business/scan-key", { signal })));
    kljuc = { kid: k.kid, javni: k.javni };
    try { await shramba.kvSet("kljuc", { kid: k.kid, public_key: k.surov, cas: Date.now() }); } catch { /* brez */ }
    objavi();
  }

  /* Seznam vstopnic ENEGA aktivnega dogodka; napaka se vrze klicatelju (osvezi), ki loci izpad od odgovora streznika. */
  async function osveziSeznam(id) {
    const t0 = Date.now();
    const odg = await zMejo(20000, signal => poslovno(klub, `/business/events/${id}/scan-list`, { signal }));
    const t1 = Date.now();
    if (!odg || typeof odg !== "object" || !Array.isArray(odg.tickets) || !Array.isArray(odg.transferred_serials) || Number(odg.event_id) !== id) throw new Error("seznam");
    const m = new Map();
    for (const x of odg.tickets) if (x && typeof x.serial === "string") m.set(x.serial.toLowerCase(), x);
    // Ura telefona (N4): generated_at je cas strezniku; mora biti med t0 in t1 (+- kratek zamik). Glave Date CORS ne razkrije
    // (backend izpostavi samo Retry-After in Idempotent-Replayed), zato telo odgovora. Samo opozorilo - okna ne popravljamo.
    // Lazni alarm ni sprejemljiv: Safari/Firefox ob 304 pokazeta PREDPOMNJENO telo s starim generated_at. Zato (1) telo z istim
    // generated_at kot prej ne meri nicesar, (2) opozorilo sele, ko DVE zaporedni SVEZI meritvi (razlicna generated_at) odstopata
    // v isto smer. Predpomnjeno telo ima lahko ob tem najvec eno staro meritev; naslednja sveza (ali ista) jo razveljavi.
    const sr = Date.parse(odg.generated_at);
    if (Number.isFinite(sr) && zadnjiGen.get(id) !== sr) {
      zadnjiGen.set(id, sr);
      const znak = sr < t0 - URA_NAPAKA_MS ? -1 : sr > t1 + URA_NAPAKA_MS ? 1 : 0;
      const napacna = znak !== 0 && znak === uraPrejsnja;
      uraPrejsnja = znak;
      if (znak === 0 || napacna) { if (napacna !== stanje.get().uraNapacna) stanje.set({ uraNapacna: napacna }); }
    }
    const cas0 = Date.now();
    const e = seznami.get(id);
    if (e) { e.seznam = m; e.prenesene = new Set(odg.transferred_serials.filter(x => typeof x === "string").map(x => x.toLowerCase())); e.cas = cas0; }   // dogodek je medtem lahko izstopil iz okna
    try { await meja(shramba.kvSet(`seznam:${klub}:${id}`, { kid: odg.kid || "", tickets: odg.tickets, transferred_serials: odg.transferred_serials, cas: cas0 }), 1500); }
    catch { stanje.set({ shranjevanjeNapaka: true }); }
    // Zasukan kljuc (past v backend STATE.md): primerjava po kid; seznam je ze shranjen, zato napaka tu ni usodna.
    if (typeof odg.kid === "string" && kljuc && odg.kid !== kljuc.kid) { try { await naloziKljuc(); } catch { /* naslednji krog */ } }
  }

  /* Vsi aktivni dogodki po vrsti (en klic naenkrat). Izpad omrezja prekine krog (ne cakamo 20 s se za vsak dogodek);
     odgovor streznika s 4xx (npr. dogodek izbrisan) velja samo za tisti dogodek, ostali se osvezijo. */
  async function osvezi() {
    if (osvezujem || !zivo) return;
    osvezujem = true;
    stanje.set({ osvezujem: true });
    let izpad = false, napaka = "";
    try {
      if (!kljuc) await naloziKljuc();
      for (const id of [...seznami.keys()]) {
        if (!zivo) break;
        const vnos = seznami.get(id);
        if (vnos && vnos.od > Date.now()) continue;   // dogodek, ki je pravkar vstopil v okno: prenos se ni na vrsti (jitter)
        try { await osveziSeznam(id); omrezjeJe(true); objavi(); }
        catch (e) {
          if (jeIzpad(e)) { izpad = true; break; }
          napaka ||= sporocilo(e);
        }
      }
    } catch (e) {   // kljuc
      if (jeIzpad(e)) izpad = true; else napaka ||= sporocilo(e);
    } finally {
      osvezujem = false;
    }
    if (izpad || napaka) {
      napakOsvezi++;
      // Izpad omrezja: hitro ponovno (do 60 s). Trajen odgovor 4xx za dogodek (izbrisan, vloga odvzeta): najmanj 2 min.
      const odlog = Math.min(NAJVEC_ODLASANJA_MS * 2, 5000 * 2 ** napakOsvezi);
      naslednjiOsvezi = Date.now() + (izpad ? odlog : Math.max(OSVEZI_SEZNAM_MS, odlog)) * (0.8 + Math.random() * 0.4);
      if (izpad) omrezjeJe(false); else omrezjeJe(true);
      objavi(izpad ? { osvezujem: false } : { osvezujem: false, napakaSeznama: napaka });
    } else {
      omrezjeJe(true); napakOsvezi = 0;
      naslednjiOsvezi = Date.now() + OSVEZI_SEZNAM_MS + (Math.random() * 2 - 1) * JITTER_MS;
      objavi({ osvezujem: false, napakaSeznama: "" });
    }
    // Dogodek z odlozenim prvim prenosom: krog ga ni vzel, zato naj pride na vrsto takoj, ko mine njegov jitter.
    let najprej = Infinity;
    for (const x of seznami.values()) if (x.od > Date.now() && x.cas === null) najprej = Math.min(najprej, x.od);
    if (najprej < naslednjiOsvezi) naslednjiOsvezi = najprej;
  }

  /* --- dogodki kluba in aktivno okno --- */

  /* Preracun aktivnih dogodkov iz seznama `dogodki` in ure naprave (deluje tudi brez povezave). Klic ob vsakem tiku (5 s):
     dogodek, ki vstopi v okno med vecerom, se doda (seznam iz shrambe, takoj nato prenos); ki izstopi, se odstrani. */
  function preracunaj(delno = {}, jitter = false) {
    const zdaj = Date.now();
    const akt = aktivniDogodki(dogodki, zdaj);
    const naslednji = naslednjiDogodek(dogodki, zdaj);
    const kljucNovi = akt.map(e => `${e.id}|${e.title}|${e.start_at}`).join(";") + "#" + (naslednji ? `${naslednji.id}|${naslednji.title}|${naslednji.start_at}` : "");
    let dodan = false;
    const ids = new Set(akt.map(e => e.id));
    for (const id of [...seznami.keys()]) if (!ids.has(id)) seznami.delete(id);
    for (const e of akt) {
      if (seznami.has(e.id)) continue;
      // jitter (samo ob tiku, ko dogodek vstopi v okno med vecerom): prvi prenos cez 0-30 s; ob odprtju skenerja in na zahtevo takoj.
      const vnos = { seznam: null, prenesene: new Set(), cas: null, od: jitter ? Date.now() + Math.random() * PRVI_PRENOS_JITTER_MS : 0 };
      seznami.set(e.id, vnos);
      dodan = true;
      if (jitter) naslednjiOsvezi = Math.min(naslednjiOsvezi, vnos.od);
      // Shranjen seznam (brez povezave): prebere se asinhrono, a samo, ce ga osvezitev medtem ni ze nadomestila.
      if (shramba) (async () => {
        let sez = null;
        try { sez = await shramba.kvGet(`seznam:${klub}:${e.id}`); } catch { sez = null; }
        if (seznami.get(e.id) !== vnos || vnos.seznam || !sez || !Array.isArray(sez.tickets) || !Array.isArray(sez.transferred_serials)) return;
        vnos.seznam = new Map();
        for (const x of sez.tickets) if (x && typeof x.serial === "string") vnos.seznam.set(x.serial.toLowerCase(), x);
        vnos.prenesene = new Set(sez.transferred_serials.filter(x => typeof x === "string").map(x => x.toLowerCase()));
        vnos.cas = Number.isFinite(sez.cas) ? sez.cas : null;
        objavi();
      })();
    }
    if (dodan && !jitter) naslednjiOsvezi = 0;   // nov dogodek: seznam cim prej
    if (kljucNovi !== aktivniKljuc || dodan || Object.keys(delno).length) {
      aktivniKljuc = kljucNovi;
      objavi({ aktivni: akt, naslednji, dogodkov: dogodki.length, ...delno });
    }
  }

  /** Dogodki iz omrezja (GET /business/events); v ozadju, vratar zaradi tega NE caka (skener se odpre iz shranjenih).
      Vrne true/false (uspeh/neuspeh) ali null, ce je klic ze v teku. Odgovor, ki ni polje, je napaka: predpomnilnika NE prepisemo (N1). */
  async function osveziDogodke(mejaMs = 0) {
    if (nalagamDogodke || !zivo) return null;
    nalagamDogodke = true;
    stanje.set({ nalagamDogodke: true });
    let ok = false;
    try {
      const imaShranjene = dogodki.length > 0;
      const v = await zMejo(mejaMs || (imaShranjene ? 5000 : 15000), signal => poslovno(klub, "/business/events", { signal }));
      if (!Array.isArray(v)) throw new ApiError(422, "Invalid response.");
      const zdaj = Date.now();
      dogodki = obdelajDogodke(v, zdaj);
      dogodkiCas = zdaj;
      try { await meja(shramba.kvSet("dogodki:" + klub, { cas: zdaj, dogodki }), 1500); } catch { /* brez: obvisel IndexedDB ne sme zadrzati skena */ }
      ok = true; napakDogodki = 0;
      naslednjiDogodki = zdaj + OSVEZI_DOGODKE_MS + (Math.random() * 2 - 1) * 5 * 60000;
      omrezjeJe(true);
    } catch (e) {
      napakDogodki++;
      naslednjiDogodki = Date.now() + Math.min(5 * 60000, 5000 * 2 ** napakDogodki) * (0.8 + Math.random() * 0.4);
      if (jeIzpad(e)) omrezjeJe(false);
    } finally {
      nalagamDogodke = false;
    }
    preracunaj({ nalagamDogodke: false, dogodkiPripravljeni: true, dogodkiOmrezje: ok ? "ok" : "napaka" });
    return ok;
  }

  /* Rdece "ne-danes": seznam dogodkov na telefonu je lahko zastarel (dogodek dodan ali premaknjen po zadnjem prenosu).
     S povezavo ga prenesemo znova (najvec 1x na 60 s, kratka casovna meja) in sklep se enkrat sprejmemo. Klic je zunaj verige. */
  async function osveziZaNeDanes(dogodekId) {
    const zdaj = Date.now();
    if (!zivo || !povezava()) return false;
    // Dogodek je znan in je seznam svez (< 5 min): vstopnica za jutri ne rabi klica. Neznan dogodek ali star seznam: osvezi.
    if (dogodki.some(e => e.id === dogodekId) && zdaj - dogodkiCas < NE_DANES_SVEZ_MS) return false;
    // Najvec 1x na 60 s; ob padcu branja dogodkov z umikom (60, 120, 240 ... 960 s), da padel glavni pool ne dobi klica od vsakega telefona.
    if (zdaj - zadnjeOsvezitevNeDanes < 60000 * 2 ** Math.min(napakDogodki, 4)) return false;
    zadnjeOsvezitevNeDanes = zdaj;
    // Trda meja na celoto (omrezje + zapis v shrambo): nobena pot v sken() ne sme cakati dlje kot ~4,5 s.
    return (await Promise.race([osveziDogodke(4000), zakasni(NE_DANES_MEJA_MS).then(() => false)])) === true;
  }

  /** Gumb "Reload events". */
  let znovuCas = 0;
  const znovuNaloziDogodke = async () => {
    naslednjiDogodki = 0;
    const ok = await osveziDogodke();
    clearTimeout(znovuCas);
    if (ok === false) {   // ob padcu rocnega osveževanja kratka napaka (null = klic je ze v teku: nic)
      stanje.set({ znovuNapaka: true });
      znovuCas = setTimeout(() => stanje.set({ znovuNapaka: false }), 6000);
    } else if (ok === true) stanje.set({ znovuNapaka: false });
    return ok;
  };

  /* --- vrsta --- */
  function uporabiRezultat(rec, r) {
    const rez = String((r && r.result) || "");
    if (!rez || rez === "error") { rec.poskusi = (rec.poskusi || 0) + 1; return false; }   // ostane v vrsti
    rec.stanje = "poslan";
    rec.rezultat = rez;
    rec.used_at_streznik = (r && r.used_at) || null;
    rec.konflikt = rez !== "ok";   // lokalno smo ga spustili (zeleno), streznik pravi drugace
    rec.videl = false;
    return true;
  }

  async function poslji(koncno = false) {   // koncno: zadnji poskus ob odhodu z zaslona (zivo je takrat ze false)
    if (posiljam || (!zivo && !koncno)) return;
    posiljam = true;   // takoj: dva klica (tik + sprozi) ne smeta oba mimo preverjanja med await-om spodaj
    let cakajoci = [];
    try {
      await uskladi();   // drug zavihek je morda ze poslal (ali dodal) skene
      cakajoci = [...skeni.values()].filter(r => r.klub === klub && r.stanje === "caka").sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));
    } catch { /* brez */ }
    if (!cakajoci.length || !jeOnline() || (!zivo && !koncno)) { posiljam = false; if (!jeOnline()) objavi(); return; }
    stanje.set({ sinhroniziram: true });
    const delo = async () => {
      for (let i = 0; i < cakajoci.length; i += KOS_PAKETA) {
        const kos = cakajoci.slice(i, i + KOS_PAKETA);
        let odg;
        try {
          odg = await zMejo(15000, signal => poslovno(klub, "/business/tickets/scan-batch", {
            method: "POST", signal,
            body: { scans: kos.map(r => ({ client_scan_id: r.id, qr: r.qr, scanned_at: r.scanned_at, device_id: r.device_id })) }
          }));
        } catch (e) {
          napakPoslji++;
          naslednjiPoslji = Date.now() + Math.min(NAJVEC_ODLASANJA_MS, 2500 * 2 ** napakPoslji);
          if (jeIzpad(e)) { omrezjeJe(false); objavi({ napakaSinh: "" }); }
          else { omrezjeJe(true); objavi({ napakaSinh: sporocilo(e) }); }
          return;
        }
        omrezjeJe(true);
        const rezultati = odg && Array.isArray(odg.results) ? odg.results : [];
        const poId = new Map();
        for (const r of rezultati) if (r && typeof r.client_scan_id === "string") poId.set(r.client_scan_id, r);
        const spremenjeni = [];
        kos.forEach((rec, j) => {
          let r = poId.get(rec.id);
          if (!r && rezultati.length === kos.length && rezultati[j] && rezultati[j].client_scan_id == null) r = rezultati[j];
          if (r && uporabiRezultat(rec, r)) spremenjeni.push(rec);
        });
        for (const rec of spremenjeni) await shrani(rec);
        if (spremenjeni.length < kos.length) {   // "error" ali manjkajoc rezultat: vrsta ostane, poskusi znova z odlaganjem
          napakPoslji++;
          naslednjiPoslji = Date.now() + Math.min(NAJVEC_ODLASANJA_MS, 2500 * 2 ** napakPoslji);
        } else napakPoslji = 0;
        objavi({ napakaSinh: "" });
      }
    };
    try {
      // Dva zavihka naenkrat bi poslala isti paket dvakrat (streznik je idempotenten, a ni treba): Web Locks, kjer so.
      if (navigator.locks && navigator.locks.request) await navigator.locks.request("outly-sken-poslji-" + klub, { ifAvailable: true }, l => (l ? delo() : undefined));
      else await delo();
    } catch { /* varovalo: motor ne sme vreci izjeme */ }
    finally { posiljam = false; stanje.set({ sinhroniziram: false }); }
  }

  /* Takoj po skenu (kratko zdruzevanje hitrih skenov). Ne ob odlaganju zaradi napake: za to skrbi tik(). */
  function sproziPosiljanje() {
    clearTimeout(odloziPosiljanje);
    odloziPosiljanje = setTimeout(() => { if (povezava() && Date.now() >= naslednjiPoslji) poslji(); }, 250);
  }

  function tik() {
    if (!zivo) return;
    const zdaj = Date.now();
    preracunaj({}, true);   // okno se premika s casom (dogodek vstopi/izstopi) - deluje tudi brez povezave
    if (!jeOnline()) { objavi(); return; }
    if (zdaj >= naslednjiDogodki) osveziDogodke();
    if (zdaj >= naslednjiUskladi) { naslednjiUskladi = zdaj + 15000; uskladi(); }
    if (stanje.get().caka > 0 && zdaj >= naslednjiPoslji) poslji();
    if (zdaj >= naslednjiOsvezi) osvezi();
    if (stanje.get().povezava !== povezava()) objavi();
  }
  // Povezava je nazaj: skeni se posljejo takoj (vrata), osvezitev seznamov in dogodkov cez 0-15 s (1000 telefonov ne trka hkrati).
  const naPovezavi = () => {
    omrezje = true; naslednjiPoslji = 0; napakPoslji = 0; napakOsvezi = 0;
    const zdaj = Date.now();
    naslednjiOsvezi = zdaj + Math.random() * PO_POVEZAVI_JITTER_MS;
    if (napakDogodki > 0) { naslednjiDogodki = zdaj + Math.random() * PO_POVEZAVI_JITTER_MS; napakDogodki = 0; }
    objavi(); tik();
  };
  const naIzpadu = () => objavi();
  const naVidnosti = () => { if (document.visibilityState === "visible") { naslednjiPoslji = 0; naslednjiOsvezi = Math.min(naslednjiOsvezi, Date.now()); tik(); } };

  /* --- sken --- */
  const jeAktivenDogodek = id => jeAktiven(dogodki.find(e => e.id === id), Date.now());
  function sklepIzSeznama(v) {
    return { ticket: { is_vip: v.is_vip === true, table_label: v.table_label || "", package_name: v.package_name || "",
      is_guest_list: v.is_guest_list === true, guest_list_host_username: v.guest_list_host_username || "" }, imetnik: v.holder_username || "" };
  }

  /* Klic strezniku za kodo, ki je telefon ne more preveriti (v1, v2 brez kljuca/Ed25519, v2 ki "ni na seznamu").
     TEGA NIKOLI v verigi `veriga` (K1): vratar ne sme zaradi mrtvega omrezja izgubiti lokalnih skenov. */
  async function prekoStreznika(koda, vrsta) {
    const rumeno = { tip: vrsta === "v1" ? "stara-potrebna-povezava" : "potrebna-povezava", barva: "rumena" };
    if (!povezava()) return rumeno;
    try {
      const odg = await zMejo(CAKANJE_STREZNIKA_MS, signal => skenirajVstopnico(klub, koda, { signal }));
      omrezjeJe(true);
      return { tip: "streznik", barva: odg.result === "ok" ? "zelena" : "rdeca", streznik: odg, ticket: odg.ticket || null };
    } catch (e) {
      if (jeIzpad(e)) {
        omrezjeJe(false);
        // Zahteva je morda ze dosegla streznik in vstopnico vpisala: vratar mora to vedeti (kot pred #86).
        return { ...rumeno, mogoceVpisana: true };
      }
      return { tip: "napaka", barva: "rdeca", opis: sporocilo(e) };
    }
  }

  /* Samo LOKALNA odlocitev (brez omrezja) - sme biti v verigi. Vrne sklep ali oznako za nadaljevanje zunaj verige:
       { zunaj: "streznik", vrsta }  - telefon ne more preveriti, naj odloci streznik (ali rumeno brez povezave; vrsta "seznam": zeleno v vrsto)
       { zunaj: "kljuc" }            - koda ima drug kid: najprej poskusi osveziti kljuc (omrezje), nato ponovi z kljucOsvezen */
  async function odlociLokalno(r, koda, kljucOsvezen, brezStreznika = false) {
    const ver = await Promise.race([preverjevalnik(), zakasni(4000).then(() => undefined)]);   // dinamicni uvoz knjiznice sme viseti
    if (ver === null) stanje.set({ preverjanje: "ni" }); else if (ver && stanje.get().preverjanje !== ver.ime) stanje.set({ preverjanje: ver.ime });
    if (!ver || !kljuc) {   // brez kljuca / brez Ed25519: kot prej, samo s povezavo - a dogodek je znan (nepodpisan), okno preverimo vseeno
      if (!jeAktivenDogodek(r.dogodek)) return { tip: "ne-danes", barva: "rdeca" };
      return { zunaj: "streznik", vrsta: "v2" };
    }

    let veljaven = await podpisVeljaven(r, kljuc.javni, ver);
    if (!veljaven && r.kid && r.kid !== kljuc.kid) {
      // Koda je podpisana z drugim kljucem, kot ga imamo: zasukana skrivnost ali ponaredek.
      if (!kljucOsvezen && povezava()) return { zunaj: "kljuc" };
      if (kljucOsvezen !== "da") return { tip: "potrebna-povezava", barva: "rumena" };   // kljuca ni bilo mogoce osveziti: ne vemo
      veljaven = false;
    }
    if (!veljaven) return { tip: "neveljavna", barva: "rdeca" };

    // Dogodek iz kode (podpisan) mora biti AKTIVEN (okno.js). Ura se bere ob skenu, ne ob zadnjem tiku (meja okna je na sekundo).
    if (!jeAktivenDogodek(r.dogodek)) return { tip: "ne-danes", barva: "rdeca" };
    const dog = r.dogodek;
    if (!seznami.has(dog)) preracunaj();   // okno se je odprlo med dvema tikoma: vpis + branje shranjenega seznama + prenos
    const vnos = seznami.get(dog) || { seznam: null, prenesene: new Set(), cas: null };
    const { seznam, prenesene } = vnos;
    if (prenesene.has(r.serial)) return { tip: "preneseno", barva: "rdeca" };
    // Vec zavihkov: sken iste vstopnice je lahko ze v shrambi (M4). Pod kljucem Web Locks, zato je branje+zapis atomarno.
    await uskladiSerial(r.serial);
    const prvi = poSerialu.get(r.serial);
    if (prvi) return { tip: "ze-skenirano", barva: "rdeca", cas: cas(prvi.scanned_at), ...(seznam && seznam.get(r.serial) ? sklepIzSeznama(seznam.get(r.serial)) : {}) };
    const v = seznam ? seznam.get(r.serial) : null;
    if (v && v.status !== "valid") {
      if (v.status === "used") return { tip: "ze-skenirano", barva: "rdeca", cas: cas(v.used_at), ...sklepIzSeznama(v) };
      if (v.status === "refunded") return { tip: "vrnjeno", barva: "rdeca" };
      if (v.status === "void") return { tip: "preklicano", barva: "rdeca" };
      if (v.status === "unpaid") return { tip: "neplacano", barva: "rdeca" };   // M1: seznam vsebuje tudi neplacana narocila
      return { tip: "zavrnjeno", barva: "rdeca" };
    }
    // M7: seznam vsebuje VSE vstopnice dogodka (tudi neplacane, vrnjene), zato "ni na seznamu" pomeni novo ali preneseno vstopnico
    // (nov serial po prenosu seznama). Ugibanje po starosti kode bi taksne vstopnice zavrnilo, zato: s povezavo odloci streznik,
    // brez povezave (ali ce streznik ne odgovori: brezStreznika) zeleno z opombo in v vrsto - streznik odloci ob posiljanju.
    if (!v && !brezStreznika && povezava()) return { zunaj: "streznik", vrsta: "seznam" };

    const rec = {
      id: uuid(), klub, dogodek: dog, serial: r.serial, qr: koda.trim(), scanned_at: new Date().toISOString(), device_id: deviceId,
      stanje: "caka", lokalno: v ? "na-seznamu" : "ni-na-seznamu", rezultat: null, used_at_streznik: null, konflikt: false, videl: false, poskusi: 0
    };
    skeni.set(rec.id, rec);
    poSerialu.set(rec.serial, rec);
    objavi();
    await shrani(rec);
    sproziPosiljanje();
    return v
      ? { tip: "dobrodosli", barva: "zelena", ...sklepIzSeznama(v) }
      : { tip: "dobrodosli-ni-na-seznamu", barva: "zelena", ticket: null, imetnik: "", brezSeznama: !seznam };
  }

  /* Streznik je sprejel vstopnico, ki je ni bilo na seznamu: zabelezimo jo kot ze poslano, da se ponovni sken (tudi brez povezave) zavrne. */
  async function zabeleziStreznik(r, koda, odg) {
    await uskladiSerial(r.serial);
    if (poSerialu.has(r.serial)) return;
    const rec = {
      id: uuid(), klub, dogodek: r.dogodek, serial: r.serial, qr: koda.trim(), scanned_at: new Date().toISOString(), device_id: deviceId,
      stanje: "poslan", lokalno: "ni-na-seznamu", rezultat: "ok", used_at_streznik: (odg.ticket && odg.ticket.used_at) || null, konflikt: false, videl: true, poskusi: 0
    };
    skeni.set(rec.id, rec);
    poSerialu.set(rec.serial, rec);
    objavi();
    await shrani(rec);
  }

  /* Lokalna odlocitev (preverjanje + zapis) je atomarna: v verigi (ta zavihek) in pod Web Lock (vsi zavihki). */
  function vVerigi(f) {
    const p = veriga.then(() => zKljucem("outly-sken-odlocitev-" + klub, f));
    veriga = p.catch(() => {});
    return p;
  }

  /** En sken. Vedno vrne sklep (nikoli izjeme). Samo lokalna odlocitev je v verigi; klici strezniku (v1, osvezitev kljuca,
      "ni na seznamu") tecejo zunaj nje in imajo casovno mejo na celoten klic - en mrtev klic ne zadrzi naslednjih skenov (K1). */
  async function sken(koda) {
    const s = await skenEn(koda);
    if (s.tip !== "ne-danes") return s;
    let id = null;
    try { id = razcleniQr(koda).dogodek; } catch { /* brez */ }
    if (!Number.isInteger(id)) return s;
    try { if (await osveziZaNeDanes(id)) return await skenEn(koda); } catch { /* ostane prvotni sklep */ }
    return s;
  }

  async function skenEn(koda) {
    try {
      const r = razcleniQr(koda);
      if (r.vrsta === "neznano") return { tip: "ni-vstopnica", barva: "rdeca" };
      if (r.vrsta === "v1") {
        // Dogodek v kodi v1 ni preverjen (HMAC zna samo streznik), zato ga uporabimo SAMO za zavrnitev izven okna.
        if (r.dogodek !== null && !jeAktivenDogodek(r.dogodek)) return { tip: "ne-danes", barva: "rdeca" };
        return await prekoStreznika(koda, "v1");
      }
      let o = await vVerigi(() => odlociLokalno(r, koda, false));
      if (o.zunaj === "kljuc") {
        let osvezen = "ne";
        try { await naloziKljuc(); omrezjeJe(true); osvezen = "da"; } catch (e) { if (jeIzpad(e)) omrezjeJe(false); }
        o = await vVerigi(() => odlociLokalno(r, koda, osvezen));
      }
      if (o.zunaj === "streznik") {
        const odg = await prekoStreznika(koda, o.vrsta);
        if (o.vrsta !== "seznam") return odg;
        if (odg.tip === "streznik" && odg.streznik && odg.streznik.result === "ok") {
          try { await vVerigi(() => zabeleziStreznik(r, koda, odg.streznik)); } catch { /* brez */ }   // naslednji sken iste kode je lokalno "ze skenirano"
          return odg;
        }
        // Streznik ne odgovori (izpad): vrata ne smejo stati - zeleno z opombo in v vrsto; ce je zahteva vseeno dosegla streznik, se to pokaze kot konflikt.
        if (odg.barva === "rumena") return await vVerigi(() => odlociLokalno(r, koda, "ne", true));
        return odg;
      }
      return o;
    } catch (e) {
      return { tip: "napaka", barva: "rdeca", opis: sporocilo(e) };
    }
  }

  async function pridobiNapravo() {
    let id = null;
    try { id = localStorage.getItem("outly_sken_naprava"); } catch { /* brez */ }
    if (!UUID_NAPRAVE.test(id || "")) { try { id = await shramba.kvGet("naprava"); } catch { id = null; } }
    if (!UUID_NAPRAVE.test(id || "")) id = uuid();
    try { localStorage.setItem("outly_sken_naprava", id); } catch { /* brez */ }
    try { await shramba.kvSet("naprava", id); } catch { /* brez */ }
    return id;
  }

  async function zacni() {
    zivo = true;
    shramba = await odpriShrambo();
    zahtevajTrajno();
    deviceId = await pridobiNapravo();
    const bere = async f => { try { return await f(); } catch { return undefined; } };
    const [k, shranjeniDogodki, vsi] = await Promise.all([
      bere(() => shramba.kvGet("kljuc")), bere(() => shramba.kvGet("dogodki:" + klub)), bere(() => shramba.skeniVsi())
    ]);
    if (!zivo) return;
    try { const x = k && sprejmiKljuc({ alg: "Ed25519", ...k }); if (x) kljuc = { kid: x.kid, javni: x.javni }; } catch { kljuc = null; }
    // Dogodki iz shrambe: skener se odpre TAKOJ, brez cakanja na omrezje (osvezitev dogodkov tece v ozadju, tik()).
    const imaShranjene = !!shranjeniDogodki && Array.isArray(shranjeniDogodki.dogodki);
    if (imaShranjene) { dogodki = shranjeniDogodki.dogodki; dogodkiCas = Number.isFinite(shranjeniDogodki.cas) ? shranjeniDogodki.cas : 0; }
    const zdaj = Date.now();
    for (const r of Array.isArray(vsi) ? vsi : []) {
      if (!r || typeof r.id !== "string" || r.klub !== klub) continue;
      const stara = r.stanje === "poslan" && (!r.konflikt || r.videl) && zdaj - (cas(r.scanned_at) || 0) > OBDRZI_POSLANE_MS;
      if (stara) { bere(() => shramba.skenDel(r.id)); continue; }
      skeni.set(r.id, r);
      if (!poSerialu.has(r.serial) || r.scanned_at < poSerialu.get(r.serial).scanned_at) poSerialu.set(r.serial, r);
    }
    preverjevalnik().then(ver => { if (zivo) stanje.set({ preverjanje: ver ? ver.ime : "ni" }); });
    objavi({ pripravljen: true, nacinShrambe: shramba.nacin });
    // Brez shranjenih dogodkov in brez povezave se ne bo nic prenesenega: zaslon naj pokaze "ni dogodka" namesto vrtavke.
    preracunaj(imaShranjene || !jeOnline() ? { dogodkiPripravljeni: true, ...(imaShranjene ? {} : { dogodkiOmrezje: "napaka" }) } : {});
    try {
      if ("BroadcastChannel" in window) {
        kanal = new BroadcastChannel("outly-sken");
        kanal.onmessage = e => { if (e.data && e.data.klub === klub && e.data.od !== deviceId + ":" + zavihek) uskladi(); };
      }
    } catch { kanal = null; }
    window.addEventListener("online", naPovezavi);
    window.addEventListener("offline", naIzpadu);
    document.addEventListener("visibilitychange", naVidnosti);
    casovnik = setInterval(tik, TIK_MS);
    tik();
  }

  function ustavi() {
    clearInterval(casovnik); clearTimeout(odloziPosiljanje);
    // Vratar zapusti zaslon: skeni v vrsti dobijo se en poskus posiljanja (sicer cakajo do naslednjega odprtja skenerja).
    const koncnoPoslji = zivo && stanje.get().caka > 0 && jeOnline();
    zivo = false;
    if (koncnoPoslji) poslji(true);
    try { if (kanal) kanal.close(); } catch { /* brez */ }
    kanal = null;
    window.removeEventListener("online", naPovezavi);
    window.removeEventListener("offline", naIzpadu);
    document.removeEventListener("visibilitychange", naVidnosti);
  }

  /** Vratar je prebral konflikt: izgine s seznama (zapis ostane do ciscenja). */
  async function potrdiKonflikt(id) {
    const r = skeni.get(id);
    if (!r) return;
    r.videl = true;
    objavi();
    await shrani(r);
  }
  const takojPoslji = () => { naslednjiPoslji = 0; napakPoslji = 0; naslednjiOsvezi = Math.min(naslednjiOsvezi, Date.now()); tik(); };

  return { stanje, zacni, ustavi, sken, potrdiKonflikt, takojPoslji, znovuNaloziDogodke };
}
