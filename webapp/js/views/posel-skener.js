/* QR skener vstopnic na vratih (iOS QRScannerView). Dodan 29. 9. 2026 (Martin): vratar z Androidom ne more
   namestiti aplikacije Outly, zato skener dela tudi v brskalniku. Dostop imajo vse vloge v klubu (tudi vratar).
   Od 1. 10. 2026 (issue Djurdje/outly-backend#86) skener dela TUDI BREZ POVEZAVE: vstopnice preveri telefon sam
   (jedro je v ../sken/motor.js - podpis Ed25519, seznam dogodka, trajna vrsta skenov, sinhronizacija), ta datoteka je
   samo izris in kamera. Vedno vidno: povezava da/ne, koliko skenov caka, cas zadnjega prenosa seznama.
   Kamera: getUserMedia (zadnja kamera). Dekodiranje: BarcodeDetector, kjer ga brskalnik ima (Chrome Android),
   sicer jsQR (vendor/, nalozi se leno). Slike kamere ostanejo na napravi - streznik dobi samo vsebino kode QR. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, locale } from "../i18n.js";
import { GlavaNazaj, Ikona } from "../ui.js";
import { idKluba } from "../posel.js";
import { useStore } from "../store.js";
import { danInUra, steviloDogodkov } from "../oblika.js";
import { VipVrstica, OznakaGuestList } from "../vip.js";
import { skenirajVstopnico, ustvariMotor } from "../sken/motor.js";
import { odpreSeOb } from "../sken/okno.js";

export { skenirajVstopnico };

export const naslovRezultata = r => {
  switch (r) {
    case "ok": return t("WELCOME IN");
    case "already_used": return t("ALREADY SCANNED");
    case "wrong_club": return t("WRONG CLUB");
    case "unknown": return t("UNKNOWN TICKET");
    case "unpaid": return t("NOT PAID");
    case "not_today": return t("NOT TODAY'S EVENT");
    default: return t("REFUSED");
  }
};

const uraMinute = d => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

/** Sporocilo streznika (angl.) -> prevod, ce ga imamo; used_at doda uro prvega skena. */
export function opisRezultata(r) {
  const deli = [t(String(r.message || ""))];
  if (r.result === "already_used" && r.used_at) {
    const d = new Date(r.used_at);
    if (!isNaN(d)) deli.push(t("Scanned at {cas}", { cas: uraMinute(d) }));
  }
  return deli.filter(Boolean).join(" ");
}

/* Sklep motorja -> besedilo. Barve: zelena (spusti), rdeca (ne spusti), rumena (ni odlocitve - potrebna povezava). */
function besedilaSklepa(s) {
  const kdaj = s.cas ? t("Scanned at {cas}", { cas: uraMinute(new Date(s.cas)) }) : t("This ticket was already used.");
  switch (s.tip) {
    case "dobrodosli": return [t("WELCOME IN"), s.imetnik ? t("Ticket holder: {ime}", { ime: s.imetnik }) : ""];
    case "dobrodosli-ni-na-seznamu": return [t("WELCOME IN"), s.brezSeznama
      ? t("The ticket list is not on this phone yet. The code is genuine; the server will check it as soon as you are online.")
      : t("Genuine code, but not on the list (maybe bought after the last download). The server checks it once you are online.")];
    case "ze-skenirano": return [t("ALREADY SCANNED"), kdaj];
    case "preneseno": return [t("TICKET TRANSFERRED"), t("The holder passed this ticket on and has a new code. Ask for the new one.")];
    case "vrnjeno": return [t("REFUNDED"), t("This ticket was refunded.")];
    case "preklicano": return [t("CANCELLED"), t("This ticket was cancelled.")];
    case "ne-danes": return [t("NOT TODAY'S EVENT"), t("This ticket is not for today's event.")];
    case "neveljavna": return [t("INVALID CODE"), t("The signature does not match. Outly did not issue this code.")];
    case "ni-vstopnica": return [t("NOT A TICKET"), t("This is not an Outly ticket code.")];
    case "neplacano": return [t("NOT PAID"), t("The order for this ticket is not paid.")];
    case "stara-potrebna-povezava": return [t("OLD CODE - CONNECTION NEEDED"), s.mogoceVpisana
      ? t("The server did not answer in time. The ticket may already be checked in: scan it again - if it says Already scanned with the time just now, let the guest in.")
      : t("This ticket was issued before offline scanning. Only the server can check it. Try again when the connection is back.")];
    case "potrebna-povezava": return [t("CONNECTION NEEDED"), s.mogoceVpisana
      ? t("The server did not answer in time. The ticket may already be checked in: scan it again - if it says Already scanned with the time just now, let the guest in.")
      : t("This phone cannot check the code yet. Connect once to download the key, then scan again.")];
    case "streznik": return [naslovRezultata(s.streznik.result), opisRezultata(s.streznik)];
    case "napaka": return [t("Could not check the ticket"), s.opis || ""];
    default: return [t("REFUSED"), ""];
  }
}

