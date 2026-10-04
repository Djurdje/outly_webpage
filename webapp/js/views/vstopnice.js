/* Moje vstopnice (TicketsView.swift): prihajajoce s QR kodo, pretekle in uporabljene zlozene.
   QR je podpisan niz iz backenda; po prenosu vstopnice stara koda ne velja vec (I7). */
import { html, useEffect, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { danInUra } from "../oblika.js";
import { GlavaNazaj, Nalaganje, Napaka, Ikona, Slika, Avatar, List } from "../ui.js";
import { KodaQR } from "../qr.js";
import { VipVrstica, doOseb } from "../vip.js";

/* VIP miza = en nakup z vec vstopnicami (Martin 4. 10. 2026): vstopnice z is_vip === true in istim order_id se v
   razdelku zdruzijo v eno postavko na mestu prve (vrstni red iz GET /me/tickets ostane). Skupina z eno vstopnico
   ostane navadna vrstica. Enako vedenje kot iOS TicketsView. */
function zdruzi(seznam) {
  const postavke = [], skupine = new Map();
  for (const v of seznam) {
    if (v.is_vip === true && v.order_id != null) {
      let g = skupine.get(v.order_id);
      if (!g) { g = { skupina: true, id: v.order_id, vst: [] }; skupine.set(v.order_id, g); postavke.push(g); }
      g.vst.push(v);
    } else postavke.push({ skupina: false, v });
  }
  return postavke.map(p => (p.skupina && p.vst.length === 1 ? { skupina: false, v: p.vst[0] } : p));
}

export function Vstopnice() {
  const [s, setS] = useState({ nalaga: true, napaka: null, vst: [] });
  const [odprta, setOdprta] = useState(null);
  const [pokaziStare, setPokaziStare] = useState(false);
  const [razprte, setRazprte] = useState({});   // skupine VIP miz, privzeto zaprte; kljuc = razdelek + order_id
  const [prenos, setPrenos] = useState(null);
  const nalozi = async () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    try {
      const r = await send("/me/tickets", { auth: true });
      setS({ nalaga: false, napaka: null, vst: (Array.isArray(r) ? r : []).map(v => ({ ...v, _zacetek: v.start_at ? new Date(v.start_at) : null })) });
    } catch (e) { setS(x => ({ ...x, nalaga: false, napaka: sporocilo(e) })); }
  };
  // Povratek s Stripove placilne strani (backend #19): vstopnice nastanejo, ko Stripe potrdi placilo (webhook, nekaj sekund).
  const [placano] = useState(() => new URLSearchParams(location.search).get("placilo") === "uspeh");
  useEffect(() => {
    nalozi();
    if (!placano) return;
    history.replaceState(history.state, "", location.pathname);
    const casi = [2000, 5000, 10000].map(ms => setTimeout(nalozi, ms));
    return () => casi.forEach(clearTimeout);
  }, []);

  const zdaj = Date.now() - 8 * 3600e3;   // dogodek brez konca velja se 8 h po zacetku (kot backend)
  const prihajajoce = s.vst.filter(v => v.status === "valid" && v._zacetek && v._zacetek.getTime() >= zdaj);
  const stare = s.vst.filter(v => !prihajajoce.includes(v));
  const postavkePrih = zdruzi(prihajajoce), postavkeStare = zdruzi(stare);
  const preklopiSkupino = k => setRazprte(x => ({ ...x, [k]: !x[k] }));
  const vsaka = (postavke, razdelek, stara) => postavke.map(p => p.skupina
    ? html`<${Skupina} key=${razdelek + p.id} vst=${p.vst} stara=${stara} razprta=${!!razprte[razdelek + p.id]} preklopi=${() => preklopiSkupino(razdelek + p.id)}
        odprta=${odprta} preklopiVstopnico=${id => setOdprta(odprta === id ? null : id)} poslji=${v => setPrenos(v)} />`
    : stara
      ? html`<${Karta} key=${p.v.id} v=${p.v} odprta=${false} stara=${true} />`
      : html`<${Karta} key=${p.v.id} v=${p.v} odprta=${odprta === p.v.id || postavkePrih.length === 1} preklopi=${() => setOdprta(odprta === p.v.id ? null : p.v.id)} poslji=${() => setPrenos(p.v)} />`);

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Tickets")} rezerva="/app/profile" />
    ${placano ? html`<p class="opomba-okvir" role="status"><${Ikona} ime="check" velikost=${18} />${t("Payment received. Your tickets will appear here in a few seconds.")}</p>` : null}
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !s.napaka && !s.vst.length ? html`<div class="prazno">
      <${Ikona} ime="ticket" velikost=${34} razred="modra" />
      <strong>${t("No tickets yet")}</strong><span>${t("Tickets you buy on Outly will show up here.")}</span>
      <a class="gumb-siv" href="/app/events">${t("See all events")}</a>
    </div>` : null}
    <div class="vstopnice-seznam">
      ${vsaka(postavkePrih, "p", false)}
    </div>
    ${stare.length ? html`<button type="button" class="kartica-vrstica" onClick=${() => setPokaziStare(!pokaziStare)} aria-expanded=${pokaziStare}>
      <span class="kv-besedilo"><strong>${t("Past and used")}</strong><span>${stare.length}</span></span>
      <${Ikona} ime=${pokaziStare ? "chevron-down" : "chevron-right"} velikost=${16} razred="utisano" />
    </button>` : null}
    ${pokaziStare ? html`<div class="vstopnice-seznam">${vsaka(postavkeStare, "s", true)}</div>` : null}
    <${PrenosList} vstopnica=${prenos} zapri=${() => setPrenos(null)} koncano=${() => { setPrenos(null); nalozi(); }} />
  </div>`;
}

function Karta({ v, odprta, preklopi, stara, poslji }) {
  const uporabljena = v.status === "used";
  const stanje = uporabljena ? t("ALREADY USED") : v.status === "valid" ? (stara ? t("ENDED") : "") : v.status.toUpperCase();
  const vip = v.is_vip === true;
  return html`<div class=${"vstopnica" + (stara ? " stara" : "") + (vip ? " vip" : "")}>
    <button type="button" class="vstopnica-glava-gumb" onClick=${preklopi} disabled=${stara} aria-expanded=${odprta}>
      <span class="vd-slika"><${Slika} src=${v.poster_url} sirina=${150} alt="" /></span>
      <span class="kv-besedilo"><span class="nadnapis">${(v.club_name || "").toUpperCase()}</span><strong>${v.event_title}</strong>
        <span>${danInUra(v._zacetek)}</span>
        ${vip ? html`<${VipVrstica} v=${v} />` : null}</span>
      ${stanje ? html`<span class="cip-plan">${stanje}</span>` : null}
    </button>
    ${odprta && !stara ? html`<${QrTelo} v=${v} poslji=${poslji} />` : null}
  </div>`;
}

/* QR, polja in "Send to a friend" ene vstopnice (v navadni karti in v skupini VIP mize). */
function QrTelo({ v, poslji }) {
  const vip = v.is_vip === true;
  return html`<div class="vstopnica-qr">
    ${vip && (v.package_description || v.table_seats) ? html`<div class="vip-paket-opis">
      ${v.package_description ? html`<span>${v.package_description}</span>` : null}
      ${v.table_seats ? html`<span>${doOseb(v.table_seats)}</span>` : null}
    </div>` : null}
    <${KodaQR} vsebina=${v.qr} velikost=${220} oznaka=${t("Ticket QR code")} />
    <div class="vstopnica-polja">
      <span><small>${t("ORDER")}</small>${v.public_ref}</span>
      <span><small>${t("TICKET")}</small>${String(v.serial || "").slice(0, 8).toUpperCase()}</span>
      ${v.min_age > 0 ? html`<span><small>${t("AGE")}</small>${v.min_age}+</span>` : null}
    </div>
    <p class="opomba srednje">${t("Show this QR code at the door. Turn your screen brightness up.")}</p>
    ${v.transferable && poslji ? html`<button type="button" class="gumb-siv" onClick=${() => poslji(v)}><${Ikona} ime="send" velikost=${16} /> ${t("Send to a friend")}</button>` : null}
  </div>`;
}

/* Vstopnice ene VIP mize (en nakup) v eni postavki: glava (plakat, dogodek, miza, stevilo) in spustni seznam
   kompaktnih vrstic "Ticket N"; klik na vrstico pokaze QR te vstopnice. */
function Skupina({ vst, stara, razprta, preklopi, odprta, preklopiVstopnico, poslji }) {
  const v = vst[0];
  const id = "skupina-" + v.order_id + (stara ? "-s" : "-p");
  return html`<div class=${"vstopnica vip skupina" + (stara ? " stara" : "")}>
    <button type="button" class="vstopnica-glava-gumb" onClick=${preklopi} aria-expanded=${razprta} aria-controls=${id}>
      <span class="vd-slika"><${Slika} src=${v.poster_url} sirina=${150} alt="" /></span>
      <span class="kv-besedilo"><span class="nadnapis">${(v.club_name || "").toUpperCase()}</span><strong>${v.event_title}</strong>
        <span>${danInUra(v._zacetek)}</span>
        <${VipVrstica} v=${v} /></span>
      <span class="cip-plan">${tn("1 ticket", "{n} tickets", vst.length)}</span>
      <${Ikona} ime="chevron-down" velikost=${18} razred=${"utisano skupina-puscica" + (razprta ? " odprta" : "")} />
    </button>
    ${razprta ? html`<div class="skupina-seznam" id=${id}>
      ${vst.map((x, i) => {
        const stanje = x.status === "used" ? t("USED") : x.status === "valid" ? (stara ? t("ENDED") : t("VALID")) : String(x.status || "").toUpperCase();
        const naVoljo = !stara && x.status === "valid";
        const od = x.transferred && x.buyer_username ? t("from {name}", { name: x.buyer_username }) : "";
        const serial = String(x.serial || "").slice(0, 8).toUpperCase();
        const o = naVoljo && odprta === x.id;
        return html`<div class="skupina-vstopnica" key=${x.id}>
          <button type="button" class="skupina-vrstica" onClick=${() => preklopiVstopnico(x.id)} disabled=${!naVoljo} aria-expanded=${o}>
            <span class="kv-besedilo"><strong>${t("Ticket {n}", { n: i + 1 })}</strong>
              ${serial || od ? html`<span>${[serial, od].filter(Boolean).join(" · ")}</span>` : null}</span>
            <span class="cip-plan">${stanje}</span>
            ${naVoljo ? html`<${Ikona} ime="chevron-down" velikost=${16} razred=${"utisano skupina-puscica" + (o ? " odprta" : "")} />` : null}
          </button>
          ${o ? html`<${QrTelo} v=${x} poslji=${poslji} />` : null}
        </div>`;
      })}
    </div>` : null}
  </div>`;
}

/* Prenos vstopnice (TransferTicketView.swift): prijatelju s seznama ali na e-naslov Outly racuna.
   Po prenosu dobi prijatelj novo QR kodo, tvoja preneha veljati (I7). Z vprasanjem pred prenosom (Martin 23. 9.). */
function PrenosList({ vstopnica: v, zapri, koncano }) {
  const [prijatelji, setPrijatelji] = useState(null);
  const [email, setEmail] = useState("");
  const [izbran, setIzbran] = useState(null);   // { user_id, ime } ali { email, ime }
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const [uspeh, setUspeh] = useState("");
  useEffect(() => {
    if (!v) return;
    setIzbran(null); setNapaka(""); setUspeh(""); setEmail("");
    send("/me/friends", { auth: true }).then(r => setPrijatelji((r && r.friends) || [])).catch(() => setPrijatelji([]));
    // Po id, ne po objektu: osvezitev seznama vstopnic v ozadju ustvari nov objekt in bi sredi tipkanja pobrisala vnos.
  }, [v && v.id]);
  if (!v) return null;

  async function poslji() {
    setTece(true); setNapaka("");
    try {
      await send(`/tickets/${v.id}/transfer`, { method: "POST", body: izbran.user_id ? { user_id: izbran.user_id } : { email: izbran.email }, auth: true });
      setUspeh(izbran.ime); setIzbran(null);
    } catch (e) { setNapaka(sporocilo(e)); setIzbran(null); }
    setTece(false);
  }
  const opis = v.min_age > 0
    ? t("The ticket moves to your friend's account with a new QR code. Your copy stops working. Your friend needs an Outly account and must be {n}+.", { n: v.min_age })
    : t("The ticket moves to your friend's account with a new QR code. Your copy stops working. Your friend needs an Outly account.");

  return html`<${List} odprt=${true} zapri=${uspeh ? koncano : zapri} naslov=${t("Send to a friend")}>
    ${uspeh ? html`<div class="uspeh"><span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("Sent to {name}", { name: uspeh })}</strong><span class="utisano">${t("It will show up under Tickets in their app.")}</span>
        <button type="button" class="gumb-glavni" onClick=${koncano}>${t("Done")}</button></div>`
    : izbran ? html`<p class="besedilo-opis">${t("Send your ticket for {event} to {name}?", { event: v.event_title, name: izbran.ime })}</p>
        <p class="opomba">${t("Your copy stops working.")}</p>
        <p class="opomba">${t("If the event is cancelled, the refund goes to the original buyer, not to your friend.")}</p>
        <button type="button" class="gumb-glavni" onClick=${poslji} disabled=${tece}>${tece ? t("Sending...") : t("Send")}</button>
        <button type="button" class="gumb-siv" onClick=${() => setIzbran(null)}>${t("Cancel")}</button>`
    : html`
      <div class="nakup-dogodek"><strong>${v.event_title}</strong><span class="utisano">${v.club_name} · ${v.public_ref}</span>
        ${v.is_vip === true ? html`<${VipVrstica} v=${v} />` : null}</div>
      <p class="opomba">${opis}</p>
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <h3 class="nastavitev-naslov">${t("Choose a friend")}</h3>
      ${prijatelji === null ? html`<div class="nalaganje"><span class="vrtavka"></span></div>`
        : !prijatelji.length ? html`<p class="utisano">${t("No friends yet")}</p>`
        : prijatelji.map(f => html`<button type="button" class="vrstica-obvestila" key=${f.id} onClick=${() => setIzbran({ user_id: f.id, ime: f.username })}>
            <${Avatar} url=${f.avatar_url} ime=${f.username} velikost=${40} /><span class="kv-besedilo"><strong>${f.username}</strong></span>
            <${Ikona} ime="send" velikost=${16} razred="utisano" /></button>`)}
      <h3 class="nastavitev-naslov">${t("Your friend's Outly email")}</h3>
      <form class="obrazec" onSubmit=${e => { e.preventDefault(); const m = email.trim().toLowerCase(); if (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(m)) setIzbran({ email: m, ime: m }); else setNapaka(t("Enter your friend's email address.")); }} novalidate>
        <label class="polje"><span class="skrito">${t("Your friend's Outly email")}</span>
          <input type="email" value=${email} placeholder="email@domain.com" onInput=${e => setEmail(e.target.value)} inputmode="email" autocomplete="off" /></label>
        <button type="submit" class="gumb-siv">${t("Continue")}</button>
      </form>`}
  <//>`;
}
