/* Stran kluba "Coming soon" (/app/soon/:slug): cover, logo, ime, naslov (sicer mesto), znacka, besedilo, Website/Instagram.
   Brez nakupa, brez sledenja (ne klicemo zabeleziOgled), brez dogodkov. Podatki iz istega seznama kot Home (predpomnjen 5 min). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import * as P from "../podatki.js";
import { Ikona, Slika, GlavaNazaj, Nalaganje } from "../ui.js";

export function KmaluKlub({ slug }) {
  const [klubi, setKlubi] = useState(null);
  useEffect(() => {
    let zivo = true;
    P.kmalu().then(k => { if (zivo) setKlubi(k); });
    return () => { zivo = false; };
  }, []);
  const k = klubi ? klubi.find(x => x.slug === slug) : null;
  useEffect(() => { if (k) document.title = k.name + " · Outly"; }, [k]);

  if (!klubi) return html`<div class="zaslon"><${GlavaNazaj} /><${Nalaganje} /></div>`;
  if (!k) return html`<div class="zaslon"><${GlavaNazaj} />
    <div class="prazno"><strong>${t("Page not found")}</strong><a class="gumb-siv" href="/app">${t("Go to Home")}</a></div></div>`;

  return html`<div class="zaslon klub kmalu-stran">
    <div class="klub-glava">
      <div class="kmalu-hero"><${Slika} src=${k.cover_url} sirina=${1000} alt="" nujna=${true} /></div>
      <span class="hero-senca spodaj" aria-hidden="true"></span>
      <${GlavaNazaj} prosojna=${true} />
      <h1 class="klub-ime">${k.name}</h1>
    </div>
    <div class="klub-info">
      <span class="okrogla-slika velika">${k.logo_url ? html`<${Slika} src=${k.logo_url} sirina=${190} alt="" />` : html`<${Ikona} ime="building" velikost=${24} />`}</span>
      <div class="klub-meta">
        ${k.address || k.city ? html`<span>${k.address || k.city}</span>` : null}
        <span class="znacka staticna kmalu-znacka">${t("COMING SOON")}</span>
      </div>
    </div>
    <p class="besedilo-opis">${t("{name} is coming to Outly soon. Events and tickets will be available here.", { name: k.name })}</p>
    ${k.website || k.instagram ? html`<div class="kmalu-gumbi">
      ${k.website ? html`<a class="gumb-siv" href=${k.website} target="_blank" rel="noopener noreferrer"><${Ikona} ime="globe" velikost=${18} /> ${t("Website")}</a>` : null}
      ${k.instagram ? html`<a class="gumb-siv" href=${"https://www.instagram.com/" + k.instagram + "/"} target="_blank" rel="noopener noreferrer"><${Ikona} ime="at-sign" velikost=${18} /> ${t("Instagram")}</a>` : null}
    </div>` : null}
  </div>`;
}
