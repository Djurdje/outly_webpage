/* Klubi "Coming soon" na Home: vodoravna vrsta kartic (cover 16:10, preliv, logo, ime, mesto, znacka). Klik odpre /app/soon/:slug
   (views/kmalu-klub.js, lena). Podatki prihajajo normalizirani iz podatki.js kmalu(); prazen seznam = razdelek se ne izrise. */
import { html } from "../lib.js";
import { t } from "../i18n.js";
import { Ikona, Slika, NaslovSekcije } from "../ui.js";

export function SekcijaKmalu({ klubi }) {
  if (!klubi || !klubi.length) return null;
  return html`<section class="sekcija">
    <${NaslovSekcije} naslov=${t("Coming soon")} />
    <p class="kmalu-pod">${t("New clubs joining Outly")}</p>
    <div class="vrsta-drsna">${klubi.map(k => html`<${KarticaKmalu} key=${k.slug} klub=${k} />`)}</div>
  </section>`;
}

function KarticaKmalu({ klub: k }) {
  return html`<a class="kartica-kmalu" href=${"/app/soon/" + k.slug}>
    <${Slika} src=${k.cover_url} sirina=${600} alt="" />
    <span class="km-senca" aria-hidden="true"></span>
    <span class="znacka">${t("COMING SOON")}</span>
    <span class="km-dno">
      <span class="okrogla-slika km-logo">${k.logo_url ? html`<${Slika} src=${k.logo_url} sirina=${120} alt="" />` : html`<${Ikona} ime="building" velikost=${18} />`}</span>
      <span class="km-besedilo"><strong>${k.name}</strong>${k.city ? html`<span>${k.city}</span>` : null}</span>
    </span>
  </a>`;
}
