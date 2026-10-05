/* Zaslon dogodka (EventDetailView.swift). Glavni vhod za ljudi brez aplikacije (deljena povezava
   /app/event/:id) - dela brez prijave. "I'm in" in VIP mize zahtevajo prijavo; po prijavi se uporabnik vrne sem.
   Navadne vstopnice lahko kupi tudi gost samo z e-naslovom (nakup-gost.js, /app/guest/order) - za zastavico gost.js (privzeto izklopljeno).
   Cena null = vstopnic ni na Outlyju (zunanja povezava ali na vratih), Free samo pri 0. */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send, zabeleziOgled } from "../api.js";
import { useSeja } from "../seja.js";
import { sporocilo } from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import * as P from "../podatki.js";
import {
  denar, cena, jeMimo, jeRazprodan, jeMaloVstopnic, preostanek, seJeKoncal, danDolg, ura, mesecKratko, relativno, varenUrl
} from "../oblika.js";
import { Ikona, Slika, Avatar, GlavaNazaj, Nalaganje, Napaka, List } from "../ui.js";
import { NakupList } from "./nakup.js";
import { GostNakupList } from "./nakup-gost.js";
import { gostNakupVklopljen } from "../gost.js";
import { MiniKarta } from "./zemljevid.js";
import { CenikList } from "./club.js";

