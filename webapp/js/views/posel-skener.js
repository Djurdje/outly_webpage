/* QR skener vstopnic na vratih (iOS QRScannerView). Dodan 29. 9. 2026 (Martin): vratar z Androidom ne more
   namestiti aplikacije Outly, zato skener dela tudi v brskalniku. Dostop imajo vse vloge v klubu (tudi vratar).
   Kamera: getUserMedia (zadnja kamera). Dekodiranje: BarcodeDetector, kjer ga brskalnik ima (Chrome Android),
   sicer jsQR (vendor/, nalozi se leno). Slike kamere ostanejo na napravi - streznik dobi samo vsebino kode QR
   (podpisan niz vstopnice) prek POST /business/tickets/scan; odloci streznik. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, locale } from "../i18n.js";
import { ApiError, sporocilo } from "../napake.js";
import { GlavaNazaj, Ikona } from "../ui.js";
import { idKluba, poslovno } from "../posel.js";

/** Odgovor skenerja (ScanResult). Streznik ga vrne tudi s 400/403/404/409 (iOS scanTicket enako). */
export async function skenirajVstopnico(klub, qr) {
  try {
    return await poslovno(klub, "/business/tickets/scan", { method: "POST", body: { qr } });
  } catch (e) {
    if (e instanceof ApiError && [400, 403, 404, 409].includes(e.status)) {
      let r = null;
      try { r = JSON.parse(e.raw); } catch { r = null; }
      if (r && typeof r.result === "string") return r;
    }
    throw e;
  }
}

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

/** Sporocilo streznika (angl.) -> prevod, ce ga imamo; used_at doda uro prvega skena. */
export function opisRezultata(r) {
  const deli = [t(String(r.message || ""))];
  if (r.result === "already_used" && r.used_at) {
    const d = new Date(r.used_at);
    if (!isNaN(d)) deli.push(t("Scanned at {cas}", { cas: d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) }));
  }
  return deli.filter(Boolean).join(" ");
}

/* jsQR (~130 KB) samo, ce brskalnik nima BarcodeDetector (Safari, Firefox). */
let jsqr = null;
const naloziJsQR = () => (jsqr ||= import("/vendor/jsqr-1.4.0.mjs").then(m => m.default).catch(e => { jsqr = null; throw e; }));

async function ustvariBralnik() {
  try {
    if ("BarcodeDetector" in window) {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (Array.isArray(f) && f.includes("qr_code")) {
        const d = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async video => {
          const r = await d.detect(video);
          return r && r[0] && r[0].rawValue ? r[0].rawValue : null;
        };
      }
    }
  } catch { /* pademo na jsQR */ }
  const beri = await naloziJsQR();
  const platno = document.createElement("canvas");
  const ctx = platno.getContext("2d", { willReadFrequently: true });
  return async video => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const k = Math.min(1, 640 / Math.max(w, h));
    const sw = Math.round(w * k), sh = Math.round(h * k);
    if (platno.width !== sw) platno.width = sw;
    if (platno.height !== sh) platno.height = sh;
    ctx.drawImage(video, 0, 0, sw, sh);
    const slika = ctx.getImageData(0, 0, sw, sh);
    const r = beri(slika.data, sw, sh, { inversionAttempts: "dontInvert" });
    return r && r.data ? r.data : null;
  };
}

const PREMOR = 200;   // ms med poskusi branja (varcuje baterijo na starejsih telefonih)

