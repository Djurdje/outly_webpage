/* Moje vstopnice (TicketsView.swift): prihajajoce s QR kodo, pretekle in uporabljene zlozene.
   QR je podpisan niz iz backenda; po prenosu vstopnice stara koda ne velja vec (I7). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { danInUra } from "../oblika.js";
import { GlavaNazaj, Nalaganje, Napaka, Ikona, Slika } from "../ui.js";
import { KodaQR } from "../qr.js";

export function Vstopnice() {
  const [s, setS] = useState({ nalaga: true, napaka: null, vst: [] });
  const [odprta, setOdprta] = useState(null);
  const [pokaziStare, setPokaziStare] = useState(false);
  const nalozi = async () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    try {
      const r = await send("/me/tickets", { auth: true });
      setS({ nalaga: false, napaka: null, vst: (Array.isArray(r) ? r : []).map(v => ({ ...v, _zacetek: v.start_at ? new Date(v.start_at) : null })) });
    } catch (e) { setS(x => ({ ...x, nalaga: false, napaka: sporocilo(e) })); }
  };
  useEffect(() => { nalozi(); }, []);

  const zdaj = Date.now() - 8 * 3600e3;   // dogodek brez konca velja se 8 h po zacetku (kot backend)
  const prihajajoce = s.vst.filter(v => v.status === "valid" && v._zacetek && v._zacetek.getTime() >= zdaj);
  const stare = s.vst.filter(v => !prihajajoce.includes(v));

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Tickets")} rezerva="/app/profile" />
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !s.napaka && !s.vst.length ? html`<div class="prazno">
      <${Ikona} ime="ticket" velikost=${34} razred="modra" />
      <strong>${t("No tickets yet")}</strong><span>${t("Tickets you buy on Outly will show up here.")}</span>
      <a class="gumb-siv" href="/app/events">${t("See all events")}</a>
    </div>` : null}
    <div class="vstopnice-seznam">
      ${prihajajoce.map(v => html`<${Karta} key=${v.id} v=${v} odprta=${odprta === v.id || prihajajoce.length === 1} preklopi=${() => setOdprta(odprta === v.id ? null : v.id)} />`)}
    </div>
    ${stare.length ? html`<button type="button" class="kartica-vrstica" onClick=${() => setPokaziStare(!pokaziStare)} aria-expanded=${pokaziStare}>
      <span class="kv-besedilo"><strong>${t("Past and used")}</strong><span>${stare.length}</span></span>
      <${Ikona} ime=${pokaziStare ? "chevron-down" : "chevron-right"} velikost=${16} razred="utisano" />
    </button>` : null}
    ${pokaziStare ? html`<div class="vstopnice-seznam">${stare.map(v => html`<${Karta} key=${v.id} v=${v} odprta=${false} stara=${true} />`)}</div>` : null}
  </div>`;
}

function Karta({ v, odprta, preklopi, stara }) {
  const uporabljena = v.status === "used";
  const stanje = uporabljena ? t("ALREADY USED") : v.status === "valid" ? (stara ? t("ENDED") : "") : v.status.toUpperCase();
  return html`<div class=${"vstopnica" + (stara ? " stara" : "")}>
    <button type="button" class="vstopnica-glava-gumb" onClick=${preklopi} disabled=${stara} aria-expanded=${odprta}>
      <span class="vd-slika"><${Slika} src=${v.poster_url} sirina=${150} alt="" /></span>
      <span class="kv-besedilo"><span class="nadnapis">${(v.club_name || "").toUpperCase()}</span><strong>${v.event_title}</strong>
        <span>${danInUra(v._zacetek)}</span></span>
      ${stanje ? html`<span class="cip-plan">${stanje}</span>` : null}
    </button>
    ${odprta && !stara ? html`<div class="vstopnica-qr">
      <${KodaQR} vsebina=${v.qr} velikost=${220} oznaka=${t("Ticket QR code")} />
      <div class="vstopnica-polja">
        <span><small>${t("ORDER")}</small>${v.public_ref}</span>
        <span><small>${t("TICKET")}</small>${String(v.serial || "").slice(0, 8).toUpperCase()}</span>
        ${v.min_age > 0 ? html`<span><small>${t("AGE")}</small>${v.min_age}+</span>` : null}
      </div>
      <p class="opomba srednje">${t("Show this QR code at the door. Turn your screen brightness up.")}</p>
    </div>` : null}
  </div>`;
}
