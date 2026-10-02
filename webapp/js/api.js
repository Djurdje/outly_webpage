/* Vsi klici na backend gredo skozi send() (kot APIClient.send() na iOS). Nikjer drugje fetch.
   - zeton iz seje Supabase; ob 401 ("token") enkrat osvezi sejo in ponovi,
   - 503 NIKOLI ne odjavi (invarianta I10: izpad Supabase ne sme odjaviti uporabnika),
   - napake kot ApiError(status, besedilo) -> napake.js/sporocilo() za uporabnika. */
import { supabase } from "./supabase.js";
import { ApiError } from "./napake.js";

export const API_URL = "https://outly-backend-roy3.onrender.com";
const CAKANJE_MS = 30000;
/* Nakup (POST) brez casovne meje: ob hladnem zagonu Renderja bi prekinjen zahtevek lahko ze ustvaril
   narocilo. Ponovni poskus je zdaj varen (glava Idempotency-Key, glej kljuciNakupa), a prekinitev ob
   casovni meji bi uporabnika po nepotrebnem pahnila v negotovost; odgovor pride ali pa povezava pade. */
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
export async function send(path, { method = "GET", body, auth = false, signal, klub, glave } = {}) {
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

/* Idempotentni kljuc nakupa (backend #123, enaka pravila kot iOS). En UUID = en nakup. Ponovni poskus ISTEGA
   nakupa (timeout, brez odgovora, 503, 409 request_in_progress, ponovni klik) poslje ISTI kljuc, zato backend
   vrne isto narocilo namesto drugega. Nov kljuc: sprememba vsebine nakupa (dogodek, kolicina, miza, paket),
   po uspehu in po 422 idempotency_key_reused. Zaslon dobi enega s kljuciNakupa() (useRef) in pokliche
   za(vsebina) ob kliku, pozabi() po uspehu/422. Kljuc ostane v pomnilniku zaslona (nikoli v localStorage). */
export function novUUID() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16); c.getRandomValues(b);   // starejsi Safari (< 15.4)
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function kljuciNakupa() {
  let vsebina = null, kljuc = null;
  return {
    za(v) { if (kljuc === null || vsebina !== v) { vsebina = v; kljuc = novUUID(); } return kljuc; },
    pozabi() { vsebina = null; kljuc = null; }
  };
}

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
