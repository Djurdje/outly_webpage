/* Vrstica "Add to Home Screen" v Profilu in navodila za iOS (Safari namestitve ne ponudi sam). */
import { html, useState } from "../lib.js";
import { t } from "../i18n.js";
import { usePwa, namesti, jeIOS } from "../pwa.js";
import { Ikona, List } from "../ui.js";

export function VrsticaNamestitve() {
  const { namescena } = usePwa();
  const [navodila, setNavodila] = useState(false);
  if (namescena) return null;
  const klik = async () => { if (!(await namesti())) setNavodila(true); };
  return html`<div class="seznam-kartica">
    <button type="button" class="menijska-vrstica" onClick=${klik}><${Ikona} ime="smartphone" /><span>${t("Add Outly to Home Screen")}</span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></button>
    <${List} odprt=${navodila} zapri=${() => setNavodila(false)} naslov=${t("Add Outly to Home Screen")}>
      ${jeIOS() ? html`<ol class="koraki">
          <li>${t("Open outly.si/app in Safari.")}</li>
          <li>${t("Tap the Share button at the bottom of the screen.")}</li>
          <li>${t("Choose \"Add to Home Screen\" and tap Add.")}</li>
        </ol>`
        : html`<ol class="koraki">
          <li>${t("Open the browser menu (⋮ or ⋯).")}</li>
          <li>${t("Choose \"Install app\" or \"Add to Home screen\".")}</li>
        </ol>`}
      <p class="opomba">${t("Outly then opens like an app, full screen and without the browser bar.")}</p>
      <button type="button" class="gumb-siv" onClick=${() => setNavodila(false)}>${t("Close")}</button>
    <//>
  </div>`;
}
