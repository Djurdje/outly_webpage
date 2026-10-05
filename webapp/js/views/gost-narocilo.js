/* Vstopnice, kupljene brez racuna (/app/guest/order): kupec pride iz maila ali iz Stripove vrnitve (?t=<guest_token>).
   Zeton se takoj shrani in odstrani iz naslovne vrstice (gost.js); vstopnice pridejo iz GET /guest/order (glava
   X-Guest-Token, brez prijave). Placilo se potrjuje (pending) nekaj sekund: stran se osvezi 5x na 2 s.
   QR kot pri prijavljenih (QrTelo iz vstopnice.js); prenosa vstopnice za goste ni. */
import { html, useEffect, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send } from "../api.js";
import { ApiError, sporocilo } from "../napake.js";
import { danInUra } from "../oblika.js";
import { GlavaNazaj, Nalaganje, Napaka, Ikona, Slika } from "../ui.js";
import { prevzemiZetonIzUrl, preberiGostZeton, pozabiGostZeton } from "../gost.js";
import { QrTelo } from "./vstopnice.js";

const OSVEZITEV_MS = 2000, OSVEZITEV_STEVILO = 5;

export function GostNarocilo() {
  // Zeton iz URL-ja (in takoj iz naslovne vrstice) ali iz seje brskalnika (osvezitev strani).
  const [zeton] = useState(() => prevzemiZetonIzUrl() || (preberiGostZeton() || {}).t || null);
  const [test] = useState(() => { const p = preberiGostZeton(); return !!(p && p.test); });
  const [s, setS] = useState({ stanje: zeton ? "nalaga" : "brez", r: null, napaka: "", poteklo: false });
  const [poskus, setPoskus] = useState(0);

  useEffect(() => { document.title = t("Your tickets") + " · Outly"; }, []);
  useEffect(() => {
    if (!zeton) return undefined;
    let zivo = true, casovnik = null, krog = 0;
    setS(x => ({ ...x, napaka: "", poteklo: false, stanje: x.r ? x.stanje : "nalaga" }));
    const korak = async () => {
      let r;
      try { r = await send("/guest/order", { glave: { "X-Guest-Token": zeton } }); }
      catch (err) {
        if (!zivo) return;
        if (err instanceof ApiError && err.status === 404) { pozabiGostZeton(); setS({ stanje: "neveljavno", r: null, napaka: "", poteklo: false }); return; }
        setS(x => ({ ...x, stanje: x.r ? "ok" : "napaka", napaka: sporocilo(err) }));
        return;
      }
      if (!zivo) return;
      const caka = !!(r && r.order && r.order.status === "pending");
      const naprej = caka && krog < OSVEZITEV_STEVILO;
      if (naprej) { krog += 1; casovnik = setTimeout(korak, OSVEZITEV_MS); }
      setS({ stanje: "ok", r: r || null, napaka: "", poteklo: caka && !naprej });
    };
    korak();
    return () => { zivo = false; clearTimeout(casovnik); };
  }, [poskus]);

  const glava = html`<${GlavaNazaj} naslov=${t("Your tickets")} rezerva="/app" />`;
  if (s.stanje === "brez" || s.stanje === "neveljavno") {
    return html`<div class="zaslon">${glava}
      <div class="prazno">
        <${Ikona} ime="ticket" velikost=${34} razred="modra" />
        <strong>${s.stanje === "brez" ? t("We could not find your order") : t("This order link is not valid or has expired")}</strong>
        <span>${t("Open the link from your confirmation email to see your tickets.")}</span>
        <a class="gumb-siv" href="/app/events">${t("See all events")}</a>
      </div></div>`;
  }
  if (s.stanje === "nalaga") return html`<div class="zaslon">${glava}<${Nalaganje} /></div>`;
  if (s.stanje === "napaka") return html`<div class="zaslon">${glava}<${Napaka} besedilo=${s.napaka} znova=${() => setPoskus(p => p + 1)} /></div>`;

  const r = s.r || {}, o = r.order || {}, e = o.event || {};
  const vstopnice = (Array.isArray(r.tickets) ? r.tickets : []).filter(v => v && v.qr);
  const zacetek = e.start_at ? new Date(e.start_at) : null;
  const ref = o.public_ref || (vstopnice[0] && vstopnice[0].public_ref) || "";
  const klub = (e.club_name || "").toUpperCase();
  const dogodek = html`${e.id != null ? html`<a class="kartica-vrstica" href=${"/app/event/" + e.id}>
      ${e.poster_url ? html`<span class="vd-slika"><${Slika} src=${e.poster_url} sirina=${150} alt="" /></span>` : null}
      <span class="kv-besedilo"><span class="nadnapis">${klub}</span><strong>${e.title}</strong><span>${danInUra(zacetek)}</span></span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>` : null}`;

  if (o.status === "pending") {
    return html`<div class="zaslon">${glava}
      <div class="prazno" role="status">
        ${s.poteklo ? html`<${Ikona} ime="clock" velikost=${34} razred="modra" />` : html`<div class="nalaganje"><span class="vrtavka"></span></div>`}
        <strong>${s.poteklo ? t("We are still waiting for your payment") : t("Payment is being confirmed…")}</strong>
        <span>${s.poteklo ? t("Your tickets will be emailed to you as soon as the payment is confirmed.") : t("This usually takes a few seconds.")}</span>
        ${s.poteklo ? html`<button type="button" class="gumb-siv" onClick=${() => setPoskus(p => p + 1)}>${t("Check again")}</button>` : null}
      </div>
      ${dogodek}
    </div>`;
  }

  const placano = o.status === "paid";
  return html`<div class="zaslon">${glava}
    <div class="uspeh">
      ${placano ? html`<span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span><strong>${t("You're in!")}</strong>`
        : html`<strong>${t("Order status: {status}", { status: String(o.status || "").toUpperCase() })}</strong>`}
      <span>${ref ? t("Order {ref}", { ref }) + " · " : ""}${tn("1 ticket", "{n} tickets", vstopnice.length || Number(o.quantity) || 0)}</span>
      ${test && placano ? html`<span class="opomba">${t("Test purchase — nothing was charged")}</span>` : null}
    </div>
    ${dogodek}
    ${vstopnice.length ? html`<p class="opomba-okvir" role="note"><${Ikona} ime="camera" velikost=${18} />${t("Screenshot your QR code in case you have no signal at the door.")}</p>` : null}
    <div class="vstopnice-seznam">
      ${vstopnice.map((v, i) => html`<div class="vstopnica" key=${v.id}>
        <div class="vstopnica-glava"><span class="nadnapis">${klub}</span><span class="nadnapis">${t("{i} OF {n}", { i: i + 1, n: vstopnice.length })}</span></div>
        <strong>${e.title}</strong>
        ${v.status === "valid"
          ? html`<${QrTelo} v=${{ ...v, public_ref: v.public_ref || ref, min_age: v.min_age ?? e.min_age }} />`
          : html`<span class="cip-plan">${v.status === "used" ? t("ALREADY USED") : String(v.status || "").toUpperCase()}</span>`}
      </div>`)}
    </div>
    <div class="gost-racun">
      <strong>${t("Create an account to keep your tickets in the app")}</strong>
      <a class="gumb-siv" href="/app/register">${t("Create an account")}</a>
    </div>
  </div>`;
}
