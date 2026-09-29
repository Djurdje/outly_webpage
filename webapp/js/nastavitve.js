/* "My preferences" (UserPreferences.swift): shranjene SAMO v tem brskalniku (kot na iOS samo na napravi).
   Uporabljajo jih Filtri ("Use my preferences") in Home (najvecja razdalja do kluba, ko je lokacija znana). */
import { ustvariTrgovino, useStore, lokalno } from "./store.js";

const KLJUC = "outly_nastavitve";
const PRIVZETO = { genres: [], maxKm: 20, ageMin: 18, ageMax: 30, priceMin: 0, priceMax: 3000 };

export const nastavitve = ustvariTrgovino({ ...PRIVZETO, ...(lokalno.get(KLJUC, {}) || {}) });
export const useNastavitve = () => useStore(nastavitve);

export function shraniNastavitve(delni) {
  nastavitve.set(delni);
  lokalno.set(KLJUC, nastavitve.get());
}
