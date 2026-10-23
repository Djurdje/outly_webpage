/* Rezervacije VIP miz za vodstvo kluba (owner, manager; Martin 23. 10. 2026): seznam dogodkov z vstevilom zasedenih miz in
   za izbran dogodek vse mize z nakupom (»Paid in app«), rezervacijo v aplikaciji (»Pay at the door«) ali po telefonu (»Phone«).
   Viri: GET /business/events (vip_reservations), GET /business/events/:id/vip (booking | hold), DELETE .../tables/:tableId/hold
   (Release; nakup se ne sprosca). Imena gostov in paketov so prosto besedilo: v DOM samo kot besedilo htm predloge. */
import { html, useEffect, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { sporocilo, ApiError } from "../napake.js";
import { danInUra, denar, normalizirajDogodek, seJeKoncal } from "../oblika.js";
import { GlavaNazaj, Ikona, List, Nalaganje, Plakat } from "../ui.js";
import { idKluba, poslovno, normalizirajDogodke } from "../posel.js";
import { PoslovnaNapaka } from "./posel.js";
import { useVip } from "./posel-vip-dogodek.js";
import { doOseb } from "../vip.js";

/** Prihajajoci najprej (najblizji na vrhu), nato pretekli (najnovejsi na vrhu). Osnutki nimajo rezervacij: izpuscni. */
function uredi(seznam) {
  const zdaj = Date.now();
  const cas = e => (e._zacetek ? e._zacetek.getTime() : 0);
  const vidni = seznam.filter(e => e.status !== "draft");
  return [...vidni.filter(e => cas(e) >= zdaj).sort((a, b) => cas(a) - cas(b)), ...vidni.filter(e => cas(e) < zdaj).sort((a, b) => cas(b) - cas(a))];
}

const steviloRez = e => Math.max(0, Math.trunc(Number(e.vip_reservations)) || 0);

/* ---------- Zaslon 1: dogodki ---------- */
export function RezervacijeDogodkov({ klub }) {
  const id = idKluba(klub);
  const baza = `/app/business/${id}`;
  const [s, setS] = useState({ nalaga: true, napaka: null, dogodki: [] });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    poslovno(id, "/business/events")
      .then(r => setS({ nalaga: false, napaka: null, dogodki: uredi(normalizirajDogodke(r)) }))
      .catch(e => setS({ nalaga: false, napaka: e, dogodki: [] }));
  };
  useEffect(() => { if (id) nalozi(); }, [id]);
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${baza} />
    <h1 class="velik-naslov">${t("Reservations")}</h1>
    <p class="opomba">${t("Choose an event to see who reserved or bought a VIP table.")}</p>
    ${!id ? html`<${PoslovnaNapaka} napaka=${{ status: 404 }} />` : null}
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !s.napaka && !s.dogodki.length ? html`<div class="prazno">
      <${Ikona} ime="calendar" velikost=${34} razred="modra" />
      <strong>${t("No events yet")}</strong></div>` : null}
    <div class="seznam">
      ${s.dogodki.map(e => {
        const n = steviloRez(e);
        return html`<a class="vrstica-dogodka-kluba" key=${e.id} href=${`${baza}/reservations/${e.id}`}>
          <span class="vdk-slika">${e.poster_url ? html`<${Plakat} src=${e.poster_url} sirina=${240} alt="" />` : html`<${Ikona} ime="image" velikost=${22} razred="utisano" />`}</span>
          <span class="kv-besedilo">
            <strong>${e.title}</strong>
            <span class="vdk-datum">${danInUra(e._zacetek)}</span>
            <span class="vdk-meta">${n > 0 ? html`<span class="modra"><${Ikona} ime="crown" velikost=${12} /> ${tn("1 table reserved", "{n} tables reserved", n)}</span>`
              : html`<span>${t("No reservations yet")}</span>`}
              ${seJeKoncal(e) ? html`<span class="utisano">${t("Ended")}</span>` : null}</span>
          </span>
          <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
        </a>`;
      })}
    </div>
  </div>`;
}

/* ---------- Zaslon 2: rezervacije dogodka ---------- */
const nacin = m => (m.booking ? "app" : m.hold && m.hold.source === "app" ? "vrata" : "telefon");
const napisNacina = n => (n === "app" ? t("Paid in app") : n === "vrata" ? t("Pay at the door") : t("Phone"));
const ikonaNacina = n => (n === "app" ? "credit-card" : n === "vrata" ? "ticket" : "phone");
const cas = iso => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? danInUra(d) : ""; };

function Vrstica({ m, valuta, sprosti }) {
  const n = nacin(m);
  const b = m.booking, h = m.hold;
  const ime = b ? b.buyer_username || "-" : (h.guest_name || h.username || "-");
  const uporabnik = h && h.username && h.username !== ime ? "@" + h.username : "";
  const paket = b ? b.package_name : h.package_name;
  // Plačano v aplikaciji: dejansko plačan znesek (booking.total_cents, backend 23. 10. 2026); brez njega cena mize.
  const centi = b ? (typeof b.total_cents === "number" && Number.isFinite(b.total_cents) ? b.total_cents : m.price_cents) : h.price_cents;
  const cena = centi != null && Number.isFinite(centi) ? denar(centi, valuta) : "";
  const kdaj = cas(b ? b.created_at : h.created_at);
  const sedezi = m.seats > 0 ? doOseb(m.seats) : "";
  return html`<div class="rez-vrstica" data-testid="rez-vrstica" data-nacin=${n}>
    <span class="vip-rez-miza">${m.label}</span>
    <span class="kv-besedilo rez-besedilo">
      <strong>${ime}</strong>
      ${uporabnik ? html`<span>${uporabnik}</span>` : null}
      <span>${[sedezi, paket].filter(Boolean).join(" · ")}</span>
      <span class="rez-meta"><span class=${"rez-nacin " + n}><${Ikona} ime=${ikonaNacina(n)} velikost=${12} /> ${napisNacina(n)}</span>
        ${cena ? html`<span>${cena}</span>` : null}${kdaj ? html`<span>${kdaj}</span>` : null}</span>
      ${h && h.note ? html`<span>${h.note}</span>` : null}
    </span>
    <span class="rez-desno">
      ${b ? html`<span class="vip-rez-vstop"><strong>${b.checked_in}/${b.guests || m.seats}</strong><small>${t("checked in")}</small></span>`
        : html`<button type="button" class="vip-hold-gumb" onClick=${() => sprosti(m)}>${t("Release")}</button>`}
    </span>
  </div>`;
}

export function RezervacijeDogodka({ klub, dogodek }) {
  const id = idKluba(klub);
  const idDogodka = idKluba(dogodek);
  const baza = `/app/business/${id}`;
  const rezerva = `${baza}/reservations`;
  const v = useVip(id, idDogodka);
  const [naslov, setNaslov] = useState(null);   // { title, _zacetek } iz seznama dogodkov (VIP pot naslova ne vraca)
  const [sprosti, setSprosti] = useState(null);   // { miza, napaka, posiljam }
  useEffect(() => {
    if (!id || !idDogodka) return;
    poslovno(id, "/business/events").then(r => {
      const e = (Array.isArray(r) ? r : []).find(x => x.id === idDogodka);
      if (e) { const n = normalizirajDogodek(e); setNaslov({ title: n.title, _zacetek: n._zacetek, poster_url: n.poster_url }); }
    }).catch(() => {});
  }, [id, idDogodka]);

  async function sprostiMizo() {
    if (!sprosti || sprosti.posiljam) return;
    const miza = sprosti.miza;
    setSprosti(x => x && { ...x, posiljam: true, napaka: "" });
    try {
      v.nastavi(await poslovno(id, `/business/events/${idDogodka}/tables/${miza.id}/hold`, { method: "DELETE" }), true);
      setSprosti(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { v.osvezi(); setSprosti(null); return; }   // ze sprosceno (kolega)
      setSprosti(x => x && { ...x, posiljam: false, napaka: sporocilo(e) });
    }
  }

  if (!id || !idDogodka) return html`<div class="zaslon"><${GlavaNazaj} rezerva=${rezerva} /><${PoslovnaNapaka} napaka=${{ status: 404 }} /></div>`;
  const mize = v.d ? v.d.mize.filter(m => m.booking || m.hold).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) : [];
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${rezerva} />
    <h1 class="velik-naslov">${naslov ? naslov.title : t("Reservations")}</h1>
    ${naslov && naslov._zacetek ? html`<p class="opomba">${danInUra(naslov._zacetek)}</p>` : null}
    ${v.nalaga && !v.d ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${v.napaka} znova=${v.nalozi} rezerva=${rezerva} />
    ${v.d && !mize.length ? html`<div class="prazno">
      <${Ikona} ime="crown" velikost=${34} razred="modra" />
      <strong>${t("No reservations yet")}</strong></div>` : null}
    ${mize.length ? html`<p class="opomba">${tn("1 table reserved", "{n} tables reserved", mize.length)}</p>
      <div class="rez-seznam">${mize.map(m => html`<${Vrstica} key=${m.id} m=${m} valuta=${v.d.valuta} sprosti=${x => setSprosti({ miza: x, napaka: "", posiljam: false })} />`)}</div>` : null}
    <${List} odprt=${!!sprosti} zapri=${() => setSprosti(null)} brezZapiranja=${!!sprosti && sprosti.posiljam} naslov=${t("Release this reservation?")}>
      ${sprosti ? html`<p class="besedilo-opis">${t("Table")} ${sprosti.miza.label} · ${sprosti.miza.hold ? (sprosti.miza.hold.guest_name || sprosti.miza.hold.username) : ""}</p>` : null}
      ${sprosti && sprosti.napaka ? html`<p class="napaka-besedilo" role="alert">${sprosti.napaka}</p>` : null}
      <button type="button" class="gumb-rdec" disabled=${!!sprosti && sprosti.posiljam} onClick=${sprostiMizo}>${sprosti && sprosti.posiljam ? t("Saving...") : t("Release")}</button>
      <button type="button" class="gumb-siv" disabled=${!!sprosti && sprosti.posiljam} onClick=${() => setSprosti(null)}>${t("Keep it")}</button>
    <//>
  </div>`;
}
