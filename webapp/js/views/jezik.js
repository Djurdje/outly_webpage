/* Izbira jezika (LanguageView.swift): en | sl, preklop brez osvezitve strani. */
import { html } from "../lib.js";
import { t, useJezik, nastaviJezik } from "../i18n.js";
import { GlavaNazaj, Ikona } from "../ui.js";

const JEZIKI = [["en", "English"], ["sl", "Slovenščina"]];

export function Jezik() {
  const koda = useJezik();
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Language")} rezerva="/app/profile" />
    <div class="seznam-kartica" role="radiogroup" aria-label=${t("Language")}>
      ${JEZIKI.map(([k, ime]) => html`<button type="button" role="radio" aria-checked=${k === koda} class="menijska-vrstica" onClick=${() => nastaviJezik(k)}>
        <span>${ime}</span>${k === koda ? html`<${Ikona} ime="check" velikost=${18} razred="modra" />` : null}
      </button>`)}
    </div>
  </div>`;
}

/** Majhen preklop EN/SL na zaslonih prijave (kot JezikGumb na iOS). */
export function JezikGumb() {
  const koda = useJezik();
  const drugi = koda === "sl" ? "en" : "sl";
  return html`<button type="button" class="jezik-gumb" onClick=${() => nastaviJezik(drugi)}
    aria-label=${t("Language")}><${Ikona} ime="globe" velikost=${16} /> ${koda.toUpperCase()}</button>`;
}
