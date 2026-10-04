/* VIP mize pri poslovnem dogodku. GET /business/events/:id/vip vidijo vse vloge (tudi vratar/bar mora videti,
   kaj pripraviti), PUT /business/events/:id/vip samo owner/manager (streznik uveljavi 403; vratar do obrazca
   dogodka sploh ne pride).
   - VipDogodka: razdelek v obrazcu dogodka - vklop prodaje mize, prepis cene ali izklop po mizi, seznam rezervacij.
   - RezervacijeVip: samo seznam rezervacij (zaslon vstopnic dogodka, ki je odprt vsem vlogam).
   Rezervacija po telefonu ("hold"): gost poklice klub, owner/manager oznaci mizo na dogodku kot rezervirano, da je prek
   Outly nihce ne more kupiti (placilo gre mimo Outly). POST/DELETE /business/events/:id/tables/:tableId/hold vrneta
   celoten odgovor kot GET .../vip. Vratar rezervacijo vidi, gumbov nima (vloge uveljavlja streznik, 403). Ime gosta in
   opomba sta prosto besedilo: v DOM samo kot besedilo htm predloge. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { sporocilo, ApiError } from "../napake.js";
import { Ikona, List, Nalaganje, Napaka } from "../ui.js";
import { IKONE } from "../ikone.js";
import { poslovno, centiIz, evriBesedilo } from "../posel.js";
import {
  C, normalizirajTloris, normalizirajMize, sporociloVip, doOseb, TlorisPlatno, ElementTlorisa, OblikaMize
} from "../vip.js";

const NAJVEC_IME = 60, NAJVEC_OPOMBA = 200;

const celo = (v, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };

function normaliziraj(r) {
  const mize = normalizirajMize(r && r.tables).map(m => {
    const b = m.booking && typeof m.booking === "object" ? m.booking : null;
    // Rezervacija po telefonu; star backend polja nima -> null.
    const h = m.hold && typeof m.hold === "object" ? m.hold : null;
    return {
      ...m,
      disabled: m.disabled === true,
      archived: m.archived === true,   // arhivirana miza z rezervacijo na tem dogodku: samo v seznamu rezervacij
      default_price_cents: celo(m.default_price_cents, m.price_cents),
      hold: h ? { guest_name: String(h.guest_name || ""), note: String(h.note || ""), created_at: h.created_at || null } : null,
      booking: b ? { ...b, guests: celo(b.guests, 0), checked_in: celo(b.checked_in, 0), buyer_username: String(b.buyer_username || "") } : null
    };
  });
  return { enabled: !!(r && r.enabled), valuta: (r && r.currency) || "EUR", plan: normalizirajTloris(r && r.plan), mize };
}

/** ver = razlicica obrazca: poveca se ob nalaganju in po shranjevanju (obrazec se napolni iz odgovora), NE ob rezervaciji
    po telefonu (samoRez) - sicer bi odgovor streznika povozil se neshranjene cene in stikala. */
function useVip(klub, dogodek) {
  const [s, setS] = useState({ nalaga: true, napaka: null, d: null, ver: 0 });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: !x.d, napaka: null }));
    return poslovno(klub, `/business/events/${dogodek}/vip`)
      .then(r => setS(x => ({ nalaga: false, napaka: null, d: normaliziraj(r), ver: x.ver + 1 })))
      .catch(e => setS(x => ({ ...x, nalaga: false, napaka: e })));
  };
  useEffect(() => { if (klub && dogodek) nalozi(); }, [klub, dogodek]);
  const nastavi = (r, samoRez = false) => setS(x => ({ nalaga: false, napaka: null, d: normaliziraj(r), ver: samoRez ? x.ver : x.ver + 1 }));
  /** Tiha osvezitev samo rezervacij (npr. po 409): obrazec ostane, kot je. */
  const osvezi = () => poslovno(klub, `/business/events/${dogodek}/vip`).then(r => nastavi(r, true)).catch(() => {});
  return { ...s, nalozi, nastavi, osvezi };
}

/** Star backend (404) ali vloga brez pravice (403): razdelka ni - ne motimo. */
const brezPodpore = e => !!e && (e.status === 404 || e.status === 403);

