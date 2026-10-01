/* VIP mize pri poslovnem dogodku. GET /business/events/:id/vip vidijo vse vloge (tudi vratar/bar mora videti,
   kaj pripraviti), PUT /business/events/:id/vip samo owner/manager (streznik uveljavi 403; vratar do obrazca
   dogodka sploh ne pride).
   - VipDogodka: razdelek v obrazcu dogodka - vklop prodaje mize, prepis cene ali izklop po mizi, seznam rezervacij.
   - RezervacijeVip: samo seznam rezervacij (zaslon vstopnic dogodka, ki je odprt vsem vlogam). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { sporocilo } from "../napake.js";
import { Ikona, Nalaganje, Napaka } from "../ui.js";
import { poslovno, centiIz, evriBesedilo } from "../posel.js";
import { normalizirajTloris, normalizirajMize, sporociloVip, doOseb } from "../vip.js";

const celo = (v, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };

function normaliziraj(r) {
  const mize = normalizirajMize(r && r.tables).map(m => {
    const b = m.booking && typeof m.booking === "object" ? m.booking : null;
    return {
      ...m,
      disabled: m.disabled === true,
      archived: m.archived === true,   // arhivirana miza z rezervacijo na tem dogodku: samo v seznamu rezervacij
      default_price_cents: celo(m.default_price_cents, m.price_cents),
      booking: b ? { ...b, guests: celo(b.guests, 0), checked_in: celo(b.checked_in, 0), buyer_username: String(b.buyer_username || "") } : null
    };
  });
  return { enabled: !!(r && r.enabled), valuta: (r && r.currency) || "EUR", plan: normalizirajTloris(r && r.plan), mize };
}

function useVip(klub, dogodek) {
  const [s, setS] = useState({ nalaga: true, napaka: null, d: null });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: !x.d, napaka: null }));
    return poslovno(klub, `/business/events/${dogodek}/vip`)
      .then(r => setS({ nalaga: false, napaka: null, d: normaliziraj(r) }))
      .catch(e => setS(x => ({ ...x, nalaga: false, napaka: e })));
  };
  useEffect(() => { if (klub && dogodek) nalozi(); }, [klub, dogodek]);
  return { ...s, nalozi, nastavi: r => setS({ nalaga: false, napaka: null, d: normaliziraj(r) }) };
}

/** Star backend (404) ali vloga brez pravice (403): razdelka ni - ne motimo. */
const brezPodpore = e => !!e && (e.status === 404 || e.status === 403);

/** Rezervacije: miza, kupec, paket, prisli X/N. */
function SeznamRezervacij({ mize }) {
  const rez = mize.filter(m => m.booking);
  if (!rez.length) return html`<p class="opomba srednje">${t("No reservations yet")}</p>`;
  return html`<div class="vip-rezervacije">${rez.map(m => html`<div class="vip-rez" key=${m.id}>
    <span class="vip-rez-miza">${m.label}</span>
    <span class="kv-besedilo"><strong>${m.booking.buyer_username || "-"}</strong>
      <span>${m.booking.package_name || t("Table")} ${m.booking.public_ref ? "· " + m.booking.public_ref : ""}</span></span>
    <span class="vip-rez-vstop"><strong>${m.booking.checked_in}/${m.booking.guests || m.seats}</strong><small>${t("Checked in")}</small></span>
  </div>`)}</div>`;
}

/** Samo rezervacije (zaslon vstopnic dogodka, vse vloge). Skrito, dokler dogodek nima VIP miz ali rezervacij.
    osvezi: stevec, ki ga starsi poveca, ko se stanje vstopov spremeni (prisli X/N). */
export function RezervacijeVip({ klub, dogodek, osvezi = 0 }) {
  const v = useVip(klub, dogodek);
  useEffect(() => { if (osvezi) v.nalozi(); }, [osvezi]);   // npr. po rocnem vstopu na istem zaslonu
  if (v.napaka) return brezPodpore(v.napaka) ? null : html`<${Napaka} besedilo=${sporocilo(v.napaka)} znova=${v.nalozi} />`;
  if (!v.d) return null;
  if (!v.d.enabled && !v.d.mize.some(m => m.booking)) return null;
  return html`<section class="vip-razdelek">
    <h2 class="podnaslov">${t("VIP reservations")}</h2>
    <${SeznamRezervacij} mize=${v.d.mize} />
  </section>`;
}

