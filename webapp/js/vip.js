/* VIP mize: skupno za kupca (views/vip-kupec.js), urejevalnik tlorisa (views/posel-vip.js), poslovni dogodek
   (views/posel-vip-dogodek.js), vstopnice in skener. Specifikacija: tloris je mreza celic width x height,
   element/miza ima x, y (levi zgornji kot), w, h (v celicah), os y je navzdol. Izris je SVG prek htm predloge:
   vsi napisi iz podatkov (oznake, imena paketov, kupci) gredo v DOM kot besedilo, NIKOLI prek innerHTML. */
import { html, useEffect, useState } from "./lib.js";
import { t, tn } from "./i18n.js";
import { ApiError, sporocilo } from "./napake.js";

export const C = 20;   // velikost celice v enotah viewBox (izris se prilagodi sirini zaslona)
export const TIPI = ["bar", "stage", "dj", "dancefloor", "entrance", "wc", "label", "wall"];
export const NAJVEC_ELEMENTOV = 80, NAJVEC_MIZ = 60, NAJVEC_PAKETOV = 30;

/** Privzeti prevedeni naziv tipa (kot v specifikaciji: Bar, Stage, DJ, Dance floor, Entrance, WC). */
export const imeTipa = tip => ({
  bar: t("Bar"), stage: t("Stage"), dj: t("DJ"), dancefloor: t("Dance floor"), entrance: t("Entrance"),
  wc: t("WC"), label: t("Label"), wall: t("Wall"), table: t("Table")
})[tip] || "";

const celo = (v, privzeto = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : privzeto; };
const omeji = (v, od, do_) => Math.min(do_, Math.max(od, v));

/** Tloris iz API-ja (ali null); star ali nepopoln odgovor ne sme podreti izrisa. */
export function normalizirajTloris(p) {
  if (!p || typeof p !== "object") return null;
  const elementi = (Array.isArray(p.elements) ? p.elements : []).filter(e => e && typeof e === "object").map(e => ({
    type: TIPI.includes(e.type) ? e.type : "label",
    x: Math.max(0, celo(e.x)), y: Math.max(0, celo(e.y)),
    w: Math.max(1, celo(e.w, 1)), h: Math.max(1, celo(e.h, 1)),
    label: typeof e.label === "string" ? e.label : ""
  }));
  return { width: omeji(celo(p.width, 24), 1, 100), height: omeji(celo(p.height, 16), 1, 100), elements: elementi };
}

export function normalizirajMize(seznam) {
  return (Array.isArray(seznam) ? seznam : []).filter(m => m && typeof m === "object").map(m => ({
    ...m,
    label: String(m.label == null ? "" : m.label),
    x: Math.max(0, celo(m.x)), y: Math.max(0, celo(m.y)),
    w: Math.max(1, celo(m.w, 1)), h: Math.max(1, celo(m.h, 1)),
    shape: m.shape === "round" ? "round" : "rect",
    seats: celo(m.seats, 1),
    price_cents: celo(m.price_cents, 0)
  }));
}

export const normalizirajPakete = seznam => (Array.isArray(seznam) ? seznam : []).filter(p => p && typeof p === "object")
  .map(p => ({ ...p, name: String(p.name == null ? "" : p.name), description: String(p.description == null ? "" : p.description) }));

/** "Up to 6 people" (v slovenscini sklanjano: Do 6 oseb / Do 1 osebe). */
export const doOseb = n => tn("Up to 1 person", "Up to {n} people", n);

/** Sporocilo za 400 pri urejanju VIP: streznik pove berljivo razlago (meje mreze, unikatne oznake ...), pokazemo jo. */
export function sporociloVip(e) {
  if (e instanceof ApiError && e.status === 400) {
    let b = e.raw;
    try { const j = JSON.parse(b); b = (j && (j.error || j.message)) || b; } catch { /* navadno besedilo */ }
    if (typeof b === "string" && b.trim() && b.length <= 240) return t(b.trim());
  }
  return sporocilo(e);
}

/** "VIP · Table T1 · paket": znacka (zlata kot poudarek) in besedilo. Uporabljajo vstopnice, skener, seznami. */
export function VipVrstica({ v, velika = false }) {
  if (!v || v.is_vip !== true) return null;
  const deli = [v.table_label ? t("Table") + " " + v.table_label : "", v.package_name || ""].filter(Boolean);
  return html`<div class=${"vip-vrstica" + (velika ? " velika" : "")}>
    <b class="znacka-vip">VIP</b>${deli.length ? html`<em class="vip-besedilo">${deli.join(" · ")}</em>` : null}
  </div>`;
}

