/* Zemljevid - faza 3 (ploscice Protomaps). Do takrat: klubi po razdalji, da zavihek ni prazen. */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import * as P from "../podatki.js";
import { razdaljaKm, napisRazdalje } from "../oblika.js";
import { useLokacija, zahtevajLokacijo } from "../lokacija.js";
import { Ikona, Vrstica, Nalaganje } from "../ui.js";

export function Zemljevid() {
  const [klubi, setKlubi] = useState(null);
  const lok = useLokacija();
  useEffect(() => { P.klubi().then(setKlubi).catch(() => setKlubi([])); }, []);
  const seznam = (klubi || []).map(k => ({ k, d: razdaljaKm(lok.polozaj, k) }))
    .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || a.k.name.localeCompare(b.k.name));
  return html`<div class="zaslon">
    <h1 class="velik-naslov">${t("Map")}</h1>
    <div class="kartica-info srednje">
      <${Ikona} ime="map" velikost=${28} razred="modra" />
      <strong>${t("The map is coming to the web soon.")}</strong>
      <span class="utisano">${t("Meanwhile, here are the clubs on Outly, closest first.")}</span>
      ${lok.polozaj ? null : html`<button type="button" class="gumb-siv" onClick=${zahtevajLokacijo} disabled=${lok.isce}>
        <${Ikona} ime="locate-fixed" velikost=${16} /> ${lok.isce ? t("Locating...") : t("Use my location")}</button>`}
      ${lok.napaka ? html`<span class="opomba">${lok.napaka}</span>` : null}
    </div>
    ${!klubi ? html`<${Nalaganje} />` : html`<div class="seznam">
      ${seznam.map(({ k, d }) => html`<${Vrstica} key=${k.id} href=${"/app/club/" + k.id} slikaUrl=${k.logo_url}
        naslov=${k.name} podnaslov=${[k.address || k.city, d != null ? napisRazdalje(d) : ""].filter(Boolean).join(" · ")} />`)}
    </div>`}
  </div>`;
}