export function Skener({ klub }) {
  const id = idKluba(klub);
  const video = useRef(null);
  // faza: prosim | dela | zavrnjeno | ni-kamere | ni-podpore | napaka
  const [faza, setFaza] = useState("prosim");
  const [poskus, setPoskus] = useState(0);
  const [preverjam, setPreverjam] = useState(false);
  const [rezultat, setRezultat] = useState(null);   // { result, message, used_at } ali { napaka }
  const [stevec, setStevec] = useState({ ok: 0, zavrnjeno: 0 });
  // Stanje, ki ga bere zanka branja (ne sme cakati na izris).
  const zanka = useRef({ zadnja: "", zaseden: false });

  useEffect(() => {
    if (!id) return;
    let zivo = true, tok = null, casovnik = 0, bralnik = null, budnost = null;

    const ustavi = () => {
      clearTimeout(casovnik);
      if (tok) tok.getTracks().forEach(s => s.stop());
      tok = null;
      if (video.current) video.current.srcObject = null;
      if (budnost) budnost.release().catch(() => {});
      budnost = null;
    };

    async function obravnavaj(koda) {
      const z = zanka.current;
      // Ista koda ostane v kadru vec okvirjev zapored; klicemo samo ob novi kodi in ko ni odprtega rezultata.
      if (!koda || koda === z.zadnja || z.zaseden) return;
      z.zadnja = koda;
      z.zaseden = true;
      setPreverjam(true);
      try {
        const r = await skenirajVstopnico(id, koda);
        if (!zivo) return;
        const ok = r.result === "ok";
        setStevec(s => (ok ? { ...s, ok: s.ok + 1 } : { ...s, zavrnjeno: s.zavrnjeno + 1 }));
        setRezultat(r);
        try { if (navigator.vibrate) navigator.vibrate(ok ? 80 : [60, 60, 60]); } catch { /* brez */ }
      } catch (e) {
        if (zivo) setRezultat({ napaka: sporocilo(e) });
      } finally {
        if (zivo) setPreverjam(false);
      }
    }

    async function beri() {
      if (!zivo || !tok) return;
      const v = video.current;
      if (v && !zanka.current.zaseden && v.readyState >= 2) {
        try { await obravnavaj(await bralnik(v)); } catch { /* posamezen okvir */ }
      }
      if (zivo && tok) casovnik = setTimeout(beri, PREMOR);
    }

    async function zacni() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setFaza("ni-podpore"); return; }
      setFaza("prosim");
      try {
        const [t0, b] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
          ustvariBralnik()
        ]);
        if (!zivo) { t0.getTracks().forEach(s => s.stop()); return; }
        tok = t0; bralnik = b;
        const v = video.current;
        v.srcObject = tok;
        await v.play().catch(() => {});
        setFaza("dela");
        try { if (navigator.wakeLock) budnost = await navigator.wakeLock.request("screen"); } catch { budnost = null; }
        beri();
      } catch (e) {
        if (!zivo) return;
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
  }, [id, poskus]);

  const naprej = () => { setRezultat(null); zanka.current = { zadnja: "", zaseden: false }; };
  const rezerva = id ? `/app/business/${id}` : "/app/profile";
  const ok = rezultat && rezultat.result === "ok";

  return html`<div class="zaslon skener-zaslon">
    <${GlavaNazaj} naslov=${t("Scan tickets")} rezerva=${rezerva} />
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
    </div>
    <div class="skener-stevci" aria-live="polite">
      <span class="zelena-besedilo">${t("{n} in", { n: stevec.ok })}</span>
      <span class="rdeca-besedilo">${t("{n} refused", { n: stevec.zavrnjeno })}</span>
    </div>
    <div class="skener-rezultat-mesto" aria-live="assertive">
      ${preverjam ? html`<div class="skener-rezultat"><span class="vrtavka" aria-hidden="true"></span><span>${t("Checking…")}</span></div>` : null}
      ${!preverjam && rezultat ? html`<div class=${"skener-rezultat " + (ok ? "ok" : "ne")}>
        <${Ikona} ime=${ok ? "circle-check" : "circle-x"} velikost=${34} />
        <div class="kv-besedilo">
          <strong>${rezultat.napaka ? t("Could not check the ticket") : naslovRezultata(rezultat.result)}</strong>
          <span>${rezultat.napaka ? rezultat.napaka : opisRezultata(rezultat)}</span>
        </div>
        <button type="button" class="gumb-siv majhen skener-naprej" onClick=${naprej}>${t("Next")}</button>
      </div>` : null}
    </div>
  </div>`;
}