/** Razdelek "VIP tables" v obrazcu dogodka (owner/manager). Ima svoj gumb Save (loceno od obrazca dogodka). */
export function VipDogodka({ klub, dogodek }) {
  const v = useVip(klub, dogodek);
  const [vklop, setVklop] = useState(false);
  const [cene, setCene] = useState({});
  const [izklopljene, setIzklopljene] = useState(new Set());
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [shranjeno, setShranjeno] = useState(false);
  const d = v.d;
  const baza = `/app/business/${klub}`;
  const aktivne = d ? d.mize.filter(m => !m.archived) : [];   // arhiviranih ne urejamo in ne posiljamo v PUT

  // Obrazec se napolni iz odgovora streznika (ob nalaganju in po shranjevanju).
  useEffect(() => {
    if (!d) return;
    setVklop(d.enabled);
    setCene(Object.fromEntries(d.mize.map(m => [m.id, evriBesedilo(m.price_cents).replace(/\.00$/, "")])));
    setIzklopljene(new Set(d.mize.filter(m => m.disabled).map(m => m.id)));
  }, [d]);

  if (v.napaka && brezPodpore(v.napaka)) return null;
  const naslov = html`<legend>${t("VIP tables")}</legend>`;
  if (v.napaka) return html`<fieldset>${naslov}<${Napaka} besedilo=${sporocilo(v.napaka)} znova=${v.nalozi} /></fieldset>`;
  if (!d) return html`<fieldset>${naslov}<${Nalaganje} /></fieldset>`;

  async function shrani() {
    setNapaka(""); setShranjeno(false);
    const tables = [];
    for (const m of aktivne) {
      const c = centiIz(cene[m.id], 100000);
      if (c === undefined) { return setNapaka(t("Enter the price as a number, e.g. 12.50.")); }
      // Prazno ali enako privzeti = privzeta cena (izjema se pobrise).
      tables.push({ table_id: m.id, price_cents: c == null || c === m.default_price_cents ? null : c, disabled: izklopljene.has(m.id) });
    }
    setShranjujem(true);
    try {
      v.nastavi(await poslovno(klub, `/business/events/${dogodek}/vip`, { method: "PUT", body: { enabled: vklop, tables } }));
      setShranjeno(true);
    } catch (e) { setNapaka(sporociloVip(e)); }
    setShranjujem(false);
  }
  const preklopi = id => setIzklopljene(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!aktivne.length) return html`<fieldset>${naslov}
    <p class="opomba">${t("Your club has no VIP tables yet. Draw the floor plan once and reuse it for every event.")}</p>
    <a class="gumb-siv" href=${baza + "/vip"}><${Ikona} ime="crown" velikost=${18} /> ${t("Set up VIP tables")}</a>
  </fieldset>`;

  return html`<fieldset class="vip-dogodek">${naslov}
    <label class="stikalo-vrstica"><span class="kv-besedilo"><strong>${t("Sell VIP tables for this event")}</strong>
      <span>${t("Guests book a table and choose a bottle package.")}</span></span>
      <input type="checkbox" role="switch" class="stikalo" checked=${vklop} onChange=${e => { setVklop(e.target.checked); setShranjeno(false); }} /></label>
    ${vklop ? html`<div class="vip-mize-seznam">${aktivne.map(m => {
      const zasedena = !!m.booking;
      return html`<div class=${"vip-vrstica-mize" + (zasedena ? " zasedena" : "")} key=${m.id}>
        <span class="kv-besedilo"><strong>${m.label}</strong>
          <span>${zasedena ? t("Booked") : doOseb(m.seats)}</span></span>
        <label class="polje vip-cena-polje"><span class="skrito">${t("Price") + " " + m.label}</span>
          <input inputmode="decimal" value=${cene[m.id] == null ? "" : cene[m.id]} disabled=${zasedena}
            placeholder=${evriBesedilo(m.default_price_cents).replace(/\.00$/, "")}
            onInput=${e => { const vr = e.target.value; setCene(c => ({ ...c, [m.id]: vr })); setShranjeno(false); }} /></label>
        <span class="utisano">€</span>
        <label class="vip-stikalo"><span class="skrito">${t("On sale") + " " + m.label}</span>
          <input type="checkbox" role="switch" class="stikalo" checked=${!izklopljene.has(m.id)} disabled=${zasedena}
            onChange=${() => { preklopi(m.id); setShranjeno(false); }} /></label>
      </div>`;
    })}</div>
    <span class="opomba">${t("The price is the default from the floor plan. Change it for this event only, or switch a table off.")}</span>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${shranjeno ? html`<p class="uspeh-besedilo" role="status">${t("VIP settings saved.")}</p>` : null}
    <button type="button" class="gumb-siv" onClick=${shrani} disabled=${shranjujem}>${shranjujem ? t("Saving...") : t("Save VIP settings")}</button>
    <a class="povezava-modra" href=${baza + "/vip"}>${t("Edit floor plan and bottle packages")}</a>
    <h3 class="nastavitev-naslov">${t("VIP reservations")}</h3>
    <${SeznamRezervacij} mize=${d.mize} />
  </fieldset>`;
}

