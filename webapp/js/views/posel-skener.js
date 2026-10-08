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
import { navigiraj } from "../usmerjanje.js";
import { danInUra } from "../oblika.js";
import { VipVrstica, OznakaGuestList } from "../vip.js";
import { skenirajVstopnico, ustvariMotor, dogodkiKluba, privzetiDogodek, izbranDogodek, shraniIzbiro } from "../sken/motor.js";

export { skenirajVstopnico };

export const naslovRezultata = r => {
  switch (r) {
    case "ok": return t("WELCOME IN");
    case "already_used": return t("ALREADY SCANNED");
    case "wrong_club": return t("WRONG CLUB");
    case "unknown": return t("UNKNOWN TICKET");
    case "unpaid": return t("NOT PAID");
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
    case "drug-dogodek": return [t("WRONG EVENT"), t("This ticket is for a different event.")];
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

/* ---------- izbira dogodka ---------- */

export function Skener({ klub, dogodek }) {
  const id = idKluba(klub);
  const izUrl = idKluba(dogodek);
  const [dog, setDog] = useState({ nalaga: true, dogodki: [], izOmrezja: true, shranjen: null });
  const [izbira, setIzbira] = useState(false);   // vratar je pritisnil "Change"
  const [poskus, setPoskus] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    let zivo = true;
    setDog(d => ({ ...d, nalaga: true }));
    Promise.all([dogodkiKluba(id), izbranDogodek(id)]).then(([r, shranjen]) => {
      if (zivo) setDog({ nalaga: false, dogodki: r.dogodki, izOmrezja: r.izOmrezja, shranjen });
    });
    return () => { zivo = false; };
  }, [id, poskus]);

  const rezerva = id ? `/app/business/${id}` : "/app/profile";
  if (!id) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} /></div>`;

  // Prednost: povezava (?dogodek=) > izbira vratarja (do 12 h) > dogodek, ki zdaj poteka.
  const sveza = dog.shranjen && Date.now() - dog.shranjen.cas < 12 * 3600 * 1000 && (!dog.dogodki.length || dog.dogodki.some(e => e.id === dog.shranjen.id));
  const izbranId = izUrl || (sveza ? dog.shranjen.id : null) || (dog.nalaga ? null : privzetiDogodek(dog.dogodki));
  const izbranZapis = dog.dogodki.find(e => e.id === izbranId) || null;

  const izberi = e => {
    shraniIzbiro(id, e);
    setIzbira(false);
    navigiraj(`/app/business/${id}/scan?dogodek=${e}`, { zamenjaj: true });
  };

  if (dog.nalaga && !izUrl) return html`<div class="zaslon"><${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
    <div class="skener-stanje-prazno"><span class="vrtavka" aria-hidden="true"></span></div></div>`;

  if (!izbranId || izbira) {
    return html`<div class="zaslon skener-zaslon">
      <${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
      <h2 class="podnaslov">${t("Which event are you scanning?")}</h2>
      <p class="opomba">${t("The ticket list of the event is saved on this phone, so scanning keeps working without internet.")}</p>
      ${!dog.izOmrezja ? html`<p class="opomba oranzna">${t("No connection - showing the events saved on this phone.")}</p>` : null}
      ${dog.dogodki.length ? html`<div class="skener-dogodki">
        ${dog.dogodki.map(e => html`<button type="button" key=${e.id} class=${"skener-dogodek-gumb" + (e.id === izbranId ? " izbran" : "")} onClick=${() => izberi(e.id)}>
          <strong>${e.title || t("Event {n}", { n: e.id })}</strong><span>${danInUra(new Date(e.start_at))}</span></button>`)}
      </div>` : html`<div class="prazno"><strong>${t("No events to scan")}</strong>
        <p class="opomba">${dog.izOmrezja ? t("There are no events in the last 3 days or the next 30 days.") : t("Connect to the internet once to download the events.")}</p></div>`}
      <button type="button" class="gumb-siv" onClick=${() => { setIzbira(false); setPoskus(p => p + 1); }}>
        <${Ikona} ime="refresh-cw" velikost=${16} />${t("Reload events")}</button>
    </div>`;
  }

  return html`<${SkenerDogodka} key=${id + "/" + izbranId} klub=${id} dogodek=${izbranId} zapis=${izbranZapis} rezerva=${rezerva} naPromeni=${() => setIzbira(true)} />`;
}

/* ---------- skener za en dogodek ---------- */

function SkenerDogodka({ klub, dogodek, zapis, rezerva, naPromeni }) {
  const id = klub;
  const video = useRef(null);
  // faza: prosim | dela | zavrnjeno | ni-kamere | ni-podpore | napaka
  const [faza, setFaza] = useState("prosim");
  const [poskus, setPoskus] = useState(0);
  const [preverjam, setPreverjam] = useState(false);
  const [rezultat, setRezultat] = useState(null);   // sklep motorja
  const [stevec, setStevec] = useState({ streznik: 0, zavrnjeno: 0 });
  const [zdaj, setZdaj] = useState(Date.now());
  // Stanje, ki ga bere zanka branja (ne sme cakati na izris).
  const zanka = useRef({ zadnja: "", zaseden: false });
  const [motor] = useState(() => ustvariMotor({ klub: id, dogodek }));
  const ms = useStore(motor.stanje);

  useEffect(() => {
    motor.zacni();
    const ura = setInterval(() => setZdaj(Date.now()), 15000);
    return () => { clearInterval(ura); motor.ustavi(); };
  }, [motor]);

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
  }, [id, poskus, motor]);

  const naprej = () => { setRezultat(null); zanka.current = { zadnja: "", zaseden: false }; };
  const barva = rezultat ? rezultat.barva : "";
  const [naslovR, opisR] = rezultat ? besedilaSklepa(rezultat) : ["", ""];
  const naslovDogodka = zapis && zapis.title ? zapis.title : t("Event {n}", { n: dogodek });
  const kdajDogodka = zapis && zapis.start_at ? danInUra(new Date(zapis.start_at)) : "";

  const seznamBesedilo = ms.seznamCas
    ? t("List: {n} · {kdaj}", { n: ms.seznamStevilo, kdaj: kdajBesedilo(ms.seznamCas, zdaj) })
    : t("List: not downloaded");
  const seznamStar = !ms.seznamCas || zdaj - ms.seznamCas > 15 * 60000;

  return html`<div class="zaslon skener-zaslon">
    <${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
    <div class="skener-glava">
      <div class="skener-dogodek">
        <span class="kv-besedilo"><strong>${naslovDogodka}</strong>${kdajDogodka ? html`<span>${kdajDogodka}</span>` : null}</span>
        <button type="button" class="gumb-siv majhen" onClick=${naPromeni}>${t("Change")}</button>
      </div>
      <div class="skener-stanje-vrstica" aria-live="polite" data-testid="stanje">
        <span class=${"znacka-stanja " + (ms.povezava ? "online" : "offline")} data-testid="povezava"><i class="pika" aria-hidden="true"></i>${ms.povezava ? t("Online") : t("Offline")}</span>
        <span class=${"znacka-stanja" + (ms.caka > 0 ? (ms.povezava ? " caka" : " opozorilo") : "")} data-testid="caka">${t("Waiting: {n}", { n: ms.caka })}</span>
        ${ms.caka > 0 ? html`<button type="button" class="gumb-vstopa" disabled=${ms.sinhroniziram || !ms.povezava} onClick=${() => motor.takojPoslji()}>
          ${ms.sinhroniziram ? html`<span class="vrtavka majhna" aria-hidden="true"></span>` : html`<${Ikona} ime="refresh-cw" velikost=${14} />`}${t("Send now")}</button>` : null}
        <span class=${"znacka-stanja" + (seznamStar ? " opozorilo" : "")} data-testid="seznam">${seznamBesedilo}</span>
      </div>
    </div>
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
    ${ms.pripravljen && !ms.seznamCas ? html`<p class="opomba-okvir"><${Ikona} ime="info" velikost=${16} /><span>${t("The ticket list is not on this phone yet. Codes are checked by signature only until it is downloaded.")}</span></p>` : null}
    ${ms.nacinShrambe === "pomnilnik" || ms.shranjevanjeNapaka ? html`<p class="opomba-okvir ne" role="alert"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("This phone cannot save scans. If you close or reload this page, scans that are still waiting are lost.")}</span></p>` : null}
    ${ms.napakaSinh ? html`<p class="opomba-okvir ne" role="alert"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("Could not send scans: {napaka}", { napaka: ms.napakaSinh })}</span></p>` : null}
    ${ms.napakaSeznama ? html`<p class="opomba-okvir ne" role="alert"><${Ikona} ime="circle-alert" velikost=${16} /><span>${t("Could not download the ticket list: {napaka}", { napaka: ms.napakaSeznama })}</span></p>` : null}

    ${ms.konflikti.length ? html`<section class="skener-konflikti" role="alert" data-testid="konflikti">
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
    </section>` : null}
  </div>`;
}

