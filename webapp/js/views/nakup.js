/* Nakup vstopnic (BuyTicketsView.swift). Testni nacin: dokler Stripe ni vklopljen, je narocilo
   takoj placano in nic se ne zaracuna. Brez vprasanja pred placilom (Martin, 23. 9.).
   Kartice NIKOLI ne vnasamo v nas vmesnik (Stripe Checkout, ko pride). */
import { html, useEffect, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { denar, jeRazprodan, preostanek, danInUra } from "../oblika.js";
import { List, Ikona } from "../ui.js";
import { KodaQR } from "../qr.js";

export function NakupList({ odprt, zapri, dogodek: e, imeKluba }) {
  const [kolicina, setKolicina] = useState(1);
  const [posiljam, setPosiljam] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [nakup, setNakup] = useState(null);
  useEffect(() => { if (odprt) { setKolicina(1); setNapaka(""); setNakup(null); } }, [odprt]);
  if (!odprt) return null;

  const cenaEna = e.ticket_price_cents || 0;
  const brezplacno = cenaEna === 0;
  const ostane = preostanek(e);
  const najvec = Math.max(1, Math.min(10, ostane == null ? 10 : ostane));
  const skupaj = cenaEna * kolicina;
  const razprodano = jeRazprodan(e) || ostane === 0;

  async function kupi() {
    setPosiljam(true); setNapaka("");
    try {
      const r = await send(`/events/${e.id}/orders`, { method: "POST", body: { quantity: kolicina }, auth: true });
      setNakup(r);
    } catch (err) { setNapaka(sporocilo(err)); }
    setPosiljam(false);
  }

  if (nakup) {
    const vst = (nakup.tickets || []).filter(v => v.qr);
    return html`<${List} odprt=${true} zapri=${zapri} naslov=${t("Your tickets")}>
      <div class="uspeh">
        <span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("You're in!")}</strong>
        <span>${t("Order {ref}", { ref: nakup.order && nakup.order.public_ref })} · ${tn("1 ticket", "{n} tickets", (nakup.tickets || []).length)}</span>
        ${nakup.mode === "test" ? html`<span class="opomba">${t("Test purchase — nothing was charged")}</span>` : null}
      </div>
      <div class="vstopnice-seznam">
        ${vst.map((v, i) => html`<div class="vstopnica" key=${v.id}>
          <div class="vstopnica-glava"><span class="nadnapis">${imeKluba.toUpperCase()}</span><span class="nadnapis">${t("{i} OF {n}", { i: i + 1, n: vst.length })}</span></div>
          <strong>${e.title}</strong>
          <${KodaQR} vsebina=${v.qr} velikost=${200} oznaka=${t("Ticket QR code")} />
          <span class="utisano">${t("TICKET")} ${String(v.serial || "").slice(0, 8).toUpperCase()}</span>
        </div>`)}
      </div>
      <p class="opomba srednje">${t("Saved under Profile → Tickets. Show the QR code at the door.")}</p>
      <a class="gumb-glavni" href="/app/tickets">${t("Open my tickets")}</a>
    <//>`;
  }

  return html`<${List} odprt=${true} zapri=${zapri} naslov=${t("Checkout")}>
    <div class="nakup-dogodek">
      <span class="nadnapis">${(imeKluba || "").toUpperCase()}</span>
      <strong>${e.title}</strong>
      <span class="utisano">${danInUra(e._zacetek)}</span>
      ${e.min_age > 0 ? html`<span class="utisano">${t("{n}+ · ID at the door", { n: e.min_age })}</span>` : null}
    </div>

    <div class="nakup-vrsta">
      <div><strong>${brezplacno ? t("Free") : denar(cenaEna, e.currency)}</strong><span class="utisano"> ${t("per ticket")}</span></div>
      <div class="stevec" role="group" aria-label=${t("Number of tickets")}>
        <button type="button" onClick=${() => setKolicina(k => Math.max(1, k - 1))} disabled=${kolicina <= 1} aria-label=${t("Fewer")}>−</button>
        <output aria-live="polite">${kolicina}</output>
        <button type="button" onClick=${() => setKolicina(k => Math.min(najvec, k + 1))} disabled=${kolicina >= najvec} aria-label=${t("More")}>+</button>
      </div>
    </div>

    <div class="nakup-skupaj">
      <span>${t("Total")}<small class="utisano"> · ${t("Prices include VAT")}</small></span>
      <strong>${brezplacno ? t("Free") : denar(skupaj, e.currency)}</strong>
    </div>

    <p class="opomba">${t("Test mode — nothing is charged")}</p>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}

    <button type="button" class="gumb-glavni" onClick=${kupi} disabled=${posiljam || razprodano}>
      ${razprodano ? t("Sold out") : posiljam ? t("Processing...")
        : brezplacno ? (kolicina === 1 ? t("Get ticket") : t("Get tickets"))
        : t("Pay {amount}", { amount: denar(skupaj, e.currency) })}
    </button>
    <p class="opomba">${t("Tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12). The seller is the club; Outly is the intermediary.")}</p>
  <//>`;
}
