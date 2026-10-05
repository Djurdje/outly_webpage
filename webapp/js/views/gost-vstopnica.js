/* Vstopnica, ki jo je prijatelj brez Outly racuna prejel po e-naslovu (/app/guest/ticket#t=<zeton> iz maila).
   Zeton se ob uvozu gost.js shrani v sessionStorage (svoj kljuc, locen od zetona narocila) in odstrani iz naslovne vrstice;
   vstopnica pride iz GET /guest/ticket (glava X-Guest-Token, brez prijave; zeton NIKJER v URL-ju zahtevka).
   QR kot pri prijavljenih (QrTelo iz vstopnice.js); prenosa vstopnice naprej ni. Vsak neveljaven zeton (napacen, potekel,
   prevzet v racun, ponovno prenesen) je 404 in dobi enako nevtralno sporocilo - ne razkrivamo, kaj se je zgodilo. */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { ApiError, sporocilo } from "../napake.js";
import { danInUra } from "../oblika.js";
import { GlavaNazaj, Nalaganje, Napaka, Ikona, Slika } from "../ui.js";
import { useSeja } from "../seja.js";
import { prevzemiZetonIzUrl, preberiVstopnicaZeton, pozabiVstopnicaZeton, shraniVstopnicaZeton } from "../gost.js";
import { QrTelo } from "./vstopnice.js";

export function GostVstopnica() {
  // Zeton iz URL-ja (in takoj iz naslovne vrstice) ali iz seje brskalnika (osvezitev strani).
  const [zeton] = useState(() => prevzemiZetonIzUrl(shraniVstopnicaZeton) || (preberiVstopnicaZeton() || {}).t || null);
  const prijavljen = useSeja(x => x.prijavljen);
  const [s, setS] = useState({ stanje: zeton ? "nalaga" : "brez", r: null, napaka: "" });
  const [poskus, setPoskus] = useState(0);

  useEffect(() => { document.title = t("Your ticket") + " · Outly"; }, []);
  useEffect(() => {
    if (!zeton) return undefined;
    let zivo = true;
    setS(x => ({ ...x, napaka: "", stanje: x.r ? x.stanje : "nalaga" }));
    send("/guest/ticket", { glave: { "X-Guest-Token": zeton } }).then(r => {
      if (zivo) setS({ stanje: "ok", r: r || {}, napaka: "" });
    }).catch(err => {
      if (!zivo) return;
      if (err instanceof ApiError && err.status === 404) { pozabiVstopnicaZeton(); setS({ stanje: "neveljavno", r: null, napaka: "" }); return; }
      setS(x => ({ ...x, stanje: x.r ? "ok" : "napaka", napaka: sporocilo(err) }));   // 503, 429, omrezje: "Try again"
    });
    return () => { zivo = false; };
  }, [poskus]);

  const glava = html`<${GlavaNazaj} naslov=${t("Your ticket")} rezerva="/app" />`;
  if (s.stanje === "neveljavno") {
    // 404 je tudi potekel, prevzet ali ponovno prenesen zeton: ne trdimo, kje je vstopnica.
    return html`<div class="zaslon">${glava}
      <div class="prazno">
        <${Ikona} ime="ticket" velikost=${34} razred="modra" />
        <strong>${t("This link is no longer valid")}</strong>
        ${prijavljen
          ? html`<span>${t("If this email has an Outly account, the ticket is in Tickets.")}</span>
            <a class="gumb-glavni" href="/app/tickets">${t("Open my tickets")}</a>`
          : html`<span>${t("If you have an Outly account with the email this ticket was sent to, sign in to find it under Tickets.")}</span>
            <a class="gumb-glavni" href="/app/login">${t("Sign in")}</a>`}
      </div></div>`;
  }
  if (s.stanje === "brez") {
    return html`<div class="zaslon">${glava}
      <div class="prazno">
        <${Ikona} ime="ticket" velikost=${34} razred="modra" />
        <strong>${t("We could not find your ticket")}</strong>
        <span>${t("Open the link from your ticket email to see your ticket.")}</span>
        <a class="gumb-siv" href="/app/events">${t("See all events")}</a>
      </div></div>`;
  }
  if (s.stanje === "nalaga") return html`<div class="zaslon">${glava}<${Nalaganje} /></div>`;
  if (s.stanje === "napaka") return html`<div class="zaslon">${glava}<${Napaka} besedilo=${s.napaka} znova=${() => setPoskus(p => p + 1)} /></div>`;

  const r = s.r || {}, v = r.ticket || {}, e = r.event || {};
  const naslov = e.title || v.event_title || "";
  const klub = (e.club_name || v.club_name || "").toUpperCase();
  const zacetek = e.start_at || v.start_at ? new Date(e.start_at || v.start_at) : null;
  const kraj = [e.address, e.city].map(x => (x || "").trim()).filter(Boolean).join(", ");
  const minStarost = Number(e.min_age ?? v.min_age) || 0;
  const veljavna = (v.status === "valid" || v.status === "paid") && !!v.qr;
  const uporabljena = v.status === "used";
  const dogodek = e.id != null ? html`<a class="kartica-vrstica" href=${"/app/event/" + e.id}>
      ${e.poster_url ? html`<span class="vd-slika"><${Slika} src=${e.poster_url} sirina=${150} alt="" /></span>` : null}
      <span class="kv-besedilo"><span class="nadnapis">${klub}</span><strong>${naslov}</strong>${zacetek ? html`<span>${danInUra(zacetek)}</span>` : null}${kraj ? html`<span>${kraj}</span>` : null}</span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>` : null;

  return html`<div class="zaslon">${glava}
    <${Napaka} besedilo=${s.napaka} znova=${() => setPoskus(p => p + 1)} />
    <div class="uspeh">
      ${veljavna ? html`<span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span><strong>${t("You have a ticket!")}</strong>`
        : html`<strong>${uporabljena ? t("This ticket was already used.") : t("This ticket is no longer valid.")}</strong>`}
    </div>
    ${dogodek}
    ${minStarost > 0 ? html`<p class="opomba-okvir" role="note"><${Ikona} ime="info" velikost=${18} />${t("{n}+ · ID at the door", { n: minStarost })}</p>` : null}
    ${veljavna ? html`<p class="opomba-okvir" role="note"><${Ikona} ime="camera" velikost=${18} />${t("Screenshot your QR code in case you have no signal at the door.")}</p>` : null}
    <div class="vstopnice-seznam">
      <div class="vstopnica">
        <div class="vstopnica-glava"><span class="nadnapis">${klub}</span></div>
        <strong>${naslov}</strong>
        ${veljavna
          ? html`<${QrTelo} v=${{ ...v, transferable: false, min_age: v.min_age ?? e.min_age }} />`
          : html`<span class="cip-plan">${uporabljena ? t("ALREADY USED") : String(v.status || "").toUpperCase()}</span>`}
      </div>
    </div>
    ${veljavna ? html`<p class="opomba srednje">${t("One entry per QR code: whoever shows it first gets in. Don't share this link or post the code.")}</p>` : null}
    ${prijavljen ? null : html`<div class="gost-racun">
      <strong>${t("Create an account to keep your ticket in the app")}</strong>
      <span class="utisano">${t("Use the same email the ticket was sent to.")}</span>
      <a class="gumb-siv" href="/app/register">${t("Create an account")}</a>
    </div>`}
  </div>`;
}