export function Dogodek({ id }) {
  const prijavljen = useSeja(s => s.prijavljen);
  const [e, setE] = useState(null);
  const [klub, setKlub] = useState(null);
  const [napaka, setNapaka] = useState(null);
  const [plan, setPlan] = useState(null);
  const [posiljam, setPosiljam] = useState(false);
  const [list, setList] = useState(null);   // "nakup" | "cenik" | "vip"
  const [preklic, setPreklic] = useState(false);   // vrnitev s Stripa brez placila (cancel_url ?placilo=preklic)
  const [vipIzbor, setVipIzbor] = useState(null);   // { miza, paket } po vrnitvi s prijave (?vip=1&table=..&pkg=..)

  async function nalozi() {
    setNapaka(null);
    try {
      const d = await P.dogodek(id);
      setE(d); setPlan(d.my_plan || null);
      document.title = d.title + " · Outly";
      P.klub(d.club_id).then(setKlub).catch(() => {});
    } catch (err) { setNapaka(sporocilo(err)); }
  }
  useEffect(() => { nalozi(); }, [id, prijavljen]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("placilo") !== "preklic") return;
    history.replaceState(history.state, "", location.pathname);
    setPreklic(true);
  }, [id]);
  useEffect(() => { zabeleziOgled({ event_id: Number(id) }); }, [id]);   // en ogled na obisk
  // Po prijavi z namenom "kupi" odpremo nakup samodejno (?buy=1); enako VIP mize (?vip=1, z izbrano mizo in paketom).
  useEffect(() => {
    if (e && prijavljen && new URLSearchParams(location.search).get("buy") === "1") {
      history.replaceState(history.state, "", location.pathname);
      if (moznoKupiti(e)) setList("nakup");
    }
    const q = new URLSearchParams(location.search);
    if (e && prijavljen && q.get("vip") === "1") {
      history.replaceState(history.state, "", location.pathname);
      if (e.vip_enabled === true && !seJeKoncal(e)) {
        setVipIzbor({ miza: Number(q.get("table")) || null, paket: Number(q.get("pkg")) || null });
        setList("vip");
      }
    }
  }, [e, prijavljen]);
  // Dogodek z VIP mizami: modul za tloris se v ozadju nalozi vnaprej (list se odpre brez cakanja).
  useEffect(() => { if (e && e.vip_enabled === true) naloziVip().catch(() => {}); }, [e && e.vip_enabled]);

  if (napaka && !e) return html`<div class="zaslon"><${GlavaNazaj} /><${Napaka} besedilo=${napaka} znova=${nalozi} /></div>`;
  if (!e) return html`<div class="zaslon"><${GlavaNazaj} /><${Nalaganje} /></div>`;

  const gostNakup = !prijavljen && gostNakupVklopljen();   // zastavica (gost.js): privzeto izklopljeno
  const povratek = `/app/login?next=${encodeURIComponent("/app/event/" + id)}`;
  async function preklopiZanimanje() {
    if (!prijavljen) { navigiraj(povratek); return; }
    if (posiljam || plan === "going") return;
    const prej = plan, novo = plan === "interested" ? null : "interested";
    setPlan(novo); setPosiljam(true);
    try {
      const r = novo
        ? await send(`/events/${id}/interest`, { method: "PUT", body: { plan: "interested" }, auth: true })
        : await send(`/events/${id}/interest`, { method: "DELETE", auth: true });
      setPlan(r && "plan" in r ? r.plan : novo);
    } catch (err) { setPlan(prej); setNapaka(sporocilo(err)); }
    setPosiljam(false);
  }

  function obVstopnicah() {
    if (e.ticket_price_cents != null) {
      // Prijavljen: navaden nakup; gost z vklopljeno zastavico: obrazec z e-naslovom; sicer prijava kot doslej.
      if (!prijavljen && !gostNakup) { navigiraj(`/app/login?next=${encodeURIComponent(`/app/event/${id}?buy=1`)}`); return; }
      setList("nakup");
    } else if (varenUrl(e.ticket_url)) {
      window.open(varenUrl(e.ticket_url), "_blank", "noopener,noreferrer");
    }
  }

  const naslovnaSlika = e.poster_url || (klub && klub._slike[0]) || "";
  const posnetek = seJeKoncal(e) && e.recap_video_url ? e.recap_video_url : "";

  return html`<div class="zaslon dogodek">
    <div class="dogodek-hero">
      ${posnetek
        ? html`<video class="hero-video" src=${posnetek} poster=${naslovnaSlika || null} controls playsinline preload="none"></video>`
        : html`<${Slika} src=${naslovnaSlika} sirina=${1000} alt=${e.title} nujna=${true} />`}
      <span class="hero-senca" aria-hidden="true"></span>
      <${GlavaNazaj} prosojna=${true} />
      <button type="button" class="krog-gumb deli" onClick=${() => deli(e)} aria-label=${t("Share")}><${Ikona} ime="share-2" velikost=${18} /></button>
      <${PasVstopnic} e=${e} ob=${obVstopnicah} />
    </div>

    <div class="dogodek-naslov">
      <h1>${e.title}</h1>
      <${GumbZanimanja} plan=${plan} ob=${preklopiZanimanje} zaseden=${posiljam} />
    </div>

    <${Prijatelji} gredo=${e.friends_going} zanima=${e.friends_interested} />
    <${Napaka} besedilo=${napaka} />
    ${preklic ? html`<p class="opomba-okvir" role="status"><${Ikona} ime="info" velikost=${18} />${t("Payment cancelled. You have not been charged.")}</p>` : null}

    <a class="kartica-vrstica" href=${"/app/club/" + e.club_id}>
      <span class="okrogla-slika">${klub && klub.logo_url ? html`<${Slika} src=${klub.logo_url} sirina=${130} alt="" />` : html`<${Ikona} ime="building" velikost=${20} />`}</span>
      <span class="kv-besedilo"><strong>${klub ? klub.name : t("Club")}</strong><span>${t("View club")}</span></span>
      ${e.min_age > 0 ? html`<span class="cip-starost">${e.min_age}+</span>` : null}
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>

    <${KarticaKdaj} e=${e} />

    <div class="kartica-info">
      <div class="info-vrstica"><span class="info-oznaka">${t("ADDRESS")}:</span><span>${naslovKluba(klub)}</span></div>
      <div class="info-vrstica"><span class="info-oznaka">${t("PHONE")}:</span>
        ${klub && klub.contact_phone ? html`<a href=${"tel:" + klub.contact_phone.replace(/[^\d+]/g, "")}>${klub.contact_phone}</a>` : html`<span>-</span>`}
      </div>
      ${klub && klub.lat != null && klub.lng != null ? html`<${MiniKarta} lat=${klub.lat} lng=${klub.lng} ime=${klub.name} />` : null}
      ${klub && klub.lat != null && klub.lng != null ? html`<a class="povezava-zemljevid" target="_blank" rel="noopener noreferrer"
        href=${`https://www.openstreetmap.org/?mlat=${klub.lat}&mlon=${klub.lng}#map=17/${klub.lat}/${klub.lng}`}>
        <${Ikona} ime="map-pin" velikost=${16} /> ${t("Open in maps")}</a>` : null}
    </div>

    <button type="button" class="kartica-vrstica" onClick=${() => setList("cenik")}>
      <${Ikona} ime="wine" velikost=${20} />
      <span class="kv-besedilo"><strong>${t("Bar prices")}</strong></span>
      <span class="utisano">${klub && klub.bar_prices.length ? t("{n} items", { n: klub.bar_prices.length }) : t("Not added yet")}</span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </button>

    ${e.description.trim() ? html`<section class="blok-besedila">
      <h2 class="nadnapis">${t("ABOUT")}</h2><p class="besedilo-opis">${e.description}</p>
    </section>` : null}

    ${!seJeKoncal(e) && klub ? html`<section class="blok-besedila">
      <h2 class="nadnapis">${t("VIP & TABLES")}</h2>
      <button type="button" class="kartica-vip" onClick=${() => { setVipIzbor(null); setList("vip"); }}>
        ${naslovnaSlika ? html`<${Slika} src=${naslovnaSlika} sirina=${300} alt="" razred="vip-ozadje" />` : null}
        <span class="vip-senca" aria-hidden="true"></span>
        <span class="vip-vsebina">
          <${Ikona} ime="crown" velikost=${24} />
          <strong>${t("Reserve a VIP table")}</strong>
          <span>${t("Bottle service and private tables for your group.")}</span>
          ${e.vip_enabled === true && e.vip_from_cents != null
            ? html`<span class="vip-od">${t("from {price}", { price: denar(e.vip_from_cents, e.currency) })}</span>` : null}
          <span class="vip-vec">${t("See tables")} <${Ikona} ime="chevron-right" velikost=${14} /></span>
        </span>
      </button>
      ${klub.contact_phone ? html`<p class="vip-klic">${t("FOR MORE QUESTIONS CALL:")}<br />
        <a href=${"tel:" + klub.contact_phone.replace(/[^\d+]/g, "")}>${klub.contact_phone}</a></p>` : null}
    </section>` : null}

    ${!gostNakup
      ? html`<${NakupList} odprt=${list === "nakup"} zapri=${() => setList(null)} dogodek=${e} imeKluba=${klub ? klub.name : ""} />`
      : html`<${GostNakupList} odprt=${list === "nakup"} zapri=${() => setList(null)} dogodek=${e} imeKluba=${klub ? klub.name : ""}
          kraj=${klub ? naslovKluba(klub) : ""}
          prijava=${() => navigiraj(`/app/login?next=${encodeURIComponent(`/app/event/${id}?buy=1`)}`)} />`}
    <${CenikList} odprt=${list === "cenik"} zapri=${() => setList(null)} klub=${klub} />
    ${e.vip_enabled === true
      // Star backend (brez polja vip_enabled) ali dogodek brez VIP: kot doslej - list s telefonom kluba.
      ? html`<${VipLoader} odprt=${list === "vip"} zapri=${() => setList(null)} dogodek=${e} imeKluba=${klub ? klub.name : ""}
          klub=${klub} prijavljen=${prijavljen} predizbor=${vipIzbor} />`
      : html`<${List} odprt=${list === "vip"} zapri=${() => setList(null)} naslov=${t("VIP tables")}>
          <p class="besedilo-opis">${t("Table reservations in the app are coming soon. {club} will publish the table layout for this event here.", { club: klub ? klub.name : t("Club") })}</p>
          <p class="opomba">${t("Until then, call the club to reserve a table.")}</p>
        <//>`}
  </div>`;
}

/* VIP tloris (views/vip-kupec.js) se nalozi leno: samo dogodki z VIP mizami ga potrebujejo. */
let vipModul = null;
const naloziVip = () => import("./vip-kupec.js").then(m => (vipModul = m));
function VipLoader(props) {
  const [m, setM] = useState(vipModul);
  const [napaka, setNapaka] = useState(false);
  useEffect(() => {
    if (!props.odprt || m) return;
    naloziVip().then(setM).catch(() => setNapaka(true));
  }, [props.odprt]);
  if (!props.odprt) return null;
  if (m) return html`<${m.VipList} ...${props} />`;
  return html`<${List} odprt=${true} zapri=${props.zapri} naslov=${t("VIP tables")}>
    ${napaka ? html`<${Napaka} besedilo=${navigator.onLine ? t("This screen could not be loaded. Please try again.") : t("No internet connection. Check your network and try again.")}
      znova=${() => (window.outlyObnovi ? window.outlyObnovi(true) : location.reload())} />` : html`<${Nalaganje} />`}
  <//>`;
}

