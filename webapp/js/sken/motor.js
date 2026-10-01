/* Skener vstopnic na vratih - jedro brez izrisa (issue Djurdje/outly-backend#86; zasnova: backend docs/STATE.md,
   invarianti I6 in I14). Martinova zahteva: skeniranje na vratih NE SME pasti - ne ob izpadu backenda, interneta v
   klubu ali Supabase. Zato telefon vstopnico preveri SAM:
     1. podpis kode v2 (Ed25519) z javnim kljucem (GET /business/scan-key),
     2. dogodek v kodi == izbrani dogodek, vstopnica ni med prenesenimi (transferred_serials),
     3. stanje po seznamu dogodka (GET /business/events/:id/scan-list) in po skenih, opravljenih na tej napravi.
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

const URA = 3600 * 1000;
const OSVEZI_SEZNAM_MS = 120000;       // ~vsake 2 min (+- jitter, da 1000 telefonov ne trka hkrati)
const JITTER_MS = 15000;
const TIK_MS = 5000;
const NAJVEC_ODLASANJA_MS = 30000;
const KOS_PAKETA = 200;                 // backend sprejme <= 500
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

/* Klic z lastno casovno mejo: ob "povezavi", ki ne prenasa podatkov (WiFi v klubu brez interneta), api.js sicer caka 30 s -
   prikaz povezave bi dolgo lagal, seznam dogodkov pa bi zadrzal odprtje skenerja. Streznik je pri scan-batch idempotenten. */
async function zMejo(ms, f) {
  const k = new AbortController();
  const t = setTimeout(() => k.abort(), ms);
  try { return await f(k.signal); } finally { clearTimeout(t); }
}

const cas = v => { const m = Date.parse(v); return Number.isFinite(m) ? m : null; };
const zakasni = ms => new Promise(ok => setTimeout(ok, ms));
const UUID_NAPRAVE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- dogodki kluba (izbira dogodka za skener) ---------- */

/** Dogodki, ki jih vratar utegne skenirati: od 3 dni nazaj do 30 dni naprej. Brez povezave iz shrambe. */
export async function dogodkiKluba(klub) {
  const sh = await odpriShrambo();
  try {
    let predpomnjeno = null;
    try { predpomnjeno = await sh.kvGet("dogodki:" + klub); } catch { /* brez */ }
    // Imamo shranjene dogodke: na mrtvem omrezju ne cakamo 30 s, odpremo takoj iz shrambe.
    const v = await zMejo(predpomnjeno ? 5000 : 15000, signal => poslovno(klub, "/business/events", { signal }));
    const zdaj = Date.now();
    const seznam = (Array.isArray(v) ? v : [])
      .map(e => ({ id: Number(e && e.id), title: String((e && e.title) || ""), start_at: (e && e.start_at) || null, end_at: (e && e.end_at) || null }))
      .filter(e => Number.isInteger(e.id) && e.id > 0 && cas(e.start_at) !== null && cas(e.start_at) >= zdaj - 3 * 24 * URA && cas(e.start_at) <= zdaj + 30 * 24 * URA)
      .sort((a, b) => cas(a.start_at) - cas(b.start_at));
    try { await sh.kvSet("dogodki:" + klub, { cas: zdaj, dogodki: seznam }); } catch { /* brez */ }
    return { dogodki: seznam, izOmrezja: true, napaka: null };
  } catch (e) {
    let shranjeno = null;
    try { shranjeno = await sh.kvGet("dogodki:" + klub); } catch { /* brez */ }
    return { dogodki: shranjeno && Array.isArray(shranjeno.dogodki) ? shranjeno.dogodki : [], izOmrezja: false, napaka: e };
  }
}

/** Dogodek, ki zdaj poteka (vrata se odprejo 12 h pred zacetkom - kot backend), najblizji zdajsnjemu casu; sicer null. */
export function privzetiDogodek(dogodki, zdaj = Date.now()) {
  let najboljsi = null, razdalja = Infinity;
  for (const e of dogodki || []) {
    const z = cas(e.start_at);
    if (z === null) continue;
    const k = cas(e.end_at) ?? z + 12 * URA;
    if (zdaj < z - 12 * URA || zdaj > k + 6 * URA) continue;
    if (Math.abs(z - zdaj) < razdalja) { razdalja = Math.abs(z - zdaj); najboljsi = e.id; }
  }
  return najboljsi;
}

