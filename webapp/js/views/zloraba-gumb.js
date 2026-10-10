/* Vrstica "Report" na strani kluba in dogodka. Obrazec (views/zloraba.js) se nalozi sele ob kliku (leno uvozen modul),
   da deljene povezave na dogodek/klub ne vlecejo nepotrebne kode. Ne kaze se na lastnem klubu/dogodku;
   neprijavljen uporabnik gre na prijavo in se vrne na isto stran. */
import { html, useState } from "../lib.js";
import { t } from "../i18n.js";
import { useSeja } from "../seja.js";
import { navigiraj } from "../usmerjanje.js";
import { Ikona } from "../ui.js";

/** tip "club" | "event"; id = id cilja; klubId = klub, ki ga cilj pripada (za skritje pri lastnih). */
export function PrijaviGumb({ tip, id, klubId }) {
  const { prijavljen, me } = useSeja(s => s);
  const [modul, setModul] = useState(null);
  const [odprt, setOdprt] = useState(false);
  const [napaka, setNapaka] = useState(false);

  const moj = !!(me && Array.isArray(me.clubs) && me.clubs.some(c => Number(c.club_id) === Number(klubId)));
  if (moj) return null;

  function klik() {
    if (!prijavljen) { navigiraj(`/app/login?next=${encodeURIComponent(location.pathname)}`); return; }
    setNapaka(false); setOdprt(true);
    if (!modul) import("./zloraba.js").then(m => setModul({ m })).catch(() => { setOdprt(false); setNapaka(true); });
  }

  return html`<div class="prijavi-vrstica">
    <button type="button" class="povezava-gumb prijavi-gumb" onClick=${klik}><${Ikona} ime="flag" velikost=${15} /> ${t("Report")}</button>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${t("This screen could not be loaded. Please try again.")}</p>` : null}
    ${odprt && modul ? html`<${modul.m.PrijavaList} odprt=${true} zapri=${() => setOdprt(false)} tip=${tip} id=${id} />` : null}
  </div>`;
}