const RAZLOG_KONFLIKTA = {
  already_used: "Already scanned on another phone",
  transferred: "Ticket was transferred",
  refunded: "Ticket was refunded",
  void: "Ticket was cancelled",
  unpaid: "Order not paid",
  unknown: "Server does not know this ticket",
  wrong_club: "Ticket belongs to another club",
  invalid: "Code rejected by the server"
};

/* jsQR (~130 KB) samo, ce brskalnik nima BarcodeDetector (Safari, Firefox).
   M2 (pregled PR #24): dekodiranje sumne slike 1280 px traja ~1 s in bi blokiralo glavno nit (vrtavka, tipke, shranjevanje
   skenov). Zato jsQR tece v Web Workerju (webapp/js/sken/jsqr-delavec.js; modul, CSP worker-src 'self'). Ce delavca ni
   (starejsi brskalnik, napaka), jsQR tece na glavni niti, a samo na sredini slike (okvir, v polni locljivosti). */
let jsqr = null;
const naloziJsQR = () => (jsqr ||= import("/vendor/jsqr-1.4.0.mjs").then(m => m.default).catch(e => { jsqr = null; throw e; }));

function ustvariDelavca() {
  try {
    const d = new Worker("/webapp/js/sken/jsqr-delavec.js", { type: "module" });
    const cakajo = new Map();
    let st = 0, mrtev = false;
    const umri = () => { mrtev = true; try { d.terminate(); } catch { /* brez */ } for (const f of cakajo.values()) f(undefined); cakajo.clear(); };
    d.onmessage = e => { const f = cakajo.get(e.data && e.data.id); if (f) { cakajo.delete(e.data.id); f(e.data.koda); } };
    d.onerror = umri;
    return {
      beri: (data, w, h) => new Promise(ok => {
        if (mrtev) { ok(undefined); return; }
        const id = ++st;
        const rok = setTimeout(() => { cakajo.delete(id); umri(); ok(undefined); }, 6000);   // delavec obvisel: nazaj na glavno nit
        cakajo.set(id, v => { clearTimeout(rok); ok(v); });
        d.postMessage({ id, data, w, h }, [data.buffer]);
      }),
      ustavi: () => { if (!mrtev) umri(); }
    };
  } catch { return null; }
}

