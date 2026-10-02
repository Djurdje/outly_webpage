/* Vsi klici na backend gredo skozi send() (kot APIClient.send() na iOS). Nikjer drugje fetch.
   - zeton iz seje Supabase; ob 401 ("token") enkrat osvezi sejo in ponovi,
   - 503 NIKOLI ne odjavi (invarianta I10: izpad Supabase ne sme odjaviti uporabnika),
   - napake kot ApiError(status, besedilo) -> napake.js/sporocilo() za uporabnika. */
import { supabase } from "./supabase.js";
import { ApiError } from "./napake.js";

export const API_URL = "https://outly-backend-roy3.onrender.com";
const CAKANJE_MS = 30000;
/* Nakup (POST .../orders) nima 30 s meje kot ostali klici: ob hladnem zagonu Renderja strezniku traja dlje (semafor 15 s +
   idempotenca 10 s + DB 10 s, skupaj najvec ~35-40 s). Ker nakup nosi Idempotency-Key (glej kljucNakupa), je prekinitev
   varna: ponovni klik z istim kljucem vrne isto narocilo. Skupna meja NAKUP_MEJA_MS (vkljucno s pridobitvijo zetona)
   uporabnika ne pusti viseti v listu, ki se med nakupom ne da zapreti; ob izteku send() vrne ApiError(-1) = izid
   "nerazresen" (isti kljuc, napotek "may have gone through"), kot iOS timeoutInterval 30 s s prostorom za zagon. */
export const NAKUP_MEJA_MS = 50000;
const JE_NAKUP = /\/orders$/;
const BREZ_MEJE = /\/orders$|^\/me$|\/transfer$/;

/* Seja nastavi, kaj se zgodi, ko Supabase sejo zavrne (odjava + obvestilo). */
let obZavrnjeniSeji = () => {};
export function nastaviObZavrnjeniSeji(fn) { obZavrnjeniSeji = fn; }

/* Izbrani klub (glava X-Outly-Club, backend 018) - za poslovni obraz v poznejsih fazah. */
let izbraniKlub = null;
export function nastaviIzbraniKlub(id) { izbraniKlub = id || null; }

/* Ali je v brskalniku shranjena seja (tudi ce je zeton potekel in ga zdaj ni mogoce osveziti). */
export const KLJUC_SEJE = "sb-zbewqcxnvrwebxonvebx-auth-token";
export function imaShranjenoSejo() {
  try { return !!localStorage.getItem(KLJUC_SEJE); } catch { return false; }
}

/* Napaka Supabase, ki ni zavrnitev seje: omrezje ali 5xx. Taka napaka NE sme odjaviti (I10). */
const zacasna = err => !!err && (err.name === "AuthRetryableFetchError" || !err.status || err.status >= 500);

export async function trenutniZeton() {
  // getSession() v supabase-js sam osvezi potekel zeton (z refresh_token). Ce osvezitev pade zaradi
  // omrezja, vrne session: null + napako, seje pa ne izbrise - takrat vrzemo -1, ne "ni prijave".
  let rezultat;
  try { rezultat = await supabase.auth.getSession(); }
  catch { throw new ApiError(-1, "Could not refresh session."); }
  const { data, error } = rezultat;
  const zeton = (data && data.session && data.session.access_token) || "";
  if (!zeton && error && zacasna(error) && imaShranjenoSejo()) throw new ApiError(-1, "Could not refresh session.");
  return zeton;
}

