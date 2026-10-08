/* Dogodki kluba (BusinessEventsView), obrazec dogodka (EventFormView) in vstopnice dogodka (EventTicketsView).
   GET /business/events vrne VSE dogodke kluba (tudi osnutke in odpovedane), ki jih javni /events ne vraca.
   Cena se vnese v evrih, poslje v CENTIH kot celo stevilo (nikoli plavajoca vejica).
   Vstopnice dogodka so na spletu SAMO za ogled: vstop na vratih (skener, "Check in") je samo v aplikaciji Outly
   (Martin, 29. 9. 2026). */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, locale } from "../i18n.js";
import { naloziNaCloudinary, pomanjsajSliko } from "../api.js";
import { sporocilo } from "../napake.js";
import { navigiraj, nazaj } from "../usmerjanje.js";
import * as P from "../podatki.js";
import { zanrIme, napisCene, seJeKoncal, normalizirajDogodek } from "../oblika.js";
import { GlavaNazaj, Ikona, Slika, Nalaganje, List } from "../ui.js";
import { idKluba, poslovno, normalizirajDogodke, centiIz, evriBesedilo, NAJVEC_VIDEA } from "../posel.js";
import { PoslovnaNapaka } from "./posel.js";
import { skenirajVstopnico, naslovRezultata, opisRezultata } from "./posel-skener.js";
import { jeAktiven } from "../sken/okno.js";
import { VipVrstica, OznakaGuestList } from "../vip.js";
import { VipDogodka, RezervacijeVip } from "./posel-vip-dogodek.js";

const datumDogodka = d => (d ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "");

function stanje(e) {
  if (e.status === "cancelled") return { napis: t("Cancelled"), razred: "rdeca" };
  if (e.status === "draft") return { napis: t("Draft"), razred: "oranzna" };
  return seJeKoncal(e) ? { napis: t("Ended"), razred: "utisano" } : { napis: t("Upcoming"), razred: "zelena" };
}

/** Prihajajoci najprej (najblizji na vrhu), nato pretekli (najnovejsi na vrhu) - kot iOS. */
function uredi(seznam) {
  const zdaj = Date.now();
  const cas = e => (e._zacetek ? e._zacetek.getTime() : 0);
  const prihodnji = seznam.filter(e => cas(e) >= zdaj).sort((a, b) => cas(a) - cas(b));
  const pretekli = seznam.filter(e => cas(e) < zdaj).sort((a, b) => cas(b) - cas(a));
  return [...prihodnji, ...pretekli];
}

