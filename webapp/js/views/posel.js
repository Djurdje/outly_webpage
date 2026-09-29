/* Poslovni obraz (faza 4): profil lastnika (OwnerProfileView), prvi klub (ClubSetupView), nastavitve lastnika
   (OwnerSettingsView), klub, v katerem delam (MyClubDetailView), podatki kluba (ClubInfoView), cenik bara
   (BarPricesEditorView) in lokacija kluba. Vloge uveljavlja streznik (403); tu je samo drug obraz.
   QR skener vstopnic je v posel-skener.js (/app/business/:klub/scan) - za vse vloge v klubu, tudi vratarja.
   Lokacijo kluba iOS izracuna iz naslova (CLGeocoder); splet geokoderja nima (brez tujih streznikov), zato
   lastnik klub oznaci s klikom na zemljevid (odlocitev 29. 9. 2026). */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send, naloziNaCloudinary, pomanjsajSliko } from "../api.js";
import { sporocilo } from "../napake.js";
import { useSeja, naloziMe, odjava } from "../seja.js";
import { navigiraj, nazaj } from "../usmerjanje.js";
import * as P from "../podatki.js";
import { zanrIme } from "../oblika.js";
import { naloziKnjiznice, slog, povecavaZa, SLOVENIJA, LJUBLJANA } from "../karta.js";
import { GlavaNazaj, Ikona, Slika, Nalaganje, Napaka, List } from "../ui.js";
import { MenijskaVrstica } from "./racun.js";
import { VrsticaNamestitve } from "./namestitev.js";
import { imeVloge, lahkoUreja, idKluba, poslovno, useKlub, nastaviObraz, centiIz, evriBesedilo, NAJVEC_VIDEA } from "../posel.js";

/* ---------- skupni deli ---------- */
export function LogoKluba({ url, velikost = 60 }) {
  return html`<span class="logo-kluba" style=${{ width: velikost + "px", height: velikost + "px" }}>
    ${url ? html`<${Slika} src=${url} sirina=${velikost * 3} alt="" />` : html`<${Ikona} ime="building" velikost=${Math.round(velikost / 3)} />`}
  </span>`;
}

/** Napaka poslovnega klica: 404 = klub se ni ustvarjen / ni vec moj; 403 = vloga ne dovoli. */
export function PoslovnaNapaka({ napaka, znova, rezerva = "/app/profile" }) {
  if (!napaka) return null;
  const s = napaka.status;
  if (s === 404 || s === 403) return html`<div class="prazno">
    <${Ikona} ime="building" velikost=${34} razred="modra" />
    <strong>${s === 404 ? t("This club is not available.") : t("You do not have permission to do that.")}</strong>
    <a class="gumb-siv" href=${rezerva}>${t("Back")}</a></div>`;
  return html`<${Napaka} besedilo=${sporocilo(napaka)} znova=${znova} />`;
}

/** Orodja kluba (plosca, dogodki, ekipa, podatki) so za lastnika in managerja. Vratar dobi sporocilo brez klicev
    (streznik bi mu tako ali tako vrnil 403; GET /business/events bi mu sicer pokazal osnutke). Ce klub ni v
    me.clubs (npr. admin), odloci streznik. */
export function SamoUredniki({ klub, children }) {
  const me = useSeja(s => s.me);
  const c = me && Array.isArray(me.clubs) ? me.clubs.find(x => Number(x.club_id) === idKluba(klub)) : null;
  if (c && !lahkoUreja(c.role)) return html`<div class="zaslon"><${GlavaNazaj} rezerva=${"/app/business/" + idKluba(klub)} />
    <${PoslovnaNapaka} napaka=${{ status: 403 }} rezerva=${"/app/business/" + idKluba(klub)} /></div>`;
  return children;
}