/* ---------- izris tlorisa ---------- */

/** Sirina elementa v pikslih (za merilo: min. velikost tarce za dotik). */
export function useSirina(ref) {
  const [sirina, setSirina] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const meri = () => setSirina(el.getBoundingClientRect().width);
    meri();
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(meri);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", meri);
    return () => window.removeEventListener("resize", meri);
  }, []);
  return sirina;
}

/** Velikost pisave v enotah viewBox: napis mora v sirino in ne sme biti previsok. */
function velikostNapisa(napis, sirina, visina) {
  const dolzina = Math.max(1, [...String(napis)].length);
  return Math.max(6, Math.min(C * 0.75, visina * 0.6, (sirina - 6) / (dolzina * 0.6)));
}

function potMreze(w, h) {
  let d = "";
  for (let x = 0; x <= w; x++) d += `M${x * C} 0V${h * C}`;
  for (let y = 0; y <= h; y++) d += `M0 ${y * C}H${w * C}`;
  return d;
}

/** Platno tlorisa (SVG z viewBox - prilagodi se sirini). children = elementi in mize. */
export function TlorisPlatno({ plan, razred = "", svgRef, oznaka, children, ...ostalo }) {
  return html`<svg ref=${svgRef} class=${"tloris " + razred} viewBox=${`0 0 ${plan.width * C} ${plan.height * C}`}
    role="group" aria-label=${oznaka || t("Floor plan")} ...${ostalo}>
    <path class="tl-mreza" d=${potMreze(plan.width, plan.height)} />
    ${children}
  </svg>`;
}

/** Orientacijski element: zaobljen pravokotnik z zamolklim polnilom in napisom (prazen napis = prevedeni naziv tipa). */
export function ElementTlorisa({ e }) {
  const napis = e.type === "wall" ? "" : (e.label && e.label.trim()) || imeTipa(e.type);
  const sir = e.w * C, vis = e.h * C;
  const navpicno = vis >= sir * 2 && e.h >= 3;   // ozek visok element: napis na stran
  const fs = navpicno ? velikostNapisa(napis, vis, sir) : velikostNapisa(napis, sir, vis);
  return html`<svg class="tl-gnezdo" x=${e.x * C} y=${e.y * C} width=${sir} height=${vis} aria-hidden="true">
    <rect class=${"tl-el " + e.type} x="0.5" y="0.5" width=${sir - 1} height=${vis - 1} rx=${Math.min(5, sir / 4, vis / 4)} />
    ${napis ? html`<text class="tl-nap" x=${sir / 2} y=${vis / 2} dy=".35em" font-size=${fs}
      transform=${navpicno ? `rotate(-90 ${sir / 2} ${vis / 2})` : null}>${napis}</text>` : null}
  </svg>`;
}

/** Oblika mize (okrogla ali pravokotna) z oznako; napis2 = neobvezna manjsa druga vrstica. */
export function OblikaMize({ m, napis2 = "" }) {
  const sir = m.w * C, vis = m.h * C, cx = m.x * C + sir / 2, cy = m.y * C + vis / 2;
  const okrogla = m.shape === "round";
  const fs = velikostNapisa(m.label, okrogla ? sir * 0.78 : sir, vis);
  const dve = napis2 && vis >= 2 * C;
  return html`${okrogla
      ? html`<ellipse class="tl-oblika" cx=${cx} cy=${cy} rx=${sir / 2 - 1} ry=${vis / 2 - 1} />`
      : html`<rect class="tl-oblika" x=${m.x * C + 1} y=${m.y * C + 1} width=${sir - 2} height=${vis - 2} rx=${Math.min(6, sir / 4)} />`}
    <text class="tl-nap" x=${cx} y=${dve ? cy - fs * 0.45 : cy} dy=".35em" font-size=${fs}>${m.label}</text>
    ${dve ? html`<text class="tl-nap2" x=${cx} y=${cy + fs * 0.75} dy=".35em" font-size=${Math.max(5.5, fs * 0.55)}>${napis2}</text>` : null}`;
}

/** Legenda: prosta / izbrana / prodana. */
export function LegendaMiz() {
  return html`<div class="vip-legenda" aria-hidden="true">
    <span><i class="tl-pika prosta"></i>${t("Available")}</span>
    <span><i class="tl-pika izbrana"></i>${t("Selected")}</span>
    <span><i class="tl-pika prodana"></i>${t("Booked")}</span>
  </div>`;
}
