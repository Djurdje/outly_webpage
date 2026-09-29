/* Lokacija uporabnika: SAMO na zahtevo (gumb). Ce je dovoljenje ze dano (prejsnji obisk),
   jo preberemo sami. Polozaj ostane v brskalniku - razdalje se racunajo tu, na streznik ne gre. */
import { ustvariTrgovino, useStore } from "./store.js";
import { t } from "./i18n.js";

export const lokacija = ustvariTrgovino({ polozaj: null, isce: false, napaka: "" });
export const useLokacija = () => useStore(lokacija);

export function zahtevajLokacijo() {
  if (!("geolocation" in navigator)) { lokacija.set({ napaka: t("Location is not available in this browser.") }); return; }
  lokacija.set({ isce: true, napaka: "" });
  navigator.geolocation.getCurrentPosition(
    p => lokacija.set({ polozaj: { lat: p.coords.latitude, lng: p.coords.longitude }, isce: false }),
    e => lokacija.set({
      isce: false,
      napaka: e.code === 1 ? t("Location access is off. You can allow it in your browser settings.") : t("Could not get your location.")
    }),
    { enableHighAccuracy: false, maximumAge: 5 * 60e3, timeout: 15e3 }
  );
}

try {
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then(s => { if (s.state === "granted") zahtevajLokacijo(); }).catch(() => {});
  }
} catch { /* Safari starejsi: ni Permissions API */ }