/** Rezervacije: miza, kupec, paket, prisli X/N. */
function SeznamRezervacij({ mize }) {
  const rez = mize.filter(m => m.booking || m.hold);
  if (!rez.length) return html`<p class="opomba srednje">${t("No reservations yet")}</p>`;
  return html`<div class="vip-rezervacije">${rez.map(m => m.booking ? html`<div class="vip-rez" key=${m.id}>
    <span class="vip-rez-miza">${m.label}</span>
    <span class="kv-besedilo"><strong>${m.booking.buyer_username || "-"}</strong>
      <span>${m.booking.package_name || t("Table")} ${m.booking.public_ref ? "· " + m.booking.public_ref : ""}</span></span>
    <span class="vip-rez-vstop"><strong>${m.booking.checked_in}/${m.booking.guests || m.seats}</strong><small>${t("Checked in")}</small></span>
  </div>` : html`<div class="vip-rez" key=${m.id}>
    <span class="vip-rez-miza">${m.label}</span>
    <span class="vip-hold-tekst"><strong>${m.hold.guest_name || "-"}</strong>
      ${m.hold.note ? html`<span>${m.hold.note}</span>` : null}</span>
    <span class="vip-rez-vstop vip-rez-tel"><${Ikona} ime="phone" velikost=${18} /><small>${t("Phone")}</small></span>
  </div>`)}</div>`;
}

/** Samo rezervacije (zaslon vstopnic dogodka, vse vloge). Skrito, dokler dogodek nima VIP miz ali rezervacij.
    osvezi: stevec, ki ga starsi poveca, ko se stanje vstopov spremeni (prisli X/N). */
export function RezervacijeVip({ klub, dogodek, osvezi = 0 }) {
  const v = useVip(klub, dogodek);
  useEffect(() => { if (osvezi) v.nalozi(); }, [osvezi]);   // npr. po rocnem vstopu na istem zaslonu
  if (v.napaka) return brezPodpore(v.napaka) ? null : html`<${Napaka} besedilo=${sporocilo(v.napaka)} znova=${v.nalozi} />`;
  if (!v.d) return null;
  if (!v.d.enabled && !v.d.mize.some(m => m.booking || m.hold)) return null;
  return html`<section class="vip-razdelek">
    <h2 class="podnaslov">${t("VIP reservations")}</h2>
    <${SeznamRezervacij} mize=${v.d.mize} />
  </section>`;
}

/** Ikona telefona znotraj tlorisa (ugnezden SVG, paths iz nabora ikon). */
function IkonaTelefon({ x, y, velikost }) {
  return html`<svg class="tl-tel" x=${x} y=${y} width=${velikost} height=${velikost} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    ${IKONE.phone.map(([el, atr]) => html`<${el} ...${atr} />`)}
  </svg>`;
}

