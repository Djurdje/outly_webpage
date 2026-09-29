/* Vsi klici na backend gredo skozi send() (kot APIClient.send() na iOS). Nikjer drugje fetch.
   - zeton iz seje Supabase; ob 401 ("token") enkrat osvezi sejo in ponovi,
   - 503 NIKOLI ne odjavi (invarianta I10: izpad Supabase ne sme odjaviti uporabnika),
   - napake kot ApiError(status, besedilo) -> napake.js/sporocilo() za uporabnika. */
import { supabase } from "./supabase.js";
import { ApiError } from "./napake.js";

export const API_URL = "https://outly-backend-roy3.onrender.com";
const CAKANJE_MS = 30000;

/* Seja nastavi, kaj se zgodi, ko Supabase sejo zavrne (odjava + obvestilo). */
let obZavrnjeniSeji = () => {};
export function nastaviObZavrnjeniSeji(fn) { obZavrnjeniSeji = fn; }

/* Izbrani klub (glava X-Outly-Club, backend 018) - za poslovni obraz v poznejsih fazah. */
let izbraniKlub = null;
export function nastaviIzbraniKlub(id) { izbraniKlub = id || null; }

export async function trenutniZeton() {
  try {
    // getSession() v supabase-js sam osvezi potekel zeton (z refresh_token).
    const { data } = await supabase.auth.getSession();
    return (data && data.session && data.session.access_token) || "";
  } catch { return ""; }
}

async function surovKlic(path, { method, body, zeton, signal }) {
  const glave = {};
  if (zeton) glave["Authorization"] = "Bearer " + zeton;
  if (izbraniKlub) glave["X-Outly-Club"] = String(izbraniKlub);
  if (body !== undefined) glave["Content-Type"] = "application/json";
  const krmilnik = new AbortController();
  const casovnik = setTimeout(() => krmilnik.abort(), CAKANJE_MS);
  if (signal) signal.addEventListener("abort", () => krmilnik.abort(), { once: true });
  try {
    return await fetch(API_URL + path, {
      method, headers: glave, signal: krmilnik.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } finally { clearTimeout(casovnik); }
}

async function preberi(odg) {
  const besedilo = await odg.text();
  if (!besedilo) return null;
  try { return JSON.parse(besedilo); } catch { return besedilo; }
}

/**
 * send("/me", { auth: true }) · send("/events/5", { auth: "optional" })
 * auth: false (javno) | "optional" (zeton, ce obstaja) | true (obvezen; brez njega 401 lokalno)
 */
export async function send(path, { method = "GET", body, auth = false, signal } = {}) {
  let zeton = auth ? await trenutniZeton() : "";
  if (auth === true && !zeton) throw new ApiError(401, "Missing token.");

  let odg;
  try { odg = await surovKlic(path, { method, body, zeton, signal }); }
  catch (e) {
    if (signal && signal.aborted) throw e;
    throw new ApiError(-1, "No response.");
  }

  if (odg.status === 401 && zeton) {
    const besedilo = await odg.clone().text();
    // Samo potekel/neveljaven zeton ("Missing token." / "Invalid token."), ne npr. napacno geslo.
    if (/token/i.test(besedilo)) {
      const osvezeno = await osveziSejo();
      if (osvezeno) {
        zeton = osvezeno;
        try { odg = await surovKlic(path, { method, body, zeton, signal }); }
        catch { throw new ApiError(-1, "No response."); }
      }
    }
  }

  const podatki = await preberi(odg);
  if (!odg.ok) {
    const raw = typeof podatki === "string" ? podatki : JSON.stringify(podatki || {});
    throw new ApiError(odg.status, raw);
  }
  return podatki;
}

/* Ena osvezitev naenkrat, tudi ce jo zahteva vec klicev hkrati. */
let tekocaOsvezitev = null;
async function osveziSejo() {
  if (!tekocaOsvezitev) {
    tekocaOsvezitev = (async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        // Supabase je sejo zavrnil (400/401/403) -> odjava. Omrezje ali 5xx -> seja ostane.
        const s = error.status || 0;
        if (s >= 400 && s < 500) obZavrnjeniSeji();
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