/* Nakup na Outlyju: cena mora obstajati (null = ne prodaja se pri nas), dogodek ni mimo ali razprodan. */
const moznoKupiti = e => e.ticket_price_cents != null && !jeMimo(e) && !jeRazprodan(e);

function naslovKluba(k) {
  if (!k) return "-";
  return [k.address, k.city, k.country].map(x => (x || "").trim()).filter(Boolean).join(" ") || "-";
}

async function deli(e) {
  const url = `${location.origin}/app/event/${e.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: e.title, url }); } catch { /* preklicano */ }
    return;
  }
  try { await navigator.clipboard.writeText(url); alert(t("Link copied")); } catch { prompt(t("Copy this link"), url); }
}

function GumbZanimanja({ plan, ob, zaseden }) {
  if (plan === "going") return html`<span class="gumb-plan gre"><${Ikona} ime="check" velikost=${14} debelina=${3} /> ${t("Going")}</span>`;
  if (plan === "interested") return html`<button type="button" class="gumb-plan zanima" onClick=${ob} disabled=${zaseden} aria-pressed="true">
    <${Ikona} ime="thumbs-up" velikost=${14} /> ${t("Interested")}</button>`;
  return html`<button type="button" class="gumb-plan" onClick=${ob} disabled=${zaseden} aria-pressed="false">${t("I'm in")}</button>`;
}

function Prijatelji({ gredo, zanima }) {
  const deli = [];
  if (gredo.length === 1) deli.push(t("{a} going", { a: gredo[0].username }));
  else if (gredo.length === 2) deli.push(t("{a}, {b} going", { a: gredo[0].username, b: gredo[1].username }));
  else if (gredo.length > 2) deli.push(t("{a}, {b} + {n} going", { a: gredo[0].username, b: gredo[1].username, n: gredo.length - 2 }));
  if (zanima.length) deli.push(t("{n} interested", { n: zanima.length }));
  if (!deli.length) return null;
  const vsi = [...gredo, ...zanima.filter(z => !gredo.some(g => g.id === z.id))].slice(0, 4);
  return html`<div class="prijatelji-vrsta">
    <span class="avatarji">${vsi.map(f => html`<${Avatar} key=${f.id} url=${f.avatar_url} ime=${f.username} velikost=${28} />`)}</span>
    <span>${deli.join(" · ")}</span>
  </div>`;
}

function KarticaKdaj({ e }) {
  const d = e._zacetek;
  const r = relativno(e);
  const cas = !d ? "" : e._konec ? `${ura(d)} – ${ura(e._konec)}` : t("Starts at {t}", { t: ura(d) });
  return html`<div class="kartica-kdaj">
    <span class="koledar"><small>${mesecKratko(d).toUpperCase()}</small><strong>${d ? d.getDate() : "–"}</strong></span>
    <span class="kv-besedilo"><strong>${d ? danDolg(d) : e.start_at}</strong><span>${cas}</span></span>
    ${r ? html`<span class=${"cip-rel" + (r.nocoj ? " nocoj" : "")}>${r.napis}</span>` : null}
  </div>`;
}

/* Pas z ceno na plakatu (ticketBar): aktiven = kupi / free / zunanja povezava. */
function PasVstopnic({ e, ob }) {
  const c = cena(e) || t("Tickets");
  let zgoraj, spodaj, aktiven = false;
  const n = preostanek(e);
  if (jeMimo(e)) { zgoraj = t("Ended"); spodaj = t("event is over"); }
  else if (jeRazprodan(e)) { zgoraj = c; spodaj = t("sold out"); }
  else if (e.ticket_price_cents != null) {
    aktiven = true;
    if (e.ticket_price_cents === 0) { zgoraj = t("FREE"); spodaj = t("free entry"); }
    else if (jeMaloVstopnic(e) && n != null) { zgoraj = c; spodaj = n === 1 ? t("last ticket") : t("only {n} left", { n }); }
    else { zgoraj = c; spodaj = t("per ticket"); }
  } else if (varenUrl(e.ticket_url)) { aktiven = true; zgoraj = t("Tickets"); spodaj = t("sold by the club"); }
  else { zgoraj = t("Tickets"); spodaj = t("at the door"); }

  const vsebina = html`<strong>${zgoraj}</strong><span>${spodaj}</span>`;
  return aktiven
    ? html`<button type="button" class="pas-vstopnic aktiven" onClick=${ob}>${vsebina}</button>`
    : html`<div class="pas-vstopnic">${vsebina}</div>`;
}