/** Bralnik kode QR iz <video>: { beri(video) -> Promise<niz|null>, ustavi() }. */
async function ustvariBralnik() {
  try {
    if ("BarcodeDetector" in window) {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (Array.isArray(f) && f.includes("qr_code")) {
        const d = new window.BarcodeDetector({ formats: ["qr_code"] });
        return { beri: async video => {
          const r = await d.detect(video);
          return r && r[0] && r[0].rawValue ? r[0].rawValue : null;
        }, ustavi() {} };
      }
    }
  } catch { /* pademo na jsQR */ }
  const platno = document.createElement("canvas");
  const ctx = platno.getContext("2d", { willReadFrequently: true });
  let delavec = ustvariDelavca();
  let beriGlavna = null;
  return {
    async beri(video) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      // Koda v2 (~210 znakov, 57 modulov) je gostejsa od stare v1 (~120): s pomanjsavo na 640 px jsQR kode v obicajni razdalji
      // ne prebere (preizkus 1. 10. 2026) - slike ne manjsamo pod 1280 px (toliko tudi zahtevamo od kamere).
      const k = Math.min(1, 1280 / Math.max(w, h));
      const sw = Math.round(w * k), sh = Math.round(h * k);
      if (delavec) {
        if (platno.width !== sw) platno.width = sw;
        if (platno.height !== sh) platno.height = sh;
        ctx.drawImage(video, 0, 0, sw, sh);
        const slika = ctx.getImageData(0, 0, sw, sh);
        const r = await delavec.beri(slika.data, sw, sh);
        if (r !== undefined) return r;        // null = brez kode, niz = koda
        delavec = null;                       // delavec odpovedal: ta in naslednji okvirji na glavni niti
      }
      // Glavna nit: samo sredina (okvir ~62 % vidnega polja + rob), v polni locljivosti.
      const stranica = Math.round(Math.min(sw, sh) * 0.75);
      const ox = Math.round((sw - stranica) / 2), oy = Math.round((sh - stranica) / 2);
      if (platno.width !== stranica) platno.width = stranica;
      if (platno.height !== stranica) platno.height = stranica;
      ctx.drawImage(video, ox / k, oy / k, stranica / k, stranica / k, 0, 0, stranica, stranica);
      const slika = ctx.getImageData(0, 0, stranica, stranica);
      beriGlavna ||= await naloziJsQR();
      const r = beriGlavna(slika.data, stranica, stranica, { inversionAttempts: "dontInvert" });
      return r && r.data ? r.data : null;
    },
    ustavi() { if (delavec) delavec.ustavi(); delavec = null; }
  };
}

const PREMOR = 200;   // ms med poskusi branja (varcuje baterijo na starejsih telefonih)

/** "pravkar", "pred 2 minutama" ... (jezik aplikacije). */
function kdajBesedilo(ms, zdaj) {
  const min = Math.max(0, Math.floor((zdaj - ms) / 60000));
  try {
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
    if (min < 1) return rtf.format(0, "second");
    if (min < 120) return rtf.format(-min, "minute");
    return rtf.format(-Math.floor(min / 60), "hour");
  } catch { return min < 1 ? "0 min" : `${min} min`; }
}

/* ---------- skener kluba (brez izbire dogodka) ----------
   Od 8. 10. 2026 (Martin) vratar dogodka NE izbira: motor sam ugotovi aktivne dogodke kluba (okno.js: 12 h pred zacetkom do
   6 h po koncu, tudi brez povezave iz shranjenih dogodkov in ure naprave), dogodek vstopnice pa se prebere iz kode QR.
   Povezava ?dogodek= (stari zaznamki, gumb pri vstopnicah dogodka) se ignorira. */

export function Skener({ klub }) {
  const id = idKluba(klub);
  const rezerva = id ? `/app/business/${id}` : "/app/profile";
  if (!id) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} /></div>`;
  return html`<${SkenerKluba} key=${id} klub=${id} rezerva=${rezerva} />`;
}

function SkenerKluba({ klub, rezerva }) {
  const [motor] = useState(() => ustvariMotor({ klub }));
  const ms = useStore(motor.stanje);
  const [zdaj, setZdaj] = useState(Date.now());
  useEffect(() => {
    motor.zacni();
    const ura = setInterval(() => setZdaj(Date.now()), 15000);
    return () => { clearInterval(ura); motor.ustavi(); };
  }, [motor]);

  if (!ms.dogodkiPripravljeni) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
    <div class="skener-stanje-prazno"><span class="vrtavka" aria-hidden="true"></span></div></div>`;
  if (!ms.aktivni.length) return html`<${NiDogodka} motor=${motor} ms=${ms} zdaj=${zdaj} rezerva=${rezerva} />`;
  return html`<${SkenerDogodkov} motor=${motor} ms=${ms} zdaj=${zdaj} rezerva=${rezerva} />`;
}