/* ---------- Seznam ---------- */
export function DogodkiKluba({ klub }) {
  const id = idKluba(klub);
  const [s, setS] = useState({ nalaga: true, napaka: null, dogodki: [] });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    poslovno(id, "/business/events")
      .then(r => setS({ nalaga: false, napaka: null, dogodki: uredi(normalizirajDogodke(r)) }))
      .catch(e => setS({ nalaga: false, napaka: e, dogodki: [] }));
  };
  useEffect(() => { if (id) nalozi(); }, [id]);
  const baza = `/app/business/${id}`;
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${baza} />
    <div class="naslov-z-gumbom">
      <h1 class="velik-naslov">${t("Events")}</h1>
      <a class="gumb-glavni majhen" href=${baza + "/events/new"}><${Ikona} ime="plus" velikost=${16} /> ${t("Add event")}</a>
    </div>
    ${!id ? html`<${PoslovnaNapaka} napaka=${{ status: 404 }} />` : null}
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !s.napaka && !s.dogodki.length ? html`<div class="prazno">
      <${Ikona} ime="calendar-plus" velikost=${34} razred="modra" />
      <strong>${t("No events yet")}</strong><span>${t("Tap \"Add event\" to publish your first one.")}</span></div>` : null}
    <div class="seznam">
      ${s.dogodki.map(e => {
        const st = stanje(e);
        return html`<a class="vrstica-dogodka-kluba" key=${e.id} href=${`${baza}/events/${e.id}/edit`}>
          <span class="vdk-slika">${e.poster_url ? html`<${Slika} src=${e.poster_url} sirina=${240} alt="" />` : html`<${Ikona} ime="image" velikost=${22} razred="utisano" />`}</span>
          <span class="kv-besedilo">
            <strong>${e.title}</strong>
            <span class="vdk-datum">${datumDogodka(e._zacetek)}</span>
            <span class="vdk-meta"><span class=${st.razred}>${st.napis}</span>
              ${e.ticket_price_cents != null || e.ticket_url ? html`<span>${napisCene(e)}</span>` : null}
              ${e.recap_video_url ? html`<span class="modra"><${Ikona} ime="square-play" velikost=${12} /> ${t("Video")}</span>`
                : e.recap_allowed ? html`<span><${Ikona} ime="upload" velikost=${12} /> ${t("Add video")}</span>` : null}</span>
          </span>
          <span class="povezava-modra">${t("Edit")}</span>
        </a>`;
      })}
    </div>
  </div>`;
}

/* ---------- Obrazec ---------- */
const vLokalno = d => {
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

export function ObrazecDogodka({ klub, dogodek }) {
  const id = idKluba(klub);
  const urejam = dogodek != null;
  const idDogodka = urejam ? idKluba(dogodek) : null;
  const baza = `/app/business/${id}`;
  const [obstojeci, setObstojeci] = useState(null);
  const [nalaga, setNalaga] = useState(urejam);
  const [napakaNalaganja, setNapakaNalaganja] = useState(null);
  const [vsiZanri, setVsiZanri] = useState(null);   // null = se nalaga / ni uspelo (glej naloziZanre)
  const [zanriNapaka, setZanriNapaka] = useState(false);
  const privzetZacetek = new Date(Date.now() + 7 * 24 * 3600e3);
  privzetZacetek.setSeconds(0, 0);
  const [p, setP] = useState({
    title: "", description: "", start: vLokalno(privzetZacetek), imaKonec: false,
    end: vLokalno(new Date(privzetZacetek.getTime() + 5 * 3600e3)), minAge: "18", genres: new Set(),
    price: "", capacity: "", ticketUrl: "", poster: "", objavljen: true
  });
  const [nalagaPlakat, setNalagaPlakat] = useState(false);
  const [nalagaVideo, setNalagaVideo] = useState(false);
  const [posnetek, setPosnetek] = useState("");
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [brisem, setBrisem] = useState(false);
  const vnosPlakat = useRef(null), vnosVideo = useRef(null);
  const nastavi = (k, v) => setP(x => ({ ...x, [k]: v }));

  const naloziZanre = () => { setZanriNapaka(false); P.zanri().then(setVsiZanri).catch(() => setZanriNapaka(true)); };
  useEffect(naloziZanre, []);
  const naloziDogodek = () => {
    setNalaga(true); setNapakaNalaganja(null);
    poslovno(id, "/business/events").then(r => {
      const e = normalizirajDogodke(r).find(x => x.id === idDogodka);
      if (!e) { setNapakaNalaganja({ status: 404 }); setNalaga(false); return; }
      setObstojeci(e);
      setPosnetek(e.recap_video_url || "");
      setP({
        title: e.title, description: e.description,
        start: e._zacetek ? vLokalno(e._zacetek) : vLokalno(privzetZacetek),
        imaKonec: !!e._konec, end: e._konec ? vLokalno(e._konec) : vLokalno(new Date((e._zacetek || privzetZacetek).getTime() + 5 * 3600e3)),
        minAge: String(e.min_age), genres: new Set(e.genres),
        price: e.ticket_price_cents != null ? evriBesedilo(e.ticket_price_cents) : "",
        capacity: e.capacity != null ? String(e.capacity) : "", ticketUrl: e.ticket_url || "",
        poster: e.poster_url, objavljen: e.status === "published"
      });
      setNalaga(false);
    }).catch(e => { setNapakaNalaganja(e); setNalaga(false); });
  };
  useEffect(() => { if (urejam && id && idDogodka) naloziDogodek(); }, [id, idDogodka]);

  const naslov = urejam ? t("Edit event") : t("New event");
  if (!id || (urejam && !idDogodka)) return html`<div class="zaslon"><${GlavaNazaj} naslov=${naslov} rezerva=${baza + "/events"} /><${PoslovnaNapaka} napaka=${{ status: 404 }} /></div>`;
  if (nalaga) return html`<div class="zaslon"><${GlavaNazaj} naslov=${naslov} rezerva=${baza + "/events"} /><${Nalaganje} /></div>`;
  if (napakaNalaganja) return html`<div class="zaslon"><${GlavaNazaj} naslov=${naslov} rezerva=${baza + "/events"} />
    <${PoslovnaNapaka} napaka=${napakaNalaganja} znova=${naloziDogodek} rezerva=${baza + "/events"} /></div>`;

  async function izberiPlakat(ev) {
    const d = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!d) return;
    if (!/^image\//.test(d.type)) return setNapaka(t("Choose an image file."));
    setNalagaPlakat(true); setNapaka("");
    try { nastavi("poster", await naloziNaCloudinary(await pomanjsajSliko(d, 1600))); }
    catch (e) { setNapaka(sporocilo(e)); }
    setNalagaPlakat(false);
  }
  // Posnetek se shrani TAKOJ (loceno od Save): streznik ga sprejme samo na koncanem dogodku med prvimi tremi.
  async function shraniPosnetek(url) {
    setNapaka("");
    try { const e = normalizirajDogodek(await poslovno(id, `/events/${idDogodka}`, { method: "PATCH", body: { recapVideoUrl: url } })); setPosnetek(e.recap_video_url || ""); }
    catch (e) { setNapaka(sporocilo(e)); }
  }
  async function izberiVideo(ev) {
    const d = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!d) return;
    if (!/^video\//.test(d.type)) return setNapaka(t("Choose a video file."));
    if (d.size > NAJVEC_VIDEA) return setNapaka(t("The video is larger than 100 MB. Please pick a shorter one."));
    setNalagaVideo(true); setNapaka("");
    try { await shraniPosnetek(await naloziNaCloudinary(d, "video")); }
    catch (e) { setNapaka(sporocilo(e)); }
    setNalagaVideo(false);
  }

  async function shrani() {
    setNapaka("");
    const title = p.title.trim();
    if (!title) return setNapaka(t("Enter a title."));
    const zacetek = new Date(p.start);
    if (!p.start || Number.isNaN(zacetek.getTime())) return setNapaka(t("Enter a valid start date."));
    const konec = p.imaKonec ? new Date(p.end) : null;
    if (p.imaKonec && (!p.end || Number.isNaN(konec.getTime()))) return setNapaka(t("Enter a valid end date."));
    if (konec && konec < zacetek) return setNapaka(t("End time must be after start time."));
    const starost = Number(p.minAge);
    if (!/^\d{1,2}$/.test(p.minAge.trim()) || starost < 0 || starost > 99) return setNapaka(t("Minimum age must be between 0 and 99."));
    const centi = centiIz(p.price);
    if (centi === undefined) return setNapaka(t("Enter the price as a number, e.g. 12.50."));
    const url = p.ticketUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) return setNapaka(t("Ticket link must start with http:// or https://."));
    let kapaciteta = null;
    if (p.capacity.trim()) {
      kapaciteta = Number(p.capacity.trim());
      if (!/^\d+$/.test(p.capacity.trim()) || kapaciteta < 1 || kapaciteta > 100000) return setNapaka(t("Capacity must be a whole number between 1 and 100000."));
    }
    const body = {
      title, description: p.description, startAt: zacetek.toISOString(), endAt: konec ? konec.toISOString() : null,
      // Brez nalozenega seznama zanrov obdrzimo izbrane (sicer bi PATCH zanre izbrisal).
      minAge: starost, genres: vsiZanri ? vsiZanri.filter(g => p.genres.has(g)) : [...p.genres],
      status: obstojeci && obstojeci.status === "cancelled" ? "cancelled" : (p.objavljen ? "published" : "draft"),
      currency: "EUR", ticketUrl: url, posterUrl: p.poster, ticketPriceCents: centi, capacity: kapaciteta
    };
    setShranjujem(true);
    try {
      if (urejam) await poslovno(id, `/events/${idDogodka}`, { method: "PATCH", body });
      else await poslovno(id, "/events", { method: "POST", body: { ...body, clubId: id } });
      navigiraj(baza + "/events", { zamenjaj: true });
    } catch (e) { setNapaka(sporocilo(e)); setShranjujem(false); }
  }
  async function izbrisi() {
    setBrisem(false); setShranjujem(true); setNapaka("");
    try { await poslovno(id, `/events/${idDogodka}`, { method: "DELETE" }); navigiraj(baza + "/events", { zamenjaj: true }); }
    catch (e) { setNapaka(sporocilo(e)); setShranjujem(false); }
  }

  const koncan = obstojeci && seJeKoncal(obstojeci);
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${naslov} rezerva=${baza + "/events"} />
    <div class="obrazec-dogodka">
      <fieldset><legend>${t("Event")}</legend>
        <label class="polje-oznaceno">${t("Title")}<input value=${p.title} maxlength="120" onInput=${e => nastavi("title", e.target.value)} /></label>
        <label class="polje-oznaceno">${t("Description")}<textarea rows="4" maxlength="4000" value=${p.description} onInput=${e => nastavi("description", e.target.value)}></textarea></label>
      </fieldset>
      <fieldset><legend>${t("When")}</legend>
        <label class="polje-oznaceno">${t("Starts")}<input type="datetime-local" value=${p.start} onInput=${e => nastavi("start", e.target.value)} /></label>
        <label class="stikalo-vrstica"><span class="kv-besedilo"><strong>${t("Has end time")}</strong></span>
          <input type="checkbox" role="switch" class="stikalo" checked=${p.imaKonec} onChange=${e => nastavi("imaKonec", e.target.checked)} /></label>
        ${p.imaKonec ? html`<label class="polje-oznaceno">${t("Ends")}<input type="datetime-local" value=${p.end} min=${p.start} onInput=${e => nastavi("end", e.target.value)} /></label>` : null}
      </fieldset>
      <fieldset><legend>${t("Who")}</legend>
        <label class="polje-oznaceno">${t("Minimum age")}<input type="number" inputmode="numeric" min="0" max="99" value=${p.minAge} onInput=${e => nastavi("minAge", e.target.value)} /></label>
        ${vsiZanri && vsiZanri.length ? html`<div class="mreza-cipov" role="group" aria-label=${t("Music genres")}>${vsiZanri.map(g => html`<button type="button" class=${"cip" + (p.genres.has(g) ? " izbran" : "")} aria-pressed=${p.genres.has(g)}
          onClick=${() => setP(x => { const n = new Set(x.genres); n.has(g) ? n.delete(g) : n.add(g); return { ...x, genres: n }; })}>${zanrIme(g)}</button>`)}</div>`
          : zanriNapaka ? html`<button type="button" class="povezava-gumb" onClick=${naloziZanre}>${t("Could not load genres.")} ${t("Try again")}</button>`
          : html`<span class="opomba">${t("Loading genres...")}</span>`}
      </fieldset>
      <fieldset><legend>${t("Tickets")}</legend>
        <label class="polje-oznaceno">${t("Price (EUR)")}<input inputmode="decimal" placeholder="0.00" value=${p.price} onInput=${e => nastavi("price", e.target.value)} /></label>
        <span class="opomba">${t("Leave empty if tickets are not sold on Outly. 0 = free entry.")}</span>
        <label class="polje-oznaceno">${t("Capacity")}<input inputmode="numeric" placeholder=${t("unlimited")} value=${p.capacity} onInput=${e => nastavi("capacity", e.target.value)} /></label>
        <span class="opomba">${t("Number of tickets available. Shows “N left” and “Sold out” to guests.")}</span>
        <label class="polje-oznaceno">${t("External ticket link (optional)")}<input type="url" inputmode="url" placeholder="https://" value=${p.ticketUrl} onInput=${e => nastavi("ticketUrl", e.target.value)} /></label>
      </fieldset>
      <fieldset><legend>${t("Poster")}</legend>
        <div class="vrsta-plakat">
          ${p.poster ? html`<span class="vdk-slika"><${Slika} src=${p.poster} sirina=${240} alt=${t("Poster")} /></span>` : null}
          <button type="button" class="gumb-siv majhen" disabled=${nalagaPlakat} onClick=${() => vnosPlakat.current && vnosPlakat.current.click()}>
            ${nalagaPlakat ? t("Uploading...") : p.poster ? t("Change poster") : t("Choose poster")}</button>
          <input ref=${vnosPlakat} type="file" accept="image/*" class="skrito" onChange=${izberiPlakat} tabindex="-1" aria-hidden="true" />
        </div>
      </fieldset>
      ${koncan ? html`<fieldset><legend>${t("Event video")}</legend>
        ${obstojeci.recap_allowed ? html`
          <div class="vrsta-plakat">
            ${posnetek ? html`<${Ikona} ime="circle-check" velikost=${20} razred="modra" />` : null}
            <button type="button" class="gumb-siv majhen" disabled=${nalagaVideo} onClick=${() => vnosVideo.current && vnosVideo.current.click()}>
              ${nalagaVideo ? t("Uploading...") : posnetek ? t("Replace video") : t("Upload video")}</button>
            <input ref=${vnosVideo} type="file" accept="video/*" class="skrito" onChange=${izberiVideo} tabindex="-1" aria-hidden="true" />
          </div>
          <span class="opomba">${t("Guests see this video instead of the poster on your club page, so they can see how it was. Up to 100 MB.")}</span>
          ${posnetek ? html`<button type="button" class="povezava-gumb rdeca" onClick=${() => shraniPosnetek("")}>${t("Remove video")}</button>` : null}`
        : html`<span class="opomba">${t("Only your three most popular past events can have a video. This keeps your club page fast to open.")}</span>`}
      </fieldset>` : null}
      <fieldset><legend>${t("Visibility")}</legend>
        <label class="stikalo-vrstica"><span class="kv-besedilo"><strong>${t("Published (visible to everyone)")}</strong></span>
          <input type="checkbox" role="switch" class="stikalo" checked=${p.objavljen} onChange=${e => nastavi("objavljen", e.target.checked)} /></label>
        ${obstojeci && obstojeci.status === "cancelled" ? html`<p class="napaka-besedilo">${t("This event is cancelled.")}</p>` : null}
      </fieldset>
      ${urejam && obstojeci ? html`<${VipDogodka} klub=${id} dogodek=${idDogodka} />` : null}
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button type="button" class="gumb-glavni" onClick=${shrani} disabled=${shranjujem || nalagaPlakat || !p.title.trim()}>${shranjujem ? t("Saving...") : t("Save")}</button>
      ${urejam ? html`<button type="button" class="gumb-rdec" disabled=${shranjujem} onClick=${() => setBrisem(true)}>${t("Cancel or delete event")}</button>` : null}
    </div>
    <${List} odprt=${brisem} zapri=${() => setBrisem(false)} naslov=${t("Remove this event?")}>
      <p class="besedilo-opis">${t("If tickets were already sold, the event will be cancelled instead of deleted so buyers keep proof of purchase.")}</p>
      <button type="button" class="gumb-rdec" onClick=${izbrisi}>${t("Delete event")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setBrisem(false)}>${t("Keep event")}</button>
    <//>
  </div>`;
}