/* ---------- Profil lastnika (vloga business, obraz "club") ---------- */
export function LastnikProfil({ me }) {
  const lastnistvo = (Array.isArray(me.clubs) ? me.clubs : []).find(k => k.role === "owner");
  const [s, setS] = useState({ nalaga: true, napaka: null, klub: null, brezKluba: false });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    // Brez glave: streznik vzame lastnikov klub (klubUporabnika). 404/403 = lastnik se nima kluba.
    send("/business/clubs/me", { auth: true, klub: lastnistvo ? lastnistvo.club_id : undefined })
      .then(k => setS({ nalaga: false, napaka: null, klub: k, brezKluba: false }))
      .catch(e => setS({ nalaga: false, napaka: e.status === 404 || e.status === 403 ? null : e, klub: null, brezKluba: e.status === 404 || e.status === 403 }));
  };
  useEffect(() => { nalozi(); }, []);
  const k = s.klub;
  const baza = k ? `/app/business/${k.id}` : null;

  return html`<div class="zaslon profil">
    <h1 class="skrito">${t("Profile")}</h1>
    ${s.brezKluba ? html`<${NastavitevKluba} ob=${() => { naloziMe(); nalozi(); }} />` : html`
      <div class="profil-vrsta">
        <${LogoKluba} url=${k && k.logo_url} velikost=${60} />
        <div class="kv-besedilo"><strong class="profil-ime">${k ? k.name : s.nalaga ? t("Loading...") : t("Your club")}</strong>
          ${baza ? html`<a class="povezava-modra" href=${baza + "/info"}>${t("Edit your page")}</a>` : null}</div>
      </div>
      <${Napaka} besedilo=${s.napaka ? sporocilo(s.napaka) : ""} znova=${nalozi} />
      ${baza ? html`<div class="seznam-kartica">
        <${MenijskaVrstica} href=${baza + "/dashboard"} ikona="chart-column" naslov=${t("Dashboard")} />
        <${MenijskaVrstica} href=${baza + "/events"} ikona="calendar" naslov=${t("Events")} />
        <${MenijskaVrstica} href=${baza + "/scan"} ikona="scan-line" naslov=${t("Scan tickets")} />
        <${MenijskaVrstica} href=${baza + "/team"} ikona="users" naslov=${t("My team")} />
        <${MenijskaVrstica} href=${baza + "/settings"} ikona="settings" naslov=${t("Settings")} />
      </div>
      <${VrsticaNamestitve} />` : null}`}
    <button type="button" class="povezava-gumb rdeca" onClick=${async () => { await odjava(); navigiraj("/app", { zamenjaj: true }); }}>${t("Log out")}</button>
  </div>`;
}