/* "No event right now": namesto izbire dogodka (+ naslednji dogodek, ce ga imamo). */
function NiDogodka({ motor, ms, zdaj, rezerva }) {
  const n = ms.naslednji;
  const naslov = n ? (n.title || t("Event {n}", { n: n.id })) : "";
  return html`<div class="zaslon skener-zaslon">
    <${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
    <div class="skener-glava"><${StatusVrstica} ms=${ms} motor=${motor} zdaj=${zdaj} brezSeznama=${true} /></div>
    <${UraOpozorilo} ms=${ms} />
    <div class="prazno" data-testid="ni-dogodka"><strong>${t("No event right now")}</strong>
      <p class="opomba">${t("Scanning opens 12 hours before the event starts.")}</p>
      ${n ? html`<p class="opomba" data-testid="naslednji">${t("Next: {naslov} · scanning from {cas}", { naslov, cas: danInUra(new Date(odpreSeOb(n))) })}</p>` : null}
      ${ms.dogodkiOmrezje === "napaka" ? html`<p class="opomba oranzna">${ms.dogodkov > 0 ? t("No connection - showing the events saved on this phone.") : t("Connect to the internet once to download the events.")}</p>` : null}
    </div>
    <button type="button" class="gumb-siv" disabled=${ms.nalagamDogodke} onClick=${() => motor.znovuNaloziDogodke()}>
      ${ms.nalagamDogodke ? html`<span class="vrtavka majhna" aria-hidden="true"></span>` : html`<${Ikona} ime="refresh-cw" velikost=${16} />`}${t("Reload events")}</button>
    <${Konflikti} ms=${ms} motor=${motor} />
  </div>`;
}

/* Ura telefona se razlikuje od strezniske (> 5 min): okno skeniranja bi bilo napacno. Samo opozorilo. */
function UraOpozorilo({ ms }) {
  return ms.uraNapacna ? html`<p class="opomba-okvir ne" role="alert" data-testid="ura"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("The time on this phone is wrong — check date and time settings.")}</span></p>` : null;
}

/* Povezava, cakajoci skeni, cas zadnjega prenosa seznama (najstarejsi med aktivnimi). */
function StatusVrstica({ ms, motor, zdaj, brezSeznama }) {
  const seznamBesedilo = ms.seznamCas
    ? t("List: {n} · {kdaj}", { n: ms.seznamStevilo, kdaj: kdajBesedilo(ms.seznamCas, zdaj) })
    : t("List: not downloaded");
  const seznamStar = !ms.seznamCas || zdaj - ms.seznamCas > 15 * 60000;
  return html`<div class="skener-stanje-vrstica" aria-live="polite" data-testid="stanje">
    <span class=${"znacka-stanja " + (ms.povezava ? "online" : "offline")} data-testid="povezava"><i class="pika" aria-hidden="true"></i>${ms.povezava ? t("Online") : t("Offline")}</span>
    <span class=${"znacka-stanja" + (ms.caka > 0 ? (ms.povezava ? " caka" : " opozorilo") : "")} data-testid="caka">${t("Waiting: {n}", { n: ms.caka })}</span>
    ${ms.caka > 0 ? html`<button type="button" class="gumb-vstopa" disabled=${ms.sinhroniziram || !ms.povezava} onClick=${() => motor.takojPoslji()}>
      ${ms.sinhroniziram ? html`<span class="vrtavka majhna" aria-hidden="true"></span>` : html`<${Ikona} ime="refresh-cw" velikost=${14} />`}${t("Send now")}</button>` : null}
    ${brezSeznama ? null : html`<span class=${"znacka-stanja" + (seznamStar ? " opozorilo" : "")} data-testid="seznam">${seznamBesedilo}</span>`}
    ${brezSeznama ? null : html`<button type="button" class="znacka-stanja gumb-znacka" data-testid="znova-dogodki" disabled=${ms.nalagamDogodke} onClick=${() => motor.znovuNaloziDogodke()}>
      ${ms.nalagamDogodke ? html`<span class="vrtavka majhna" aria-hidden="true"></span>` : html`<${Ikona} ime="refresh-cw" velikost=${13} />`}${t("Reload events")}</button>`}
    ${brezSeznama || !ms.znovuNapaka ? null : html`<span class="znacka-stanja opozorilo" role="status" data-testid="znova-napaka">${t("Could not reload events")}</span>`}
  </div>`;
}

