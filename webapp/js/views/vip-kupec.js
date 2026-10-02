/* VIP mize za kupca (zaslon dogodka): tloris, izbira mize, izbira bottle paketa, nakup mize.
   GET /events/:id/vip (javno), POST /events/:id/tables/:tableId/orders (zeton). Testni nacin kot pri vstopnicah:
   narocilo je takoj placano, nic se ne zaracuna. Kupec dobi toliko VIP vstopnic, kolikor ima miza sedezev; razdeli
   jih prijateljem z obstojecim prenosom (Profile -> Tickets). Ta modul se nalozi leno (event.js), ko dogodek ponuja VIP. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send, pocistiPredpomnilnik } from "../api.js";
import { sporocilo, jeNakupZaseden, nakupPocakajS, nakupZasedenoSporocilo } from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import { denar, danInUra } from "../oblika.js";
import { List, Ikona, Nalaganje, Napaka, useZaklep } from "../ui.js";
import {
  C, doOseb, normalizirajTloris, normalizirajMize, normalizirajPakete, useSirina,
  TlorisPlatno, ElementTlorisa, OblikaMize, LegendaMiz, VipVrstica
} from "../vip.js";

/** Tloris za kupca: dotik proste mize jo izbere; prodane so zatemnjene ("Booked"). */
function TlorisKupec({ plan, mize, valuta, izbrana, ob }) {
  const ref = useRef(null);
  const sirina = useSirina(ref);
  const merilo = sirina ? sirina / (plan.width * C) : 1;
  const najmanj = 44 / merilo;   // tarca za dotik vsaj 44 px (majhna miza dobi vecje nevidno zadetno obmocje)
  return html`<${TlorisPlatno} plan=${plan} svgRef=${ref} oznaka=${t("Floor plan")}>
    ${plan.elements.map((e, i) => html`<${ElementTlorisa} key=${"e" + i} e=${e} />`)}
    ${mize.map(m => {   // stalen vrstni red v DOM-u: premik izbrane mize bi izgubil fokus tipkovnice
      const prosta = m.available !== false;
      const stanje = !prosta ? "prodana" : m.id === izbrana ? "izbrana" : "prosta";
      const sir = m.w * C, vis = m.h * C;
      const zw = Math.max(sir, najmanj), zh = Math.max(vis, najmanj);
      const opis = `${t("Table")} ${m.label}, ${doOseb(m.seats)}, ${denar(m.price_cents, valuta)}, `
        + (!prosta ? t("Booked") : stanje === "izbrana" ? t("Selected") : t("Available"));
      const izberi = () => { if (prosta) ob(m); };
      return html`<g key=${m.id} class=${"tl-miza " + stanje} role="button" aria-label=${opis} aria-pressed=${stanje === "izbrana"}
        aria-disabled=${prosta ? null : "true"} tabindex=${prosta ? 0 : -1}
        onClick=${izberi} onKeyDown=${ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); izberi(); } }}>
        <rect class="tl-zadetek" x=${m.x * C + sir / 2 - zw / 2} y=${m.y * C + vis / 2 - zh / 2} width=${zw} height=${zh} />
        <${OblikaMize} m=${m} napis2=${prosta ? "" : t("Booked")} />
      </g>`;
    })}
  <//>`;
}

