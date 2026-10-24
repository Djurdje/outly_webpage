/* Rezervacija VIP mize za placilo z gotovino na VIP vratih (dogodek z vip_payment = "door"; pogodba backend 23. 10. 2026).
   Kupec mizo v aplikaciji samo REZERVIRA (brez placila in vstopnic), placa na vratih.
   - POST /events/:id/tables/:tableId/reservations { package_id, guest_name?, expected_price_cents } -> 201 { reservation }
   - DELETE /events/:id/tables/:tableId/reservations (svoja rezervacija, do zacetka dogodka)
   - GET /me/table-reservations -> { items: [Reservation] } (razdelek »Table reservations« v Tickets).
   Ime za rezervacijo in imena paketov so prosto besedilo: v DOM samo kot besedilo htm predloge. */
import { html, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo, ApiError } from "../napake.js";
import { denar, danInUra } from "../oblika.js";
import { Ikona } from "../ui.js";
import { doOseb } from "../vip.js";

const celo = (v, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };
const niz = v => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Reservation iz API-ja z privzetki (manjkajoce polje ne podre strani). */
export function normalizirajRezervacijo(r) {
  if (!r || typeof r !== "object") return null;
  const zacetek = r.event_start_at ? new Date(r.event_start_at) : null;
  return {
    id: celo(r.id), event_id: celo(r.event_id), event_title: niz(r.event_title), _zacetek: zacetek && !Number.isNaN(zacetek.getTime()) ? zacetek : null,
    club_id: r.club_id == null ? null : celo(r.club_id), club_name: niz(r.club_name),
    table_id: celo(r.table_id), table_label: niz(r.table_label), seats: celo(r.seats, 0),
    package_id: r.package_id == null ? null : celo(r.package_id), package_name: niz(r.package_name), package_description: niz(r.package_description),
    price_cents: celo(r.price_cents, 0), currency: niz(r.currency) || "EUR", guest_name: niz(r.guest_name), poster_url: niz(r.poster_url)
  };
}

export const rezervirajMizo = (dogodek, miza, telo) =>
  send(`/events/${dogodek}/tables/${miza}/reservations`, { method: "POST", body: telo, auth: true });
export const odpovejRezervacijo = r =>
  send(`/events/${r.event_id}/tables/${r.table_id}/reservations`, { method: "DELETE", auth: true });

export const placiloNaVratih = r => t("Pay {price} in cash at the VIP door", { price: denar(r.price_cents, r.currency) });

/** Podrobnosti rezervacije: miza, sedezi, paket, jasno »Pay X in cash at the VIP door«. */
export function PodrobnostiRezervacije({ r }) {
  return html`<div class="rez-podrobnosti">
    <span class="rez-miza">${t("Table")} ${r.table_label}</span>
    <span class="utisano">${doOseb(r.seats)}</span>
    ${r.package_name ? html`<span class="rez-paket">${r.package_name}</span>` : null}
    ${r.guest_name ? html`<span class="utisano">${t("Name: {name}", { name: r.guest_name })}</span>` : null}
    <strong class="rez-placilo"><${Ikona} ime="info" velikost=${16} /> ${placiloNaVratih(r)}</strong>
  </div>`;
}

/** »Cancel reservation« z vprasanjem. Dokoncano (tudi ce je rezervacije ze ni: 404) poklice `odpovedano`. */
export function OdpovedRezervacije({ r, odpovedano }) {
  const [potrdi, setPotrdi] = useState(false);
  const [tece, setTece] = useState(false);
  const [napaka, setNapaka] = useState("");
  async function odpovej() {
    if (tece) return;
    setTece(true); setNapaka("");
    try { await odpovejRezervacijo(r); odpovedano(); return; }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) { odpovedano(); return; }   // rezervacije ze ni
      setNapaka(sporocilo(e)); setPotrdi(false);
    }
    setTece(false);
  }
  return html`<div class="rez-odpoved">
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${potrdi ? html`<p class="besedilo-opis">${t("Cancel this reservation? The table becomes available to others.")}</p>
      <button type="button" class="gumb-rdec" onClick=${odpovej} disabled=${tece}>${tece ? t("Saving...") : t("Yes, cancel reservation")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setPotrdi(false)} disabled=${tece}>${t("Keep it")}</button>`
      : html`<button type="button" class="gumb-siv" onClick=${() => setPotrdi(true)}>${t("Cancel reservation")}</button>`}
  </div>`;
}

/** Kartica rezervacije v Tickets: dogodek, miza, »pay at the door«, Cancel (do zacetka dogodka). */
export function KarticaRezervacije({ r, odpovedano }) {
  const prihajajoca = !!r._zacetek && r._zacetek.getTime() > Date.now();
  return html`<div class="vstopnica vip rez-kartica">
    <a class="rez-glava" href=${"/app/event/" + r.event_id}>
      <span class="kv-besedilo"><span class="nadnapis">${r.club_name.toUpperCase()}</span><strong>${r.event_title}</strong>
        <span>${danInUra(r._zacetek)}</span></span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>
    <${PodrobnostiRezervacije} r=${r} />
    ${prihajajoca ? html`<${OdpovedRezervacije} r=${r} odpovedano=${odpovedano} />` : null}
  </div>`;
}

export const stevilkaRezervacij = n => tn("1 reservation", "{n} reservations", n);