async function surovKlic(path, { method, body, zeton, signal, klub, glave: dodatne }) {
  // Klic, ki ga je klicatelj ze preklical (casovna meja, medtem ko je cakal na zeton), NE sme oditi na streznik:
  // listener "abort" spodaj ne bi vec sprozil.
  if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
  const glave = {};
  if (dodatne) Object.assign(glave, dodatne);   // npr. Idempotency-Key; spodnje glave (Authorization ...) jih ne povozijo
  if (zeton) glave["Authorization"] = "Bearer " + zeton;
  const k = klub || izbraniKlub;
  if (k) glave["X-Outly-Club"] = String(k);
  if (body !== undefined) glave["Content-Type"] = "application/json";
  const krmilnik = new AbortController();
  const casovnik = (method === "POST" || method === "DELETE") && BREZ_MEJE.test(path) ? null : setTimeout(() => krmilnik.abort(), CAKANJE_MS);
  if (signal) signal.addEventListener("abort", () => krmilnik.abort(), { once: true });
  try {
    return await fetch(API_URL + path, {
      method, headers: glave, signal: krmilnik.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } finally { if (casovnik) clearTimeout(casovnik); }
}

async function preberi(odg) {
  const besedilo = await odg.text();
  if (!besedilo) return null;
  try { return JSON.parse(besedilo); } catch { return besedilo; }
}

/**
 * send("/me", { auth: true }) · send("/events/5", { auth: "optional" })
 * auth: false (javno) | "optional" (zeton, ce obstaja) | true (obvezen; brez njega 401 lokalno)
 * glave: dodatne glave zahtevka (npr. { "Idempotency-Key": uuid }); brez njih se klic ne spremeni.
 */
export function send(path, opcije = {}) {
  if ((opcije.method || "GET") !== "POST" || !JE_NAKUP.test(path)) return posljiKlic(path, opcije);
  // Nakup: skupna casovna meja za zeton + zahtevek. Po izteku se zahtevek prekine, pozne obljube pa se utisajo.
  const krmilnik = new AbortController(), zunanji = opcije.signal;
  if (zunanji) { if (zunanji.aborted) krmilnik.abort(); else zunanji.addEventListener("abort", () => krmilnik.abort(), { once: true }); }
  let casovnik;
  const iztek = new Promise((_, napaka) => { casovnik = setTimeout(() => { krmilnik.abort(); napaka(new ApiError(-1, "No response.")); }, NAKUP_MEJA_MS); });
  const klic = posljiKlic(path, { ...opcije, signal: krmilnik.signal });
  klic.catch(() => {});   // po izteku zavrnitev (AbortError) ni vec zanimiva
  return Promise.race([klic, iztek]).finally(() => clearTimeout(casovnik));
}

async function posljiKlic(path, { method = "GET", body, auth = false, signal, klub, glave } = {}) {
  let zeton = auth ? await trenutniZeton() : "";
  if (auth === true && !zeton) throw new ApiError(401, "Missing token.");

  let odg;
  try { odg = await surovKlic(path, { method, body, zeton, signal, klub, glave }); }
  catch (e) {
    if (signal && signal.aborted) throw e;
    throw new ApiError(-1, "No response.");
  }

  if (odg.status === 401 && zeton) {
    const besedilo = await odg.clone().text();
    // Samo potekel/neveljaven zeton ("Missing token." / "Invalid token."), ne npr. napacno geslo.
    if (/token/i.test(besedilo)) {
      const osvezeno = await osveziSejo();
      // Osvezitev ni uspela zaradi omrezja/5xx: seja ostane, klic javimo kot "ni odgovora" (I10).
      if (osvezeno === null) throw new ApiError(-1, "Could not refresh session.");
      if (osvezeno) {
        zeton = osvezeno;
        try { odg = await surovKlic(path, { method, body, zeton, signal, klub, glave }); }
        catch { throw new ApiError(-1, "No response."); }
      }
    }
  }

  const podatki = await preberi(odg);
  if (!odg.ok) {
    const raw = typeof podatki === "string" ? podatki : JSON.stringify(podatki || {});
    // Retry-After (sekunde); cez CORS ga brskalnik vidi samo, ce ga backend razkrije - sicer null.
    const cakaj = Number(odg.headers.get("Retry-After"));
    throw new ApiError(odg.status, raw, Number.isFinite(cakaj) && cakaj > 0 ? cakaj : 0);
  }
  return podatki;
}

/* Idempotentni kljuc nakupa (backend #123, enaka pravila kot iOS NakupniKljucShramba). En UUID = en nakup. Ponovni
   poskus ISTEGA nakupa (timeout, brez odgovora, 503, 409 request_in_progress, ponovni klik, zaprtje in ponovno
   odprtje lista) poslje ISTI kljuc, zato backend vrne isto narocilo namesto drugega. Kljuc je v pomnilniku MODULA
   (ne zaslona, ne localStorage): ce bi ga ob zaprtju lista pozabili, bi nakup brez odgovora (narocilo je na strezniku
   ze nastalo) ob ponovnem odprtju ustvaril drugo narocilo.
   Zapis je vezan na (vrsta nakupa, uporabnik, dogodek); znotraj zapisa velja: sprememba vsebine (kolicina oz. miza +
   paket) = nov kljuc. Nakup drugega dogodka zapisa NE zbrise (nejasen izid na dogodku A ostane, ko kupis na B).
   Velja KLJUC_ZIVLJENJE_MS od zadnje uporabe (24 h: backend hrani kljuc trajno, krajsi iztek bi po dolgem cakanju z
   odprtim listom dal nov kljuc in drugo narocilo).
   Izid zadnjega poskusa: "nerazresen" (brez odgovora, request_in_progress; null = odgovor se ni prisel - isto) ali
   "dokoncen". Ponovno odprt list predizpolni vsebino (nerazresenNakup) samo po nerazresenem izidu.
   Zapis se zavrze ob uspehu, 422, 400 invalid_idempotency_key, 409 order_not_active, ob odjavi/zamenjavi uporabnika
   in po izteku. Zaostal odgovor starega zahtevka ne sme pobrisati ali oznaciti tujega zapisa: pozabi/oznaci
   delujeta samo, ce je kljuc v zapisu se isti. */
export const KLJUC_ZIVLJENJE_MS = 24 * 60 * 60 * 1000;
export function novUUID() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16); c.getRandomValues(b);   // starejsi Safari (< 15.4)
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const kljuciNakupov = new Map();   // "vrsta|uporabnik|dogodek" -> { kljuc, vsebina, podatki, izid, prej, ob }
const potNakupa = (vrsta, uporabnik, dogodek) => `${vrsta}|${uporabnik}|${dogodek}`;
function zivZapis(pot) {
  const z = kljuciNakupov.get(pot);
  if (z && Date.now() - z.ob >= KLJUC_ZIVLJENJE_MS) { kljuciNakupov.delete(pot); return null; }
  return z || null;
}
/** Klici tik pred posiljanjem. Isti kljuc kot pri prejsnjem poskusu iste vsebine istega uporabnika in dogodka, ce ni potekel;
    sicer nov. vsebina = niz (kolicina oz. miza|paket); podatki = izbira za predizpolnitev ({ dogodek, kolicina } | { dogodek, miza, paket }). */
export function kljucNakupa(vrsta, uporabnik, dogodek, vsebina, podatki = null) {
  const pot = potNakupa(vrsta, uporabnik, dogodek);
  let z = zivZapis(pot);
  if (!z || z.vsebina !== vsebina) z = { kljuc: novUUID(), izid: "dokoncen" };
  z.prej = z.izid;   // izid pred tem poskusom (za "neposlan"; null = prejsnji poskus brez odgovora ostane nerazresen)
  Object.assign(z, { vsebina, podatki, izid: null, ob: Date.now() });   // izid null = odgovor se ni prisel (obravnavamo kot nerazresen)
  kljuciNakupov.set(pot, z);
  return z.kljuc;
}
/** Izid poskusa s tem kljucem: "nerazresen" | "dokoncen" | "neposlan" (zahtevek ni odsel, npr. osvezitev seje ni uspela:
    zapis ostane, kakrsen je bil pred poskusom). Ne dela nic, ce je v zapisu ze drug kljuc. */
export function oznaciIzidNakupa(vrsta, uporabnik, dogodek, kljuc, izid) {
  const z = zivZapis(potNakupa(vrsta, uporabnik, dogodek));
  if (!z || z.kljuc !== kljuc) return;
  z.izid = izid === "neposlan" ? z.prej : izid;
  z.ob = Date.now();
}
/** Podatki zadnjega NERAZRESENEGA nakupa tega uporabnika za ta dogodek, sicer null. Po dokoncni napaki (403, razprodano,
    already booked, 503 ...), uspehu, rotaciji kljuca, izteku in odjavi ni nicesar (backend kljuca ne zapomni). */
export function nerazresenNakup(vrsta, uporabnik, dogodek) {
  const z = zivZapis(potNakupa(vrsta, uporabnik, dogodek));
  return z && (z.izid === null || z.izid === "nerazresen") ? z.podatki : null;
}
/** Zavrzi zapis (uspeh, 422, 400, 409 order_not_active) - samo ce je v njem se isti kljuc. */
export function pozabiKljucNakupa(vrsta, uporabnik, dogodek, kljuc) {
  const pot = potNakupa(vrsta, uporabnik, dogodek), z = kljuciNakupov.get(pot);
  if (z && z.kljuc === kljuc) kljuciNakupov.delete(pot);
}
/** Odjava ali zamenjava uporabnika: vsi kljuci stran. */
export function pozabiVseKljuceNakupa() { kljuciNakupov.clear(); }

/* Ena osvezitev naenkrat, tudi ce jo zahteva vec klicev hkrati.
   Vrne nov zeton, "" (seja zavrnjena) ali null (zacasna napaka - seja ostane). */
let tekocaOsvezitev = null;
async function osveziSejo() {
  if (!tekocaOsvezitev) {
    tekocaOsvezitev = (async () => {
      let r;
      try { r = await supabase.auth.refreshSession(); } catch { return null; }
      const { data, error } = r;
      if (error) {
        // Omrezje ali 5xx -> null (seja ostane). Supabase je sejo zavrnil (4xx) -> odjava, "".
        if (zacasna(error)) return null;
        obZavrnjeniSeji();
        return "";
      }
      return (data && data.session && data.session.access_token) || "";
    })().finally(() => { setTimeout(() => { tekocaOsvezitev = null; }, 0); });
  }
  return tekocaOsvezitev;
}

/* Kratek predpomnilnik javnih GET odgovorov (seznami klubov/dogodkov), da vrnitev na zaslon
   ne nalaga vsega znova. Vstopnic in osebnih podatkov NE predpomnimo. */
const predpomnilnik = new Map();
export function javno(path, { ttl = 60000, sveze = false } = {}) {
  const zdaj = Date.now();
  const v = predpomnilnik.get(path);
  if (!sveze && v && zdaj - v.cas < ttl) return v.obljuba;
  const obljuba = send(path).catch(e => { predpomnilnik.delete(path); throw e; });
  predpomnilnik.set(path, { cas: zdaj, obljuba });
  return obljuba;
}
export function pocistiPredpomnilnik() { predpomnilnik.clear(); }

/* Stetje ogledov (backend 021): tiho, brez zetona, napaka se ne kaze. */
export function zabeleziOgled(cilj) {
  send("/views", { method: "POST", body: cilj }).catch(() => {});
}

/* Nalaganje slike na Cloudinary: podpis izda backend (POST /uploads/cloudinary-signature, zeton), datoteka
   gre neposredno na Cloudinary (ne cez nas streznik). public_id je del podpisa - posljemo ga nespremenjenega.
   Vrne secure_url. To ni klic backenda, zato gre mimo send(). */
export async function naloziNaCloudinary(datoteka, vrsta = "image") {
  const p = await send("/uploads/cloudinary-signature", { method: "POST", auth: true });
  const f = new FormData();
  f.append("api_key", p.apiKey);
  f.append("timestamp", String(p.timestamp));
  f.append("folder", p.folder);
  f.append("public_id", p.publicId);
  f.append("signature", p.signature);
  f.append("file", datoteka);
  let odg;
  try {
    odg = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(p.cloudName)}/${vrsta}/upload`, { method: "POST", body: f });
  } catch { throw new ApiError(-1, "No response."); }
  const r = await odg.json().catch(() => ({}));
  if (!odg.ok || !r.secure_url) throw new ApiError(odg.status || 500, "Upload failed.");
  return r.secure_url;
}

/* Pomanjsa sliko v brskalniku pred nalaganjem (najvec 1200 px, JPEG) - manj podatkov in hitrejse
   nalaganje (iOS lekcija 29. 9.: nikoli slike v polni locljivosti). */
export async function pomanjsajSliko(datoteka, najvec = 1200) {
  const bitmap = await createImageBitmap(datoteka).catch(() => null);
  if (!bitmap) return datoteka;
  const faktor = Math.min(1, najvec / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * faktor); c.height = Math.round(bitmap.height * faktor);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);   // prosojen PNG -> JPEG brez crnega ozadja
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close && bitmap.close();
  return await new Promise(res => c.toBlob(b => res(b || datoteka), "image/jpeg", 0.86));
}
