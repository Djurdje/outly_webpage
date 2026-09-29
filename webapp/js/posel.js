/* Poslovni del (faza 4): skupno za zaslone kluba. Vlogo v klubu (owner | manager | doorman) odloca streznik
   ob vsakem klicu; tu je samo izbira obraza. Vsak klic poslovnih poti poslje klub iz URL-ja (/app/business/:klub)
   v glavi X-Outly-Club (backend 018: oseba je lahko v vec ekipah) - tako globoka povezava ali osvezitev
   vedno velja za pravi klub (iOS ima za to globalni IzbraniKlub). */
import { useEffect, useState } from "./lib.js";
import { t } from "./i18n.js";
import { send } from "./api.js";
import { ustvariTrgovino, useStore, lokalno } from "./store.js";
import { normalizirajKlub, normalizirajDogodek } from "./oblika.js";

export const imeVloge = v => (v === "owner" ? t("Owner") : v === "manager" ? t("Manager") : t("Door staff"));
export const lahkoUreja = v => v === "owner" || v === "manager" || v === "admin";

/* Obraz profila lastnika (iOS @AppStorage "profilObraz"): "club" = klubski profil, "personal" = osebni.
   Velja samo za vlogo business; shranjeno samo v tem brskalniku. */
const KLJUC_OBRAZA = "outly_profil_obraz";
export const obraz = ustvariTrgovino({ vrednost: lokalno.get(KLJUC_OBRAZA, "club") === "personal" ? "personal" : "club" });
export const useObraz = () => useStore(obraz, s => s.vrednost);
export function nastaviObraz(v) { obraz.set({ vrednost: v }); lokalno.set(KLJUC_OBRAZA, v === "personal" ? "personal" : null); }

/** Klub iz poti; celo stevilo ali null. */
export const idKluba = v => (/^\d{1,9}$/.test(String(v || "")) ? Number(v) : null);

/** Poslovni klic za dolocen klub (glava X-Outly-Club). */
export const poslovno = (klub, pot, moznosti = {}) => send(pot, { auth: true, klub, ...moznosti });

/** Poln klub za urejanje (GET /business/clubs/me) + moja vloga v njem (my_role). */
export function useKlub(klub) {
  const [s, setS] = useState({ nalaga: true, napaka: null, klub: null });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    return poslovno(klub, "/business/clubs/me")
      .then(k => setS({ nalaga: false, napaka: null, klub: normalizirajKlub(k) }))
      .catch(e => setS({ nalaga: false, napaka: e, klub: null }));
  };
  useEffect(() => { if (klub) nalozi(); }, [klub]);
  return { ...s, nalozi, nastavi: k => setS(x => ({ ...x, klub: normalizirajKlub(k) })) };
}

export const normalizirajDogodke = seznam => (Array.isArray(seznam) ? seznam : []).map(normalizirajDogodek);

/** "12,50" ali "12.50" -> 1250; "" -> null (brez cene); neveljavno -> undefined. Brez plavajoce vejice. */
export function centiIz(besedilo, najvecEvrov = 999999) {
  const v = String(besedilo || "").replace(/€/g, "").replace(/\s/g, "").replace(",", ".");
  if (!v) return null;
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return undefined;
  const centi = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"));
  return centi > najvecEvrov * 100 ? undefined : centi;
}
/** 1250 -> "12.50" (za vnosno polje). */
export const evriBesedilo = c => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

/** Najvec 100 MB za video (Cloudinary brezplacni paket, isto kot iOS). */
export const NAJVEC_VIDEA = 100 * 1024 * 1024;