/* ---------- Nastavitve lastnika ---------- */
export function NastavitveLastnika({ klub }) {
  const id = idKluba(klub);
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Settings")} rezerva="/app/profile" />
    <div class="seznam-kartica">
      <${MenijskaVrstica} href=${`/app/business/${id}/info`} ikona="user" naslov=${t("Club info")} />
      <${MenijskaVrstica} href="/app/account/security" ikona="lock" naslov=${t("Password and security")} />
      <${MenijskaVrstica} ikona="arrow-left-right" naslov=${t("Switch to personal account")}
        onClick=${() => { nastaviObraz("personal"); navigiraj("/app/profile", { zamenjaj: true }); }} />
    </div>
    <p class="opomba">${t("Your personal account has tickets, friends and preferences. You can switch back any time in My Account.")}</p>
  </div>`;
}

/* ---------- Prvi klub (sveze odobren lastnik) ---------- */
const STAROSTI = [0, 16, 18, 21];
export function NastavitevKluba({ ob }) {
  const [ime, setIme] = useState("");
  const [naslov, setNaslov] = useState("");
  const [mesto, setMesto] = useState("");
  const [starost, setStarost] = useState(18);
  const [vsiZanri, setVsiZanri] = useState(null);
  const [zanri, setZanri] = useState(new Set());
  const [logo, setLogo] = useState("");
  const [lokacija, setLokacija] = useState(null);
  const [nalagam, setNalagam] = useState(false);
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState("");
  const vnos = useRef(null);
  const naloziZanre = () => { setVsiZanri(null); P.zanri().then(setVsiZanri).catch(() => setVsiZanri([])); };
  useEffect(naloziZanre, []);
  const lahko = ime.trim() && mesto.trim() && !shranjujem && !nalagam;

  async function izberiLogo(ev) {
    const d = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!d) return;
    if (!/^image\//.test(d.type)) return setNapaka(t("Choose an image file."));
    setNalagam(true); setNapaka("");
    try { setLogo(await naloziNaCloudinary(await pomanjsajSliko(d, 800))); }
    catch (e) { setNapaka(sporocilo(e)); }
    setNalagam(false);
  }
  async function ustvari() {
    setShranjujem(true); setNapaka("");
    const body = { name: ime.trim(), logoUrl: logo, address: naslov.trim(), city: mesto.trim(), minAge: starost, genres: [...zanri].sort() };
    if (lokacija) { body.lat = lokacija.lat; body.lng = lokacija.lng; }
    try { await send("/clubs", { method: "POST", body, auth: true }); ob(); return; }
    catch (e) {
      if (e.status === -1) {
        // Odgovor se je izgubil - klub je morda ze nastal. Ponovni klik bi ustvaril drugega.
        try { await send("/business/clubs/me", { auth: true }); ob(); return; } catch { /* kluba ni - pokazemo napako */ }
      }
      setNapaka(sporocilo(e)); setShranjujem(false);
    }
  }

  return html`<div class="obrazec-kluba">
    <div><h1 class="velik-naslov">${t("Set up your club")}</h1>
      <p class="besedilo-opis">${t("Just the basics to put your club on Outly. You can add photos, prices and more later.")}</p></div>
    <div class="vrsta-logo">
      <button type="button" class="logo-gumb" onClick=${() => vnos.current && vnos.current.click()} disabled=${nalagam} aria-label=${t("Club logo")}>
        ${logo ? html`<${LogoKluba} url=${logo} velikost=${84} />` : html`<span class="logo-kluba prazen" style=${{ width: "84px", height: "84px" }}><${Ikona} ime="camera" velikost=${22} /></span>`}
      </button>
      <input ref=${vnos} type="file" accept="image/*" class="skrito" onChange=${izberiLogo} tabindex="-1" aria-hidden="true" />
      <span class="kv-besedilo"><strong>${t("Club logo")}</strong><span>${nalagam ? t("Uploading...") : t("Square image works best. Optional.")}</span></span>
    </div>
    <label class="polje-oznaceno">${t("Club name")}<input value=${ime} maxlength="80" placeholder=${t("e.g. Klub K4")} onInput=${e => setIme(e.target.value)} /></label>
    <label class="polje-oznaceno">${t("Address")}<input value=${naslov} maxlength="120" placeholder=${t("Street and number")} autocomplete="street-address" onInput=${e => setNaslov(e.target.value)} /></label>
    <label class="polje-oznaceno">${t("City")}<input value=${mesto} maxlength="60" placeholder=${t("e.g. Ljubljana")} autocomplete="address-level2" onInput=${e => setMesto(e.target.value)} /></label>
    <div class="skupina-polj"><span class="oznaka-polja">${t("Location on the map")}</span>
      <${IzbiraLokacije} lat=${lokacija && lokacija.lat} lng=${lokacija && lokacija.lng} ob=${setLokacija} visina=${240} />
      <span class="opomba">${lokacija ? t("Location set. Drag the pin or tap elsewhere to move it.") : t("Tap the map where your club is. Without a location the club is not on the map.")}</span>
    </div>
    <div class="skupina-polj"><span class="oznaka-polja">${t("Minimum age")}</span>
      <div class="vrsta-izbir">${STAROSTI.map(a => html`<button type="button" class=${"cip" + (starost === a ? " izbran" : "")} aria-pressed=${starost === a} onClick=${() => setStarost(a)}>${a === 0 ? t("All ages") : a + "+"}</button>`)}</div>
    </div>
    <div class="skupina-polj"><span class="oznaka-polja">${t("Music genres")}</span>
      ${vsiZanri === null ? html`<${Nalaganje} />` : !vsiZanri.length
        ? html`<button type="button" class="povezava-gumb" onClick=${naloziZanre}>${t("Could not load genres.")} ${t("Try again")}</button>`
        : html`<div class="mreza-cipov">${vsiZanri.map(g => html`<button type="button" class=${"cip" + (zanri.has(g) ? " izbran" : "")} aria-pressed=${zanri.has(g)}
            onClick=${() => setZanri(z => { const n = new Set(z); n.has(g) ? n.delete(g) : n.add(g); return n; })}>${zanrIme(g)}</button>`)}</div>`}
    </div>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-glavni" onClick=${ustvari} disabled=${!lahko}>${shranjujem ? t("Saving...") : t("Create club")}</button>
  </div>`;
}

/* ---------- Klub, v katerem delam (My Clubs -> klub) ---------- */
export function SredisceKluba({ klub }) {
  const id = idKluba(klub);
  const me = useSeja(s => s.me);
  const k = useKlub(id);
  const [zapusti, setZapusti] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const clanstvo = me && Array.isArray(me.clubs) ? me.clubs.find(c => Number(c.club_id) === id) : null;
  const vloga = (clanstvo && clanstvo.role) || (k.klub && k.klub.my_role) || "";
  if (!id) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/my-clubs" /><${PoslovnaNapaka} napaka=${{ status: 404 }} rezerva="/app/my-clubs" /></div>`;
  const baza = `/app/business/${id}`;
  const ime = (k.klub && k.klub.name) || (clanstvo && clanstvo.club_name) || t("Your club");

  async function izstopi() {
    setZapusti(false); setTece(true); setNapaka("");
    try { await send("/business/team/me", { method: "DELETE", auth: true, klub: id }); await naloziMe(); navigiraj("/app/my-clubs", { zamenjaj: true }); }
    catch (e) { setNapaka(sporocilo(e)); setTece(false); }
  }

  if (k.napaka && k.napaka.status !== 403) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/my-clubs" />
    <${PoslovnaNapaka} napaka=${k.napaka} znova=${k.nalozi} rezerva="/app/my-clubs" /></div>`;
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva="/app/my-clubs" />
    <div class="poslovna-glava">
      <${LogoKluba} url=${(k.klub && k.klub.logo_url) || (clanstvo && clanstvo.club_logo_url)} velikost=${84} />
      <div class="kv-besedilo"><a class="profil-ime" href=${"/app/club/" + id}>${ime}</a>
        ${k.klub && k.klub.city ? html`<span>${k.klub.city}</span>` : null}
        ${vloga ? html`<span class="oznaka-vloge">${imeVloge(vloga)}</span>` : null}</div>
    </div>
    ${k.nalaga && !vloga ? html`<${Nalaganje} />` : null}
    ${lahkoUreja(vloga) ? html`<div class="seznam-kartica">
      <${MenijskaVrstica} href=${baza + "/info"} ikona="pencil" naslov=${t("Edit your page")} />
      <${MenijskaVrstica} href=${baza + "/dashboard"} ikona="chart-column" naslov=${t("Dashboard")} />
      <${MenijskaVrstica} href=${baza + "/events/new"} ikona="circle-plus" naslov=${t("Create event")} />
      <${MenijskaVrstica} href=${baza + "/events"} ikona="calendar" naslov=${t("View events")} />
      <${MenijskaVrstica} href=${baza + "/team"} ikona="users" naslov=${t("Team")} />
    </div>` : null}
    ${vloga ? html`<div class="seznam-kartica">
      <${MenijskaVrstica} href=${baza + "/scan"} ikona="scan-line" naslov=${t("Scan ticket")} />
    </div>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${vloga && vloga !== "owner" ? html`<button type="button" class="gumb-rdec" disabled=${tece} onClick=${() => setZapusti(true)}>${t("Leave the team")}</button>` : null}
    <${List} odprt=${zapusti} zapri=${() => setZapusti(false)} naslov=${t("Leave the team?")}>
      <p class="besedilo-opis">${t("You lose access to the club tools. The club can invite you again.")}</p>
      <button type="button" class="gumb-rdec" onClick=${izstopi}>${t("Leave team")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setZapusti(false)}>${t("Cancel")}</button>
    <//>
  </div>`;
}

/* ---------- Podatki kluba (Club info) ---------- */
const POLJA = {
  name: { ikona: "user", naslov: () => t("Club name"), opis: () => t("This is the official name of your club shown to users and on all published events."), najvec: 80 },
  contact_phone: { ikona: "phone", naslov: () => t("Phone number"), opis: () => t("This includes your club’s phone number used for customer inquiries and support."), najvec: 30, tip: "tel" },
  website: { ikona: "globe", naslov: () => t("Website"), opis: () => t("Your official website link."), najvec: 200, tip: "url" },
  contact_email: { ikona: "mail", naslov: () => t("Email"), opis: () => t("Email used for customer support and contact."), najvec: 120, tip: "email" },
  description: { ikona: "file-text", naslov: () => t("About club"), opis: () => t("Short description shown on your club page."), najvec: 1000, vec: true },
  address: { ikona: "map-pin", naslov: () => t("Address"), opis: () => t("Street and number shown on your club page."), najvec: 120 },
  city: { ikona: "building", naslov: () => t("City"), opis: () => t("Shown on your club page and used for search."), najvec: 60 }
};

/** Preveri vnos polja; vrne [vrednost, napaka]. */
function preveriPolje(polje, v) {
  v = v.trim();
  if (polje === "name" && !v) return [v, t("Enter the club name.")];
  if (polje === "website" && v) {
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw 0; }
    catch { return [v, t("Enter a valid web address, e.g. https://klub.si.")]; }
  }
  if (polje === "contact_email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return [v, t("Enter a valid email address.")];
  return [v, ""];
}

export function PodatkiKluba({ klub }) {
  const id = idKluba(klub);
  const k = useKlub(id);
  const [urejam, setUrejam] = useState(null);
  const [vrednost, setVrednost] = useState("");
  const [napakaUrejanja, setNapakaUrejanja] = useState("");
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [nalaga, setNalaga] = useState("");   // "logo" | "galerija" | "video"
  const vnosLogo = useRef(null), vnosGalerija = useRef(null), vnosVideo = useRef(null);
  const baza = `/app/business/${id}`;

  if (!id || k.napaka) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Club info")} rezerva="/app/profile" />
    <${PoslovnaNapaka} napaka=${k.napaka || { status: 404 }} znova=${k.nalozi} /></div>`;
  if (!k.klub) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Club info")} rezerva="/app/profile" /><${Nalaganje} /></div>`;
  const c = k.klub;

  async function posodobi(body) {
    setNapaka("");
    try { k.nastavi(await poslovno(id, "/business/clubs/me", { method: "PATCH", body })); return true; }
    catch (e) { setNapaka(sporocilo(e)); return false; }
  }
  // Odstranitev slike/videa: med shranjevanjem so gumbi onemogoceni (sicer dva hitra klika prepiseta drug drugega).
  async function odstrani(body) { setNalaga("shranjujem"); await posodobi(body); setNalaga(""); }
  async function shraniPolje() {
    const [v, nap] = preveriPolje(urejam, vrednost);
    if (nap) return setNapakaUrejanja(nap);
    setShranjujem(true); setNapakaUrejanja("");
    try { k.nastavi(await poslovno(id, "/business/clubs/me", { method: "PATCH", body: { [urejam]: v } })); setUrejam(null); }
    catch (e) { setNapakaUrejanja(sporocilo(e)); }
    setShranjujem(false);
  }
  async function izberiLogo(ev) {
    const d = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!d) return;
    if (!/^image\//.test(d.type)) return setNapaka(t("Choose an image file."));
    setNalaga("logo");
    try { await posodobi({ logo_url: await naloziNaCloudinary(await pomanjsajSliko(d, 800)) }); }
    catch (e) { setNapaka(t("Logo upload failed.") + " " + sporocilo(e)); }
    setNalaga("");
  }
  // Izbrane slike ZAMENJAJO slideshow (najvec 3), kot iOS.
  async function izberiGalerijo(ev) {
    const datoteke = [...(ev.target.files || [])].filter(d => /^image\//.test(d.type)).slice(0, 3); ev.target.value = "";
    if (!datoteke.length) return;
    setNalaga("galerija"); setNapaka("");
    try {
      const urls = [];
      for (const d of datoteke) urls.push(await naloziNaCloudinary(await pomanjsajSliko(d, 1600)));
      await posodobi({ gallery_urls: urls, video_url: c.video_url || "" });
    } catch (e) { setNapaka(t("Photo upload failed.") + " " + sporocilo(e)); }
    setNalaga("");
  }
  async function izberiVideo(ev) {
    const d = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!d) return;
    if (!/^video\//.test(d.type)) return setNapaka(t("Choose a video file."));
    if (d.size > NAJVEC_VIDEA) return setNapaka(t("The video is larger than 100 MB. Please pick a shorter one."));
    setNalaga("video"); setNapaka("");
    try { await posodobi({ gallery_urls: c.gallery_urls || [], video_url: await naloziNaCloudinary(d, "video") }); }
    catch (e) { setNapaka(t("Video upload failed.") + " " + sporocilo(e)); }
    setNalaga("");
  }
  const galerija = (c.gallery_urls || []).filter(Boolean);
  const odpri = polje => { setNapakaUrejanja(""); setVrednost(c[polje] || ""); setUrejam(polje); };
  const naKarti = c.lat != null && c.lng != null;

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Club info")} rezerva="/app/profile" />
    <div class="kartica-avatar">
      <button type="button" class="avatar-gumb" onClick=${() => vnosLogo.current && vnosLogo.current.click()} disabled=${!!nalaga} aria-label=${t("Change club logo")}>
        <${LogoKluba} url=${c.logo_url} velikost=${84} />
        <span class="avatar-plus"><${Ikona} ime="plus" velikost=${14} debelina=${3} /></span>
      </button>
      <input ref=${vnosLogo} type="file" accept="image/*" class="skrito" onChange=${izberiLogo} tabindex="-1" aria-hidden="true" />
      <span class="opomba srednje">${nalaga === "logo" ? t("Uploading...") : t("Add a profile photo so people can recognise you")}</span>
    </div>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${Object.entries(POLJA).map(([polje, p]) => html`<${KarticaPolja} key=${polje} ikona=${p.ikona} naslov=${p.naslov()}
      vrednost=${c[polje] || t("Not set")} opis=${p.opis()} gumb=${t("Edit")} ob=${() => odpri(polje)} />`)}
    <${KarticaPolja} ikona="map-pin" naslov=${t("Location on the map")}
      vrednost=${naKarti ? t("On the map") : t("Not on the map yet")}
      opis=${t("Guests find your club on the map and see how far it is.")} gumb=${naKarti ? t("Change") : t("Set on map")} href=${baza + "/location"} />
    <${KarticaPolja} ikona="images" naslov=${t("Slideshow")}
      vrednost=${galerija.length ? t("{n} of 3 photos", { n: galerija.length }) : t("No photos yet")}
      opis=${t("Up to 3 photos shown at the top of your club page (recommended 1200x800).")}
      gumb=${nalaga === "galerija" ? t("Uploading...") : t("Choose photos")} ob=${() => vnosGalerija.current && vnosGalerija.current.click()} onemogoceno=${!!nalaga} />
    <input ref=${vnosGalerija} type="file" accept="image/*" multiple class="skrito" onChange=${izberiGalerijo} tabindex="-1" aria-hidden="true" />
    ${galerija.length ? html`<div class="galerija-urejanje">${galerija.map((u, i) => html`<div class="galerija-slika" key=${u}>
      <${Slika} src=${u} sirina=${300} alt=${t("Photo {n}", { n: i + 1 })} />
      <button type="button" class="krog-gumb majhen" disabled=${!!nalaga} aria-label=${t("Remove photo {n}", { n: i + 1 })}
        onClick=${() => odstrani({ gallery_urls: galerija.filter((_, j) => j !== i), video_url: c.video_url || "" })}><${Ikona} ime="x" velikost=${14} /></button>
    </div>`)}</div>` : null}
    <${KarticaPolja} ikona="square-play" naslov=${t("Club video")}
      vrednost=${c.video_url ? t("Video uploaded") : t("No video yet")}
      opis=${t("Short intro video shown on your club page (up to 100 MB, plays muted in a loop).")}
      gumb=${nalaga === "video" ? t("Uploading...") : c.video_url ? t("Replace") : t("Upload")} ob=${() => vnosVideo.current && vnosVideo.current.click()} onemogoceno=${!!nalaga} />
    <input ref=${vnosVideo} type="file" accept="video/*" class="skrito" onChange=${izberiVideo} tabindex="-1" aria-hidden="true" />
    ${c.video_url ? html`<button type="button" class="povezava-gumb rdeca" disabled=${!!nalaga} onClick=${() => odstrani({ gallery_urls: galerija, video_url: "" })}>${t("Remove video")}</button>` : null}
    <${KarticaPolja} ikona="wine" naslov=${t("Bar prices")}
      vrednost=${c.bar_prices.length ? t("{n} items", { n: c.bar_prices.length }) : t("Not added yet")}
      opis=${t("Guests see the list under \"Bar prices\" on every event of your club.")} gumb=${t("Edit")} href=${baza + "/bar-prices"} />

    <${List} odprt=${!!urejam} zapri=${() => setUrejam(null)} naslov=${urejam ? POLJA[urejam].naslov() : ""}>
      ${urejam ? html`<label class="polje"><span class="skrito">${POLJA[urejam].naslov()}</span>
        ${POLJA[urejam].vec
          ? html`<textarea rows="6" maxlength=${POLJA[urejam].najvec} value=${vrednost} onInput=${e => setVrednost(e.target.value)}></textarea>`
          : html`<input type=${POLJA[urejam].tip || "text"} maxlength=${POLJA[urejam].najvec} value=${vrednost} onInput=${e => setVrednost(e.target.value)} />`}
      </label>` : null}
      ${napakaUrejanja ? html`<p class="napaka-besedilo" role="alert">${napakaUrejanja}</p>` : null}
      <button type="button" class="gumb-glavni" onClick=${shraniPolje} disabled=${shranjujem}>${shranjujem ? t("Saving...") : t("Save")}</button>
    <//>
  </div>`;
}

function KarticaPolja({ ikona, naslov, vrednost, opis, gumb, ob, href, onemogoceno }) {
  return html`<div class="kartica-podatka">
    <div class="kp-vrh"><${Ikona} ime=${ikona} velikost=${18} /><strong>${naslov}</strong>
      ${href ? html`<a class="povezava-modra" href=${href}>${gumb}</a>`
        : html`<button type="button" class="povezava-modra" onClick=${ob} disabled=${onemogoceno} aria-label=${gumb + " " + naslov}>${gumb}</button>`}</div>
    <span class="kp-vrednost">${vrednost}</span>
    ${opis ? html`<span class="opomba">${opis}</span>` : null}
  </div>`;
}

/* ---------- Lokacija kluba (klik na zemljevid) ---------- */
export function LokacijaKluba({ klub }) {
  const id = idKluba(klub);
  const k = useKlub(id);
  const [tocka, setTocka] = useState(null);
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [shranjeno, setShranjeno] = useState(false);
  if (!id || k.napaka) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Location on the map")} rezerva=${`/app/business/${id}/info`} />
    <${PoslovnaNapaka} napaka=${k.napaka || { status: 404 }} znova=${k.nalozi} /></div>`;
  if (!k.klub) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Location on the map")} rezerva=${`/app/business/${id}/info`} /><${Nalaganje} /></div>`;
  const c = k.klub;
  const zdaj = tocka || (c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null);

  async function shrani() {
    if (!tocka) return;
    setShranjujem(true); setNapaka("");
    try { k.nastavi(await poslovno(id, "/business/clubs/me", { method: "PATCH", body: { lat: tocka.lat, lng: tocka.lng } })); setTocka(null); setShranjeno(true); }
    catch (e) { setNapaka(sporocilo(e)); }
    setShranjujem(false);
  }
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Location on the map")} rezerva=${`/app/business/${id}/info`} />
    <p class="besedilo-opis">${t("Tap the map where the entrance to {club} is. You can drag the pin to adjust it.", { club: c.name })}</p>
    ${c.address || c.city ? html`<p class="opomba">${[c.address, c.city].filter(Boolean).join(", ")}</p>` : null}
    <${IzbiraLokacije} lat=${zdaj && zdaj.lat} lng=${zdaj && zdaj.lng} ob=${p => { setTocka(p); setShranjeno(false); }} visina=${360} />
    ${shranjeno ? html`<p class="uspeh-besedilo" role="status">${t("Location saved. Your club is on the map.")}</p>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-glavni" onClick=${shrani} disabled=${!tocka || shranjujem}>${shranjujem ? t("Saving...") : t("Save location")}</button>
  </div>`;
}

/** Zemljevid za izbiro tocke: klik postavi oznako, oznako se da povleci. Brez WebGL: vnos koordinat. */
export function IzbiraLokacije({ lat, lng, ob, visina = 300 }) {
  const posoda = useRef(null);
  const stanje = useRef({ m: null, K: null, oznaka: null });
  const obRef = useRef(ob);
  // Tocka z zemljevida gre tudi v polja koordinat (dostopnost: lokacijo se da vnesti brez miske).
  obRef.current = p => { setRocno({ lat: String(p.lat), lng: String(p.lng) }); ob(p); };
  const [brezKarte, setBrezKarte] = useState(false);
  const [rocno, setRocno] = useState({ lat: lat != null ? String(lat) : "", lng: lng != null ? String(lng) : "" });

  const postavi = (tocka, premakni) => {
    const s = stanje.current;
    if (!s.m) return;
    if (!s.oznaka) {
      const el = document.createElement("span");
      el.className = "oznaka-kluba";
      el.appendChild(Object.assign(document.createElement("span"), { className: "igla" }));
      s.oznaka = new s.K.maplibregl.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([tocka.lng, tocka.lat]).addTo(s.m);
      s.oznaka.on("dragend", () => { const p = s.oznaka.getLngLat(); obRef.current(zaokrozi(p.lat, p.lng)); });
    } else s.oznaka.setLngLat([tocka.lng, tocka.lat]);
    if (premakni) s.m.easeTo({ center: [tocka.lng, tocka.lat], duration: 400 });
  };

  useEffect(() => {
    let unicen = false;
    naloziKnjiznice().then(K => {
      if (unicen || !posoda.current) return;
      const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
      if (!gl) { setBrezKarte(true); return; }
      const sprosti = gl.getExtension("WEBGL_lose_context"); if (sprosti) sprosti.loseContext();
      const imaTocko = lat != null && lng != null;
      let m;
      try {
        m = new K.maplibregl.Map({
          container: posoda.current, style: slog(K), center: imaTocko ? [lng, lat] : LJUBLJANA,
          zoom: imaTocko ? Math.min(16, povecavaZa(lng, lat)) : 12,
          maxBounds: [[SLOVENIJA[0][0] - 1, SLOVENIJA[0][1] - 0.6], [SLOVENIJA[1][0] + 1, SLOVENIJA[1][1] + 0.6]],
          minZoom: 6.5, maxZoom: 18, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false
        });
      } catch { setBrezKarte(true); return; }
      m.touchZoomRotate.disableRotation();
      stanje.current = { m, K, oznaka: null };
      if (imaTocko) postavi({ lat, lng }, false);
      m.on("click", e => {
        // Klik na samo oznako (npr. pred vlecenjem) je ne premakne.
        const cilj = e.originalEvent && e.originalEvent.target;
        if (cilj && cilj.closest && cilj.closest(".oznaka-kluba")) return;
        const p = zaokrozi(e.lngLat.lat, e.lngLat.lng); postavi(p, false); obRef.current(p);
      });
    }).catch(() => { if (!unicen) setBrezKarte(true); });
    return () => { unicen = true; if (stanje.current.m) stanje.current.m.remove(); stanje.current = { m: null, K: null, oznaka: null }; };
  }, []);

  // Rocni vnos koordinat: vedno na voljo (tipkovnica, bralnik zaslona); brez WebGL edini nacin.
  const posodobi = (kljuc, v) => {
    const n = { ...rocno, [kljuc]: v };
    setRocno(n);
    const sa = n.lat.trim().replace(",", "."), sb = n.lng.trim().replace(",", ".");
    if (!/^-?\d{1,3}(\.\d+)?$/.test(sa) || !/^-?\d{1,3}(\.\d+)?$/.test(sb)) return;
    const a = Number(sa), b2 = Number(sb);
    if (Math.abs(a) > 90 || Math.abs(b2) > 180) return;
    const p = zaokrozi(a, b2);
    postavi(p, true);
    ob(p);
  };
  const polja = html`<div class="dve-polji">
    <label class="polje-oznaceno">${t("Latitude")}<input inputmode="decimal" value=${rocno.lat} placeholder="46.0514" onInput=${e => posodobi("lat", e.target.value)} /></label>
    <label class="polje-oznaceno">${t("Longitude")}<input inputmode="decimal" value=${rocno.lng} placeholder="14.5060" onInput=${e => posodobi("lng", e.target.value)} /></label>
  </div>`;
  if (brezKarte) return html`<div class="skupina-polj">
    <p class="opomba">${t("The map can't be shown in this browser. Enter the coordinates instead (e.g. from a maps app).")}</p>${polja}</div>`;
  return html`<div class="skupina-polj">
    <div class="izbira-lokacije" style=${{ height: visina + "px" }}>
      <div class="izbira-lokacije-platno" ref=${posoda} role="application" aria-label=${t("Map: tap to set the location of the club")}></div>
    </div>
    <details class="rocne-koordinate"><summary>${t("Enter coordinates instead")}</summary>${polja}</details>
  </div>`;
}
const zaokrozi = (lat, lng) => ({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });

/* ---------- Cenik bara ---------- */
const NAJVEC_POSTAVK = 60;
export function UrejanjeCenika({ klub }) {
  const id = idKluba(klub);
  const k = useKlub(id);
  const [vrstice, setVrstice] = useState(null);
  const [shranjujem, setShranjujem] = useState(false);
  const [napaka, setNapaka] = useState("");
  const stevec = useRef(0);
  const nova = (name = "", price = "", category = "") => ({ kljuc: ++stevec.current, name, price, category });
  useEffect(() => {
    if (k.klub && vrstice === null) setVrstice(k.klub.bar_prices.map(p => nova(p.name || "", evriBesedilo(p.price_cents || 0).replace(/\.00$/, ""), p.category || "")));
  }, [k.klub]);
  const rezerva = `/app/business/${id}/info`;
  if (!id || k.napaka) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Bar prices")} rezerva=${rezerva} />
    <${PoslovnaNapaka} napaka=${k.napaka || { status: 404 }} znova=${k.nalozi} /></div>`;
  if (!vrstice) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Bar prices")} rezerva=${rezerva} /><${Nalaganje} /></div>`;

  const spremeni = (kljuc, polje, v) => setVrstice(vs => vs.map(x => (x.kljuc === kljuc ? { ...x, [polje]: v } : x)));
  async function shrani() {
    setNapaka("");
    const postavke = [];
    for (const [i, v] of vrstice.entries()) {
      const name = v.name.trim(), cat = v.category.trim();
      if (!name && !v.price.trim()) continue;   // prazna vrstica se preskoci
      if (!name) return setNapaka(t("Item {n}: name is missing.", { n: i + 1 }));
      if (name.length > 60) return setNapaka(t("Item {n}: name is too long (max 60).", { n: i + 1 }));
      const c = centiIz(v.price, 1000);
      if (c == null) return setNapaka(t("Item {n} ({name}): enter a price like 4,50.", { n: i + 1, name }));
      postavke.push(cat ? { name, price_cents: c, category: cat.slice(0, 30) } : { name, price_cents: c });
    }
    setShranjujem(true);
    try { await poslovno(id, "/business/clubs/me", { method: "PATCH", body: { bar_prices: postavke } }); nazaj(rezerva); }
    catch (e) { setNapaka(sporocilo(e)); setShranjujem(false); }
  }
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Bar prices")} rezerva=${rezerva} />
    <p class="besedilo-opis">${t("Guests see this list on every event of your club. Category is optional (e.g. Beer, Cocktails).")}</p>
    ${vrstice.map((v, i) => html`<div class="vrstica-cenika" key=${v.kljuc}>
      <div class="vc-vrh">
        <label class="polje"><span class="skrito">${t("Item {n}", { n: i + 1 })}</span>
          <input value=${v.name} maxlength="60" placeholder=${t("Item (e.g. Beer 0.5 l)")} onInput=${e => spremeni(v.kljuc, "name", e.target.value)} /></label>
        <label class="polje vc-cena"><span class="skrito">${t("Price")}</span>
          <input value=${v.price} inputmode="decimal" placeholder="0,00" onInput=${e => spremeni(v.kljuc, "price", e.target.value)} /></label>
        <span class="utisano">€</span>
      </div>
      <div class="vc-vrh">
        <label class="polje"><span class="skrito">${t("Category (optional)")}</span>
          <input value=${v.category} maxlength="30" placeholder=${t("Category (optional)")} onInput=${e => spremeni(v.kljuc, "category", e.target.value)} /></label>
        <button type="button" class="krog-gumb majhen rdeca" aria-label=${t("Remove item {n}", { n: i + 1 })}
          onClick=${() => setVrstice(vs => vs.filter(x => x.kljuc !== v.kljuc))}><${Ikona} ime="trash" velikost=${16} /></button>
      </div>
    </div>`)}
    ${vrstice.length < NAJVEC_POSTAVK ? html`<button type="button" class="gumb-siv" onClick=${() => setVrstice(vs => [...vs, nova("", "", vs.length ? vs[vs.length - 1].category : "")])}>
      <${Ikona} ime="circle-plus" velikost=${18} /> ${t("Add item")}</button>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-glavni" onClick=${shrani} disabled=${shranjujem}>${shranjujem ? t("Saving...") : t("Save")}</button>
  </div>`;
}