/* Glava: en aktivni dogodek -> njegov naslov in cas; vec -> "2 events" in naslovi. */
function GlavaDogodkov({ aktivni }) {
  const ime = e => (e.title || t("Event {n}", { n: e.id }));
  if (aktivni.length === 1) {
    const e = aktivni[0];
    return html`<span class="kv-besedilo" data-testid="dogodki"><strong>${ime(e)}</strong>${e.start_at ? html`<span>${danInUra(new Date(e.start_at))}</span>` : null}</span>`;
  }
  return html`<span class="kv-besedilo" data-testid="dogodki"><strong>${steviloDogodkov(aktivni.length)}</strong><span>${aktivni.map(ime).join(" · ")}</span></span>`;
}

/* Konflikti: gost spusten s tega telefona, streznik pa se ne strinja (viden tudi, ko dogodka ni vec). */
function Konflikti({ ms, motor }) {
  if (!ms.konflikti.length) return null;
  return html`<section class="skener-konflikti" role="alert" data-testid="konflikti">
    <div class="skener-konflikti-glava"><${Ikona} ime="circle-alert" velikost=${18} />
      <strong>${t("Conflicts: {n}", { n: ms.konflikti.length })}</strong></div>
    <p class="opomba">${t("These guests were let in from this phone, but the server disagrees - for example another phone scanned the same ticket first.")}</p>
    ${ms.konflikti.slice(0, 20).map(k => html`<div class="skener-konflikt" key=${k.id}>
      <span class="kv-besedilo">
        <strong class="mono">${k.serial.slice(0, 8).toUpperCase()}${k.imetnik ? " · " + k.imetnik : ""}</strong>
        <span>${t(RAZLOG_KONFLIKTA[k.rezultat] || "Code rejected by the server")} · ${t("Scanned at {cas}", { cas: uraMinute(new Date(k.scanned_at)) })}${k.rezultat === "already_used" && k.used_at_streznik ? " · " + t("Server: {cas}", { cas: uraMinute(new Date(k.used_at_streznik)) }) : ""}</span>
      </span>
      <button type="button" class="gumb-siv majhen" onClick=${() => motor.potrdiKonflikt(k.id)}>${t("Got it")}</button>
    </div>`)}
  </section>`;
}

/* ---------- kamera in rezultat (vsaj en aktiven dogodek) ---------- */