export function VipList({ odprt, zapri, dogodek: e, imeKluba, klub, prijavljen, predizbor }) {
  const [s, setS] = useState({ nalaga: true, napaka: "", d: null });
  const [mizaId, setMizaId] = useState(null);
  const [paketId, setPaketId] = useState(null);
  const [posiljam, setPosiljam] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [nakup, setNakup] = useState(null);
  const tece = useRef(false);   // zascita pred dvojnim klikom (stanje se posodobi prepozno)
  const [zaklenjeno, zakleni] = useZaklep();   // po 503 (semafor nakupov) je gumb nekaj sekund onemogocen

  /** Tloris + mize + paketi. tiho = brez vrtavke (osvezitev po 409: kupec ostane na istem mestu). */
  async function nalozi(tiho, izbor) {
    if (!tiho) setS({ nalaga: true, napaka: "", d: null });
    try {
      const r = await send(`/events/${e.id}/vip`, { auth: "optional" });
      const d = {
        enabled: !!(r && r.enabled), onSale: !!(r && r.on_sale), valuta: (r && r.currency) || e.currency || "EUR",
        plan: normalizirajTloris(r && r.plan), mize: normalizirajMize(r && r.tables), paketi: normalizirajPakete(r && r.packages)
      };
      setS({ nalaga: false, napaka: "", d });
      // Izbira (tudi po vrnitvi s prijave): miza mora se obstajati in biti prosta; en sam paket se izbere sam.
      const miza = d.mize.find(m => m.id === (izbor ? izbor.miza : null) && m.available !== false);
      setMizaId(miza ? miza.id : null);
      const paket = d.paketi.find(p => p.id === (izbor ? izbor.paket : null));
      setPaketId(paket ? paket.id : d.paketi.length === 1 ? d.paketi[0].id : null);
    } catch (err) {
      if (tiho) return;
      setS({ nalaga: false, napaka: sporocilo(err), d: null });
    }
  }
  useEffect(() => {
    if (!odprt) return;
    setNapaka(""); setNakup(null); setPosiljam(false);
    nalozi(false, predizbor || null);
  }, [odprt]);
  if (!odprt) return null;

  const d = s.d;
  const miza = d && d.mize.find(m => m.id === mizaId);
  const paket = d && d.paketi.find(p => p.id === paketId);
  const imaPakete = !!d && d.paketi.length > 0;

  async function rezerviraj() {
    if (!miza || tece.current) return;
    if (!prijavljen) {
      // Prijava in nazaj na isti dogodek (kot pri nakupu vstopnic); izbira mize in paketa se ohrani.
      const nazajNa = `/app/event/${e.id}?vip=1&table=${miza.id}` + (paketId ? `&pkg=${paketId}` : "");
      navigiraj(`/app/login?next=${encodeURIComponent(nazajNa)}`);
      return;
    }
    if (imaPakete && !paket) return setNapaka(t("Choose your bottle"));
    tece.current = true;
    setPosiljam(true); setNapaka("");
    try {
      const r = await send(`/events/${e.id}/tables/${miza.id}/orders`, {
        method: "POST", body: paket ? { package_id: paket.id, expected_price_cents: miza.price_cents } : { expected_price_cents: miza.price_cents }, auth: true
      });
      pocistiPredpomnilnik();
      setNakup(r);
    } catch (err) {
      if (err && err.status === 409) { nalozi(true); setMizaId(null); }   // zasedeno ali prodaja zaprta: osvezi tloris
      // Streznik je zaseden (503): sporocilo + kratek premor. Nakupa NE ponavljamo sami (ni idempotentnega kljuca).
      if (jeNakupZaseden(err)) { zakleni(nakupPocakajS(err)); setNapaka(nakupZasedenoSporocilo()); }
      // Brez odgovora: narocilo je morda nastalo - preden kupi znova, naj pogleda vstopnice.
      else setNapaka(err && err.status === -1 ? t("No response from the server. Check Profile → Tickets before you try again.") : sporocilo(err));
    }
    tece.current = false;
    setPosiljam(false);
  }

  /* ---- potrditev ---- */
  if (nakup) {
    const o = nakup.order || {};
    const vst = Array.isArray(nakup.tickets) ? nakup.tickets : [];
    const stevilo = vst.length || o.table_seats || (miza && miza.seats) || 0;
    return html`<${List} odprt=${true} zapri=${zapri} naslov=${t("VIP tables")}>
      <div class="uspeh">
        <span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("Your VIP table is booked")}</strong>
        <${VipVrstica} v=${{ is_vip: true, table_label: o.table_label || (miza && miza.label), package_name: o.package_name || (paket && paket.name) }} velika=${true} />
        <span>${t("Order {ref}", { ref: o.public_ref || "" })} · ${tn("1 VIP ticket", "{n} VIP tickets", stevilo)}</span>
        ${nakup.mode === "test" ? html`<span class="opomba">${t("Test purchase — nothing was charged")}</span>` : null}
      </div>
      <p class="opomba srednje">${t("Send the VIP tickets to your friends from Tickets.")}</p>
      <a class="gumb-glavni" href="/app/tickets">${t("Open my tickets")}</a>
    <//>`;
  }

  const imaMize = d && d.enabled && d.mize.length > 0;
  return html`<${List} odprt=${true} zapri=${zapri} naslov=${t("VIP tables")}>
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    ${s.napaka ? html`<${Napaka} besedilo=${s.napaka} znova=${() => nalozi(false, null)} />` : null}
    ${d && !imaMize ? html`<div class="prazno"><${Ikona} ime="crown" velikost=${34} razred="modra" />
      <strong>${t("No VIP tables available")}</strong>
      ${klub && klub.contact_phone ? html`<span>${t("Until then, call the club to reserve a table.")}</span>
        <a class="gumb-siv" href=${"tel:" + klub.contact_phone.replace(/[^\d+]/g, "")}>${klub.contact_phone}</a>` : null}
    </div>` : null}
    ${imaMize ? html`
      <div class="nakup-dogodek">
        <span class="nadnapis">${(imeKluba || "").toUpperCase()}</span>
        <strong>${e.title}</strong>
        <span class="utisano">${danInUra(e._zacetek)}</span>
      </div>
      ${!d.onSale ? html`<p class="opomba oranzna" role="status">${t("Table reservations are closed for this event.")}</p>` : null}
      ${d.plan
        ? html`<${TlorisKupec} plan=${d.plan} mize=${d.mize} valuta=${d.valuta} izbrana=${mizaId} ob=${m => { setMizaId(m.id); setNapaka(""); }} />`
        : html`<div class="mreza-cipov" role="group" aria-label=${t("VIP tables")}>${d.mize.map(m => html`<button type="button" key=${m.id}
            class=${"cip" + (m.id === mizaId ? " izbran" : "")} disabled=${m.available === false} aria-pressed=${m.id === mizaId}
            onClick=${() => setMizaId(m.id)}>${m.label}</button>`)}</div>`}
      <${LegendaMiz} />
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      ${miza ? html`<div class="vip-kartica-mize">
        <div class="vip-miza-glava">
          <div class="kv-besedilo"><strong>${t("Table")} ${miza.label}</strong><span>${doOseb(miza.seats)}</span></div>
          <strong class="vip-cena">${denar(miza.price_cents, d.valuta)}</strong>
        </div>
        ${imaPakete ? html`<div class="vip-paketi" role="radiogroup" aria-label=${t("Choose your bottle")}>
          <h3 class="nastavitev-naslov">${t("Choose your bottle")}</h3>
          ${d.paketi.map(p => html`<label class=${"vip-paket" + (p.id === paketId ? " izbran" : "")} key=${p.id}>
            <input type="radio" name="vip-paket" checked=${p.id === paketId} onChange=${() => setPaketId(p.id)} />
            <span class="vip-radio" aria-hidden="true"></span>
            <span class="kv-besedilo"><strong>${p.name}</strong>${p.description ? html`<span>${p.description}</span>` : null}</span>
          </label>`)}
          <span class="opomba">${t("Included in the table price")}</span>
        </div>` : null}
      </div>` : html`<p class="opomba srednje">${t("Tap a free table to reserve it.")}</p>`}
      ${miza ? html`<div class="vip-pas-nakupa">
        <p class="opomba">${t("Test mode — nothing is charged")}</p>
        <button type="button" class="gumb-glavni" onClick=${rezerviraj} disabled=${posiljam || zaklenjeno || !d.onSale || (imaPakete && !paket)}>
          ${posiljam ? t("Processing...") : t("Reserve table") + " · " + denar(miza.price_cents, d.valuta)}</button>
      </div>` : null}` : null}
  <//>`;
}
