/* "My preferences" (UserPreferences.swift): shranjene SAMO v tem brskalniku (kot na iOS samo na napravi).
   Uporabljajo jih Filtri ("Use my preferences") in Home (najvecja razdalja do kluba, ko je lokacija znana). */
import { ustvariTrgovino, useStore, lokalno } from "./store.js";

const KLJUC = "outly_nastavitve";
const PRIVZETO = { genres: [], maxKm: 20, ageMin: 18, ageMax: 30, priceMin: 0, priceMax: 3000 };

/* Shranjene vrednosti preverimo (star ali pokvarjen zapis ne sme podreti aplikacije). */
function preberi() {
  const v = lokalno.get(KLJUC, null);
  if (!v || typeof v !== "object") return { ...PRIVZETO, shranjeno: false };
  const st = (x, d) => (Number.isFinite(x) ? x : d);
  return {
    genres: Array.isArray(v.genres) ? v.genres.filter(g => typeof g === "string") : [],
    maxKm: st(v.maxKm, PRIVZETO.maxKm), ageMin: st(v.ageMin, PRIVZETO.ageMin), ageMax: st(v.ageMax, PRIVZETO.ageMax),
    priceMin: st(v.priceMin, PRIVZETO.priceMin), priceMax: st(v.priceMax, PRIVZETO.priceMax),
    shranjeno: true
  };
}
export const nastavitve = ustvariTrgovino(preberi());
export const useNastavitve = () => useStore(nastavitve);

export function shraniNastavitve(delni) {
  nastavitve.set({ ...delni, shranjeno: true });
  lokalno.set(KLJUC, nastavitve.get());
}

/** Najvecja razdalja za Home: samo ce jo je uporabnik sam nastavil; 100 km (drsnik "100 km+") = brez meje. */
export const mejaRazdalje = n => (n.shranjeno && n.maxKm < 100 ? n.maxKm : Infinity);