/** { id, cas } zadnje izbire vratarja za klub ali null. */
export async function izbranDogodek(klub) {
  try { const v = await (await odpriShrambo()).kvGet("izbran:" + klub); return v && Number.isInteger(v.id) && Number.isFinite(v.cas) ? v : null; } catch { return null; }
}
export async function shraniIzbiro(klub, id) {
  try { await (await odpriShrambo()).kvSet("izbran:" + klub, { id, cas: Date.now() }); } catch { /* brez */ }
}

/* ---------- motor ---------- */

/** Motor za en klub in en dogodek. Stanje za izris je v `stanje` (trgovina: useStore). */
export function ustvariMotor({ klub, dogodek }) {
  const stanje = ustvariTrgovino({
    pripravljen: false, nacinShrambe: "", preverjanje: "",        // preverjanje: "" (se ne vemo) | "webcrypto" | "noble" | "ni"
    povezava: jeOnline(), caka: 0, vstopilo: 0, konflikti: [],
    seznamCas: null, seznamStevilo: 0, imaKljuc: false,
    sinhroniziram: false, osvezujem: false, napakaSinh: "", napakaSeznama: "", shranjevanjeNapaka: false
  });

  let shramba = null, deviceId = "", kljuc = null;                // kljuc: { kid, javni: Uint8Array }
  let seznam = null, prenesene = new Set(), seznamCas = null;     // seznam: Map serial -> vrstica seznama
  const skeni = new Map();                                        // client_scan_id -> zapis (vsi skeni kluba na tej napravi)
  const poSerialu = new Map();                                    // serial -> zapis (prvi sken te vstopnice)
  let omrezje = jeOnline();
  let posiljam = false, osvezujem = false, zivo = false;
  let casovnik = 0, odloziPosiljanje = 0;
  let naslednjiPoslji = 0, naslednjiOsvezi = 0, napakPoslji = 0, napakOsvezi = 0;
  let veriga = Promise.resolve();

  const povezava = () => jeOnline() && omrezje;
  const objavi = (delno = {}) => {
    let caka = 0, vstopilo = 0;
    const konflikti = [];
    for (const r of skeni.values()) {
      if (r.klub !== klub) continue;
      if (r.stanje === "caka") caka++;
      if (r.dogodek === dogodek) vstopilo++;
      if (r.konflikt && !r.videl) konflikti.push(konfliktZaIzris(r));
    }
    konflikti.sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
    stanje.set({ povezava: povezava(), caka, vstopilo, konflikti, seznamCas, seznamStevilo: seznam ? seznam.size : 0, imaKljuc: !!kljuc, ...delno });
  };
  const konfliktZaIzris = r => {
    const v = seznam && seznam.get(r.serial);
    return {
      id: r.id, serial: r.serial, scanned_at: r.scanned_at, rezultat: r.rezultat, used_at_streznik: r.used_at_streznik || null,
      imetnik: (v && v.holder_username) || "", lokalno: r.lokalno
    };
  };
  const omrezjeJe = ok => { omrezje = ok; if (stanje.get().povezava !== povezava()) stanje.set({ povezava: povezava() }); };
  const shrani = async rec => {
    try { await Promise.race([shramba.skenPut(rec), zakasni(ZAKAJ_SHRANI_MS).then(() => { throw new Error("shramba: cas"); })]); }
    catch { stanje.set({ shranjevanjeNapaka: true }); }
  };

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

  async function osvezi() {
    if (osvezujem || !zivo) return;
    osvezujem = true;
    stanje.set({ osvezujem: true });
    try {
      if (!kljuc) await naloziKljuc();
      const odg = await zMejo(20000, signal => poslovno(klub, `/business/events/${dogodek}/scan-list`, { signal }));
      if (!odg || typeof odg !== "object" || !Array.isArray(odg.tickets) || !Array.isArray(odg.transferred_serials) || Number(odg.event_id) !== dogodek) throw new Error("seznam");
      const m = new Map();
      for (const x of odg.tickets) if (x && typeof x.serial === "string") m.set(x.serial.toLowerCase(), x);
      seznam = m;
      prenesene = new Set(odg.transferred_serials.filter(x => typeof x === "string").map(x => x.toLowerCase()));
      seznamCas = Date.now();
      try { await shramba.kvSet(`seznam:${klub}:${dogodek}`, { kid: odg.kid || "", tickets: odg.tickets, transferred_serials: odg.transferred_serials, cas: seznamCas }); }
      catch { stanje.set({ shranjevanjeNapaka: true }); }
      omrezjeJe(true); napakOsvezi = 0;
      // Zasukan kljuc (past v backend STATE.md): primerjava po kid; seznam je ze shranjen, zato napaka tu ni usodna.
      if (typeof odg.kid === "string" && kljuc && odg.kid !== kljuc.kid) { try { await naloziKljuc(); } catch { /* naslednji krog */ } }
      naslednjiOsvezi = Date.now() + OSVEZI_SEZNAM_MS + (Math.random() * 2 - 1) * JITTER_MS;
      objavi({ napakaSeznama: "" });
    } catch (e) {
      napakOsvezi++;
      naslednjiOsvezi = Date.now() + Math.min(NAJVEC_ODLASANJA_MS * 2, 5000 * 2 ** napakOsvezi) * (0.8 + Math.random() * 0.4);
      if (e instanceof ApiError && !jeIzpad(e)) { omrezjeJe(true); objavi({ napakaSeznama: sporocilo(e) }); }
      else { omrezjeJe(false); objavi(); }
    } finally {
      osvezujem = false;
      stanje.set({ osvezujem: false });
    }
  }

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

  async function poslji() {
    if (posiljam || !zivo) return;
    const cakajoci = [...skeni.values()].filter(r => r.klub === klub && r.stanje === "caka").sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));
    if (!cakajoci.length) return;
    if (!jeOnline()) { objavi(); return; }
    posiljam = true;
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
    if (!jeOnline()) { objavi(); return; }
    if (stanje.get().caka > 0 && zdaj >= naslednjiPoslji) poslji();
    if (zdaj >= naslednjiOsvezi) osvezi();
    if (stanje.get().povezava !== povezava()) objavi();
  }
  const naPovezavi = () => { omrezje = true; naslednjiPoslji = 0; naslednjiOsvezi = 0; napakPoslji = 0; napakOsvezi = 0; objavi(); tik(); };
  const naIzpadu = () => objavi();
  const naVidnosti = () => { if (document.visibilityState === "visible") { naslednjiPoslji = 0; naslednjiOsvezi = Math.min(naslednjiOsvezi, Date.now()); tik(); } };

  /* --- sken --- */
  function sklepIzSeznama(v) {
    return { ticket: { is_vip: v.is_vip === true, table_label: v.table_label || "", package_name: v.package_name || "" }, imetnik: v.holder_username || "" };
  }

  async function prekoStreznika(koda, vrsta) {
    // vrsta: "v1" (samo streznik zna) | "v2" (telefon ne more preveriti: ni kljuca ali brskalnik ne zna Ed25519)
    const rumeno = { tip: vrsta === "v1" ? "stara-potrebna-povezava" : "potrebna-povezava", barva: "rumena" };
    if (!povezava()) return rumeno;
    const krmilnik = new AbortController();
    const rok = setTimeout(() => krmilnik.abort(), CAKANJE_STREZNIKA_MS);
    try {
      const odg = await skenirajVstopnico(klub, koda, { signal: krmilnik.signal });
      omrezjeJe(true);
      return { tip: "streznik", barva: odg.result === "ok" ? "zelena" : "rdeca", streznik: odg, ticket: odg.ticket || null };
    } catch (e) {
      if (jeIzpad(e)) { omrezjeJe(false); return rumeno; }
      return { tip: "napaka", barva: "rdeca", opis: sporocilo(e) };
    } finally { clearTimeout(rok); }
  }

  async function preveriV2(r, koda) {
    const ver = await preverjevalnik();
    if (!ver) stanje.set({ preverjanje: "ni" }); else if (stanje.get().preverjanje !== ver.ime) stanje.set({ preverjanje: ver.ime });
    if (!ver || !kljuc) return prekoStreznika(koda, "v2");   // brez kljuca / brez Ed25519: kot prej, samo s povezavo

    let veljaven = await podpisVeljaven(r, kljuc.javni, ver);
    if (!veljaven && r.kid && r.kid !== kljuc.kid) {
      // Koda je podpisana z drugim kljucem, kot ga imamo: zasukana skrivnost ali ponaredek. Znova prenesi kljuc (ce gre).
      if (povezava()) {
        try { await naloziKljuc(); omrezjeJe(true); veljaven = await podpisVeljaven(r, kljuc.javni, ver); }
        catch (e) { if (jeIzpad(e)) omrezjeJe(false); }
      }
      if (!veljaven && r.kid !== kljuc.kid && !povezava()) return { tip: "potrebna-povezava", barva: "rumena" };
    }
    if (!veljaven) return { tip: "neveljavna", barva: "rdeca" };

    if (r.dogodek !== dogodek) return { tip: "drug-dogodek", barva: "rdeca" };
    if (prenesene.has(r.serial)) return { tip: "preneseno", barva: "rdeca" };
    const prvi = poSerialu.get(r.serial);
    if (prvi) return { tip: "ze-skenirano", barva: "rdeca", cas: cas(prvi.scanned_at), ...(seznam && seznam.get(r.serial) ? sklepIzSeznama(seznam.get(r.serial)) : {}) };
    const v = seznam ? seznam.get(r.serial) : null;
    if (v && v.status !== "valid") {
      if (v.status === "used") return { tip: "ze-skenirano", barva: "rdeca", cas: cas(v.used_at), ...sklepIzSeznama(v) };
      if (v.status === "refunded") return { tip: "vrnjeno", barva: "rdeca" };
      if (v.status === "void") return { tip: "preklicano", barva: "rdeca" };
      return { tip: "zavrnjeno", barva: "rdeca" };
    }

    const rec = {
      id: uuid(), klub, dogodek, serial: r.serial, qr: koda.trim(), scanned_at: new Date().toISOString(), device_id: deviceId,
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

  /** En sken. Vedno vrne sklep (nikoli izjeme). Skeni se obdelujejo po vrsti (preverjanje + zapis sta atomarna). */
  function sken(koda) {
    const p = veriga.then(async () => {
      try {
        const r = razcleniQr(koda);
        if (r.vrsta === "neznano") return { tip: "ni-vstopnica", barva: "rdeca" };
        if (r.vrsta === "v1") return await prekoStreznika(koda, "v1");
        return await preveriV2(r, koda);
      } catch (e) {
        return { tip: "napaka", barva: "rdeca", opis: sporocilo(e) };
      }
    });
    veriga = p.catch(() => {});
    return p;
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
    const [k, sez, vsi] = await Promise.all([
      bere(() => shramba.kvGet("kljuc")), bere(() => shramba.kvGet(`seznam:${klub}:${dogodek}`)), bere(() => shramba.skeniVsi())
    ]);
    if (!zivo) return;
    try { const x = k && sprejmiKljuc({ alg: "Ed25519", ...k }); if (x) kljuc = { kid: x.kid, javni: x.javni }; } catch { kljuc = null; }
    if (sez && Array.isArray(sez.tickets) && Array.isArray(sez.transferred_serials)) {
      seznam = new Map();
      for (const x of sez.tickets) if (x && typeof x.serial === "string") seznam.set(x.serial.toLowerCase(), x);
      prenesene = new Set(sez.transferred_serials.filter(x => typeof x === "string").map(x => x.toLowerCase()));
      seznamCas = Number.isFinite(sez.cas) ? sez.cas : null;
    }
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
    window.addEventListener("online", naPovezavi);
    window.addEventListener("offline", naIzpadu);
    document.addEventListener("visibilitychange", naVidnosti);
    casovnik = setInterval(tik, TIK_MS);
    tik();
  }

  function ustavi() {
    clearInterval(casovnik); clearTimeout(odloziPosiljanje);
    // Vratar zapusti zaslon: skeni v vrsti dobijo se en poskus posiljanja (sicer cakajo do naslednjega odprtja skenerja).
    if (zivo && stanje.get().caka > 0 && jeOnline()) poslji();
    zivo = false;
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

  return { stanje, zacni, ustavi, sken, potrdiKonflikt, takojPoslji };
}