/* ---------- Vstopnice dogodka + rocni "Check in" (iOS EventTicketsView) ---------- */
export function VstopniceDogodkaKluba({ klub, dogodek }) {
  const id = idKluba(klub);
  const idDogodka = idKluba(dogodek);
  const [s, setS] = useState({ nalaga: true, napaka: null, vstopnice: [], naslov: "", dogodek: null });
  const [delujoc, setDelujoc] = useState(null);
  const [zadnji, setZadnji] = useState(null);   // zadnji odgovor skenerja (pasica nad seznamom)
  const [vstopi, setVstopi] = useState(0);   // stevec rocnih vstopov: osvezi "prisli X/N" pri VIP rezervacijah
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: !x.vstopnice.length, napaka: null }));
    return Promise.all([
      poslovno(id, `/business/events/${idDogodka}/tickets`),
      poslovno(id, "/business/events").catch(() => [])
    ]).then(([v, dogodki]) => {
      const e = (Array.isArray(dogodki) ? dogodki : []).find(x => x.id === idDogodka);
      // Obdrzimo samo, kar rabimo: podpisan QR za rocni vstop (kot iOS), brez celotne serijske in e-naslovov.
      const vstopnice = (Array.isArray(v) ? v : []).map(x => ({ id: x.id, status: x.status, qr: typeof x.qr === "string" ? x.qr : "",
        public_ref: x.public_ref || "", kratka: String(x.serial || "").slice(0, 8).toUpperCase(),
        is_vip: x.is_vip === true, table_label: x.table_label || "", package_name: x.package_name || "",
        is_guest_list: x.is_guest_list === true, guest_list_host_username: x.guest_list_host_username || "" }));
      setS({ nalaga: false, napaka: null, vstopnice, naslov: e ? e.title : "", dogodek: e ? { start_at: e.start_at, end_at: e.end_at, status: e.status } : null });
    }).catch(e => setS(x => ({ ...x, nalaga: false, napaka: e })));
  };
  useEffect(() => { if (id && idDogodka) nalozi(); }, [id, idDogodka]);

  async function vstop(v) {
    // Isto casovno okno kot skener (okno.js): rocni vstop samo za aktiven dogodek (12 h pred zacetkom do 6 h po koncu).
    if (s.dogodek && !jeAktiven(s.dogodek)) { setZadnji({ result: "not_today", message: "This ticket is not for today's event." }); return; }
    setDelujoc(v.id); setZadnji(null);
    try {
      const r = await skenirajVstopnico(id, v.qr);
      setZadnji(r);
      // Takoj oznacimo lokalno (ce osvezitev seznama pade, gumb ne ostane).
      if (r.result === "ok" || r.result === "already_used") setS(x => ({ ...x, vstopnice: x.vstopnice.map(y => (y.id === v.id ? { ...y, status: "used" } : y)) }));
      await nalozi();
      setVstopi(n => n + 1);
    }
    catch (e) { setZadnji({ napaka: sporocilo(e) }); }
    finally { setDelujoc(null); }
  }

  const rezerva = `/app/business/${id}/dashboard`;
  if (!id || !idDogodka) return html`<div class="zaslon"><${GlavaNazaj} rezerva=${rezerva} /><${PoslovnaNapaka} napaka=${{ status: 404 }} /></div>`;
  const noter = s.vstopnice.filter(v => v.status === "used").length;
  const ok = zadnji && zadnji.result === "ok";
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${rezerva} />
    <h1 class="velik-naslov">${s.naslov || t("Tickets")}</h1>
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${s.napaka} znova=${nalozi} rezerva=${rezerva} />
    ${!s.nalaga && !s.napaka ? html`
      <div class="tri-stevilke">
        <div><strong>${s.vstopnice.length}</strong><span>${t("sold")}</span></div>
        <div><strong>${noter}</strong><span>${t("checked in")}</span></div>
        <div><strong>${s.vstopnice.length - noter}</strong><span>${t("expected")}</span></div>
      </div>
      <a class="gumb-siv" href=${`/app/business/${id}/scan?dogodek=${idDogodka}`}><${Ikona} ime="scan-line" velikost=${18} />${t("Scan tickets")}</a>
      <div aria-live="polite">${zadnji ? html`<div class=${"skener-pasica " + (ok ? "ok" : "ne")}>
        <${Ikona} ime=${ok ? "circle-check" : "circle-x"} velikost=${20} razred=${ok ? "zelena-besedilo" : "rdeca-besedilo"} />
        <span class="kv-besedilo"><strong>${zadnji.napaka ? t("Could not check the ticket") : naslovRezultata(zadnji.result)}</strong>
          <span>${zadnji.napaka || opisRezultata(zadnji)}</span></span>
        ${zadnji.ticket && zadnji.ticket.is_vip === true ? html`<div class="skener-vip"><${VipVrstica} v=${zadnji.ticket} velika=${true} /></div>` : null}
        ${zadnji.ticket && zadnji.ticket.is_guest_list === true ? html`<div class="skener-vip"><${OznakaGuestList} v=${zadnji.ticket} skener=${true} /></div>` : null}</div>` : null}</div>
      <${RezervacijeVip} klub=${id} dogodek=${idDogodka} osvezi=${vstopi} />
      <h2 class="podnaslov">${t("Door check-in")}</h2>
      ${!s.vstopnice.length ? html`<p class="opomba srednje">${t("No tickets sold for this event yet.")}</p>` : html`<div class="seznam">
        ${s.vstopnice.map(v => {
          const noterJe = v.status === "used";
          return html`<div class="vrstica-vstopnice" key=${v.id}>
            <span class="kv-besedilo"><strong class="mono">${v.kratka}</strong><span>${v.public_ref || ""}</span>
              ${v.is_vip ? html`<${VipVrstica} v=${v} />` : null}
              ${v.is_guest_list ? html`<${OznakaGuestList} v=${v} skener=${true} />` : null}</span>
            ${noterJe || !v.qr
              ? html`<span class=${"oznaka-vstopa" + (noterJe ? " noter" : "")}>${noterJe ? t("IN") : t("Not yet")}</span>`
              : html`<button type="button" class="gumb-vstopa" disabled=${delujoc !== null} onClick=${() => vstop(v)}
                  aria-label=${t("Check in") + " " + v.kratka}>
                  ${delujoc === v.id ? html`<span class="vrtavka majhna" aria-hidden="true"></span>` : t("Check in")}</button>`}
          </div>`;
        })}
      </div>`}
      <p class="opomba">${t("The QR on each ticket is signed by the server; scanning it twice is refused. Use Scan tickets in your profile for the camera scanner.")}</p>` : null}
  </div>`;
}