/** Tloris dogodka samo za branje: prosta / prodana (dashed) / rezervirana po telefonu (polna + ikona telefona). */
function TlorisDogodka({ plan, mize }) {
  return html`<div class="vip-tloris-okvir"><${TlorisPlatno} plan=${plan} oznaka=${t("Floor plan")}>
    ${plan.elements.map((e, i) => html`<${ElementTlorisa} key=${"e" + i} e=${e} />`)}
    ${mize.filter(m => !m.archived).map(m => {
      const stanje = m.booking ? "prodana" : m.hold ? "telefon" : "prosta";
      const sir = m.w * C, vis = m.h * C, ik = Math.max(7, Math.min(12, Math.min(sir, vis) * 0.34));
      const okrogla = m.shape === "round";
      const ix = m.x * C + sir - ik - (okrogla ? sir * 0.14 : 2), iy = m.y * C + (okrogla ? vis * 0.14 : 2);
      return html`<g key=${m.id} class=${"tl-miza " + stanje} role="img"
        aria-label=${`${t("Table")} ${m.label}, ${m.booking ? t("Booked") : m.hold ? t("Reserved by phone") : t("Available")}`}>
        <${OblikaMize} m=${m} napis2=${m.booking ? t("Booked") : ""} />
        ${m.hold ? html`<${IkonaTelefon} x=${ix} y=${iy} velikost=${ik} />` : null}
      </g>`;
    })}
  <//></div>
  <div class="vip-legenda" aria-hidden="true">
    <span><i class="tl-pika prosta"></i>${t("Available")}</span>
    <span><i class="tl-pika prodana"></i>${t("Booked")}</span>
    <span><i class="tl-pika telefon"></i>${t("Reserved by phone")}</span>
  </div>`;
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
  // Rezervacija po telefonu: odprt obrazec pri eni mizi, potrditev sprostitve v listu.
  const [rez, setRez] = useState(null);   // { id, gost, opomba, napaka, posiljam }
  const [sprosti, setSprosti] = useState(null);   // { miza, napaka, posiljam }
  const gostRef = useRef(null);
  const d = v.d;
  const baza = `/app/business/${klub}`;
  const aktivne = d ? d.mize.filter(m => !m.archived) : [];   // arhiviranih ne urejamo in ne posiljamo v PUT

  // Obrazec se napolni iz odgovora streznika (ob nalaganju in po shranjevanju).
  useEffect(() => {
    if (!d) return;
    setVklop(d.enabled);
    setCene(Object.fromEntries(d.mize.map(m => [m.id, evriBesedilo(m.price_cents).replace(/\.00$/, "")])));
    setIzklopljene(new Set(d.mize.filter(m => m.disabled).map(m => m.id)));
  }, [v.ver]);

  const odprtaId = rez ? rez.id : null;
  useEffect(() => { if (odprtaId != null && gostRef.current) gostRef.current.focus(); }, [odprtaId]);   // fokus v polje "Guest name"

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
  const odpriRez = m => setRez({ id: m.id, gost: "", opomba: "", napaka: "", posiljam: false });
  const urediRez = polje => e => { const vr = e.target.value; setRez(r => r && { ...r, [polje]: vr, napaka: "" }); };
  async function rezerviraj(m) {
    if (!rez || rez.posiljam) return;
    const ime = rez.gost.trim(), opomba = rez.opomba.trim();
    if (!ime) return setRez(r => ({ ...r, napaka: t("Enter the guest name.") }));
    if ([...ime].length > NAJVEC_IME || [...opomba].length > NAJVEC_OPOMBA) return setRez(r => ({ ...r, napaka: t("The name or note is too long.") }));
    setRez(r => ({ ...r, posiljam: true, napaka: "" }));
    try {
      v.nastavi(await poslovno(klub, `/business/events/${dogodek}/tables/${m.id}/hold`, { method: "POST", body: { guest_name: ime, note: opomba || null } }), true);
      setRez(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) v.osvezi();   // medtem rezervirana (kupec ali kolega): pokazi pravo stanje
      setRez(r => r && { ...r, posiljam: false, napaka: sporociloVip(e) });
    }
  }
  async function sprostiMizo() {
    if (!sprosti || sprosti.posiljam) return;
    setSprosti(x => ({ ...x, posiljam: true, napaka: "" }));
    try {
      v.nastavi(await poslovno(klub, `/business/events/${dogodek}/tables/${sprosti.miza.id}/hold`, { method: "DELETE" }), true);
      setSprosti(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { v.osvezi(); return setSprosti(null); }   // rezervacije ze ni (kolega jo je sprostil)
      setSprosti(x => ({ ...x, posiljam: false, napaka: sporocilo(e) }));
    }
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
    ${vklop ? html`${d.plan ? html`<${TlorisDogodka} plan=${d.plan} mize=${d.mize} />` : null}
    <div class="vip-mize-seznam">${aktivne.map(m => {
      const zasedena = !!m.booking || !!m.hold;
      const odprta = rez && rez.id === m.id;
      return html`<div class="vip-miza-blok" key=${m.id}>
      <div class=${"vip-vrstica-mize" + (zasedena ? " zasedena" : "")}>
        <span class="kv-besedilo"><strong>${m.label}</strong>
          <span>${m.booking ? t("Booked") : m.hold ? t("Reserved by phone") : doOseb(m.seats)}</span></span>
        <label class="polje vip-cena-polje"><span class="skrito">${t("Price") + " " + m.label}</span>
          <input inputmode="decimal" value=${cene[m.id] == null ? "" : cene[m.id]} disabled=${zasedena}
            placeholder=${evriBesedilo(m.default_price_cents).replace(/\.00$/, "")}
            onInput=${e => { const vr = e.target.value; setCene(c => ({ ...c, [m.id]: vr })); setShranjeno(false); }} /></label>
        <span class="utisano">€</span>
        <label class="vip-stikalo"><span class="skrito">${t("On sale") + " " + m.label}</span>
          <input type="checkbox" role="switch" class="stikalo" checked=${!izklopljene.has(m.id)} disabled=${zasedena}
            onChange=${() => { preklopi(m.id); setShranjeno(false); }} /></label>
      </div>
      ${m.hold ? html`<div class="vip-hold">
        <${Ikona} ime="phone" velikost=${18} />
        <span class="vip-hold-tekst"><strong>${m.hold.guest_name || "-"}</strong>${m.hold.note ? html`<span>${m.hold.note}</span>` : null}</span>
        <button type="button" class="vip-hold-gumb" onClick=${() => setSprosti({ miza: m, napaka: "", posiljam: false })}>${t("Release")}</button>
      </div>` : !m.booking && !odprta ? html`<button type="button" class="vip-hold-gumb" onClick=${() => odpriRez(m)}>
        <${Ikona} ime="phone" velikost=${16} />${t("Mark as reserved")}</button>` : null}
      ${odprta ? html`<form class="vip-hold-obrazec" onSubmit=${e => { e.preventDefault(); rezerviraj(m); }} noValidate>
        <label class="polje-oznaceno"><span>${t("Guest name")}</span>
          <input ref=${gostRef} value=${rez.gost} maxLength=${NAJVEC_IME} autocomplete="off" required onInput=${urediRez("gost")} /></label>
        <label class="polje-oznaceno"><span>${t("Note")}</span>
          <input value=${rez.opomba} maxLength=${NAJVEC_OPOMBA} autocomplete="off" placeholder=${t("6 guests, arriving 23:00")} onInput=${urediRez("opomba")} /></label>
        ${rez.napaka ? html`<p class="napaka-besedilo" role="alert">${rez.napaka}</p>` : null}
        <div class="vip-hold-gumbi">
          <button type="submit" class="gumb-siv majhen poudarjen" disabled=${rez.posiljam}>${rez.posiljam ? t("Saving...") : t("Reserve")}</button>
          <button type="button" class="gumb-siv majhen" disabled=${rez.posiljam} onClick=${() => setRez(null)}>${t("Cancel")}</button>
        </div>
      </form>` : null}
      </div>`;
    })}</div>
    <span class="opomba">${t("The price is the default from the floor plan. Change it for this event only, or switch a table off.")}</span>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${shranjeno ? html`<p class="uspeh-besedilo" role="status">${t("VIP settings saved.")}</p>` : null}
    <button type="button" class="gumb-siv" onClick=${shrani} disabled=${shranjujem}>${shranjujem ? t("Saving...") : t("Save VIP settings")}</button>
    <a class="povezava-modra" href=${baza + "/vip"}>${t("Edit floor plan and bottle packages")}</a>
    <h3 class="nastavitev-naslov">${t("VIP reservations")}</h3>
    <${SeznamRezervacij} mize=${d.mize} />
    <${List} odprt=${!!sprosti} zapri=${() => setSprosti(null)} naslov=${t("Release this reservation?")}>
      ${sprosti ? html`<p class="besedilo-opis">${t("Table")} ${sprosti.miza.label} · ${sprosti.miza.hold ? sprosti.miza.hold.guest_name : ""}</p>` : null}
      ${sprosti && sprosti.napaka ? html`<p class="napaka-besedilo" role="alert">${sprosti.napaka}</p>` : null}
      <button type="button" class="gumb-rdec" disabled=${!!sprosti && sprosti.posiljam} onClick=${sprostiMizo}>${sprosti && sprosti.posiljam ? t("Saving...") : t("Release")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setSprosti(null)}>${t("Keep it")}</button>
    <//>
  </fieldset>`;
}