function SkenerDogodkov({ motor, ms, zdaj, rezerva }) {
  const video = useRef(null);
  // faza: prosim | dela | zavrnjeno | ni-kamere | ni-podpore | napaka
  const [faza, setFaza] = useState("prosim");
  const [poskus, setPoskus] = useState(0);
  const [preverjam, setPreverjam] = useState(false);
  const [rezultat, setRezultat] = useState(null);   // sklep motorja
  const [stevec, setStevec] = useState({ streznik: 0, zavrnjeno: 0 });
  // Stanje, ki ga bere zanka branja (ne sme cakati na izris).
  const zanka = useRef({ zadnja: "", zaseden: false });

  useEffect(() => {
    // zagon: vsak zagon kamere dobi svojo stevilko; ustavi() jo poveca, zato zamujen getUserMedia/zanka starega
    // zagona ve, da ne velja vec (dva toka hkrati, kamera prizgana po odhodu - QA).
    let zivo = true, tok = null, casovnik = 0, bralnik = null, budnost = null, zagon = 0;
    zanka.current = { zadnja: "", zaseden: false };
    setRezultat(null); setPreverjam(false);

    const ustavi = () => {
      zagon++;
      clearTimeout(casovnik);
      if (tok) tok.getTracks().forEach(s => s.stop());
      tok = null;
      if (video.current) video.current.srcObject = null;
      if (budnost) budnost.release().catch(() => {});
      budnost = null;
      if (bralnik) bralnik.ustavi();
      bralnik = null;
    };

    async function obravnavaj(koda) {
      const z = zanka.current;
      // Ista koda ostane v kadru vec okvirjev zapored; klicemo samo ob novi kodi in ko ni odprtega rezultata.
      // Predolg niz ni vstopnica (tuj QR, npr. plakat) - ga ne posiljamo.
      if (!koda || koda.length > 2000 || koda === z.zadnja || z.zaseden) return;
      z.zadnja = koda;
      z.zaseden = true;
      // Lokalno preverjanje je takojsnje; vrtavka samo, ce se motor ustavi pri streznikovi poti (koda v1).
      const vrtavka = setTimeout(() => { if (zivo) setPreverjam(true); }, 350);
      try {
        const s = await motor.sken(koda);
        if (!zivo) return;
        if (s.barva === "zelena") setStevec(x => (s.tip === "streznik" ? { ...x, streznik: x.streznik + 1 } : x));
        else if (s.barva === "rdeca") setStevec(x => ({ ...x, zavrnjeno: x.zavrnjeno + 1 }));
        setRezultat(s);
        // Chrome zavrne vibriranje (in zapise napako v konzolo), dokler uporabnik ni nikoli tapnil strani.
        try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(s.barva === "zelena" ? 80 : [60, 60, 60]); } catch { /* brez */ }
      } finally {
        clearTimeout(vrtavka);
        if (zivo) setPreverjam(false);
      }
    }

    async function beri(moj) {
      if (!zivo || !tok || moj !== zagon) return;
      const v = video.current;
      if (v && !zanka.current.zaseden && v.readyState >= 2) {
        try { await obravnavaj(await bralnik.beri(v)); } catch { /* posamezen okvir */ }
      }
      if (zivo && tok && moj === zagon) casovnik = setTimeout(() => beri(moj), PREMOR);
    }

    async function zacni() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setFaza("ni-podpore"); return; }
      ustavi();
      const moj = zagon;
      setFaza("prosim");
      try {
        const [t0, b] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
          ustvariBralnik()
        ]);
        if (!zivo || moj !== zagon || document.visibilityState === "hidden") { t0.getTracks().forEach(s => s.stop()); return; }
        tok = t0; bralnik = b;
        const v = video.current;
        v.srcObject = tok;
        await v.play().catch(() => {});
        if (moj !== zagon) return;
        setFaza("dela");
        try {
          if (navigator.wakeLock) {
            const l = await navigator.wakeLock.request("screen");
            if (zivo && moj === zagon) budnost = l; else l.release().catch(() => {});
          }
        } catch { /* brez */ }
        beri(moj);
      } catch (e) {
        if (!zivo || moj !== zagon) return;
        const ime = e && e.name;
        setFaza(ime === "NotAllowedError" || ime === "SecurityError" ? "zavrnjeno"
          : ime === "NotFoundError" || ime === "OverconstrainedError" ? "ni-kamere" : "napaka");
      }
    }

    // Telefon v zepu / drug zavihek: kamero ugasnemo in ob vrnitvi znova prizgemo.
    const vidnost = () => {
      if (document.visibilityState === "hidden") ustavi();
      else if (!tok) zacni();
    };
    document.addEventListener("visibilitychange", vidnost);
    zacni();
    return () => { zivo = false; document.removeEventListener("visibilitychange", vidnost); ustavi(); };
  }, [poskus, motor]);

  const naprej = () => { setRezultat(null); zanka.current = { zadnja: "", zaseden: false }; };
  const barva = rezultat ? rezultat.barva : "";
  const [naslovR, opisR] = rezultat ? besedilaSklepa(rezultat) : ["", ""];

  return html`<div class="zaslon skener-zaslon">
    <${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
    <div class="skener-glava">
      <div class="skener-dogodek"><${GlavaDogodkov} aktivni=${ms.aktivni} /></div>
      <${StatusVrstica} ms=${ms} motor=${motor} zdaj=${zdaj} />
    </div>
    <${UraOpozorilo} ms=${ms} />
    <div class="skener">
      <video ref=${video} class=${"skener-video" + (faza === "dela" ? "" : " skrito-video")} playsinline muted autoplay aria-hidden="true"></video>
      ${faza === "dela" ? html`<div class="skener-plast" aria-hidden="true">
        <span class="skener-namig">${t("Point the camera at the ticket's QR code")}</span>
        <span class="skener-okvir"></span>
      </div>` : null}
      ${faza === "prosim" ? html`<div class="skener-stanje"><span class="vrtavka" aria-hidden="true"></span>
        <span>${t("Asking for camera access…")}</span></div>` : null}
      ${faza !== "dela" && faza !== "prosim" ? html`<div class="skener-stanje" role="alert">
        <${Ikona} ime="camera" velikost=${40} razred="modra" />
        <strong>${faza === "zavrnjeno" ? t("Camera access is off")
          : faza === "ni-kamere" ? t("No camera found")
          : faza === "ni-podpore" ? t("This browser cannot use the camera")
          : t("The camera could not start")}</strong>
        <span>${faza === "zavrnjeno" ? t("Allow the camera for outly.si in your browser settings to scan tickets at the door.")
          : faza === "ni-podpore" ? t("Open outly.si/app in Chrome or Safari to scan tickets.")
          : t("Close other apps that use the camera and try again.")}</span>
        <button type="button" class="gumb-siv majhen" onClick=${() => setPoskus(p => p + 1)}>${t("Try again")}</button>
      </div>` : null}
      <div class="skener-rezultat-mesto" aria-live="assertive">
        ${preverjam ? html`<div class="skener-rezultat"><span class="vrtavka" aria-hidden="true"></span><span>${t("Checking…")}</span></div>` : null}
        ${!preverjam && rezultat ? html`<div class=${"skener-rezultat " + (barva === "zelena" ? "ok" : barva === "rumena" ? "opozorilo" : "ne")} data-testid="rezultat" data-tip=${rezultat.tip}>
          <${Ikona} ime=${barva === "zelena" ? "circle-check" : barva === "rumena" ? "circle-alert" : "circle-x"} velikost=${34} />
          <div class="kv-besedilo">
            <strong>${naslovR}</strong>
            ${opisR ? html`<span>${opisR}</span>` : null}
          </div>
          <button type="button" class="gumb-siv majhen skener-naprej" onClick=${naprej}>${t("Next")}</button>
          ${rezultat.ticket && rezultat.ticket.is_vip === true ? html`<div class="skener-vip"><${VipVrstica} v=${rezultat.ticket} velika=${true} /></div>` : null}
          ${rezultat.ticket && rezultat.ticket.is_guest_list === true ? html`<div class="skener-vip"><${OznakaGuestList} v=${rezultat.ticket} skener=${true} /></div>` : null}
        </div>` : null}
      </div>
    </div>

    <div class="skener-stevci" aria-live="polite">
      <span class="zelena-besedilo">${t("{n} in", { n: ms.vstopilo + stevec.streznik })}</span>
      <span class="rdeca-besedilo">${t("{n} refused", { n: stevec.zavrnjeno })}</span>
    </div>
    ${ms.preverjanje === "ni" ? html`<p class="opomba-okvir"><${Ikona} ime="info" velikost=${16} /><span>${t("This browser cannot check codes without the server. Scanning works only with a connection - use a newer Chrome, Safari or Firefox.")}</span></p>` : null}
    ${ms.pripravljen && !ms.imaKljuc && ms.preverjanje !== "ni" ? html`<p class="opomba-okvir"><${Ikona} ime="info" velikost=${16} /><span>${t("The check key is not on this phone yet. Codes are checked by the server until it is downloaded.")}</span></p>` : null}
    ${ms.pripravljen && ms.seznamManjka.length ? html`<p class="opomba-okvir" data-testid="manjka-seznam"><${Ikona} ime="info" velikost=${16} /><span>${ms.seznamManjka.length === 1
      ? t("The ticket list for {naslov} is not on this phone yet. Codes are checked by signature only until it is downloaded.", { naslov: ms.seznamManjka[0].title || t("Event {n}", { n: ms.seznamManjka[0].id }) })
      : t("The ticket lists for {naslovi} are not on this phone yet. Codes are checked by signature only until they are downloaded.", { naslovi: ms.seznamManjka.map(e => e.title || t("Event {n}", { n: e.id })).join(", ") })}</span></p>` : null}
    ${ms.nacinShrambe === "pomnilnik" || ms.shranjevanjeNapaka ? html`<p class="opomba-okvir ne" role="alert"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("This phone cannot save scans. If you close or reload this page, scans that are still waiting are lost.")}</span></p>` : null}
    ${ms.napakaSinh ? html`<p class="opomba-okvir ne" role="alert"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("Could not send scans: {napaka}", { napaka: ms.napakaSinh })}</span></p>` : null}
    ${ms.napakaSeznama ? html`<p class="opomba-okvir ne" role="alert"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("Could not download the ticket list: {napaka}", { napaka: ms.napakaSeznama })}</span></p>` : null}

    <${Konflikti} ms=${ms} motor=${motor} />
  </div>`;
}

