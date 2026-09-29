/* Oblikovanje: datumi, denar, oznake dogodkov (prevod APIEvent.swift), slike Cloudinary.
   Datume razclenimo ENKRAT ob nalaganju (normaliziraj*), ne pri vsakem izrisu (iOS past #32). */
import { t, tn, locale } from "./i18n.js";

const oblikovalniki = new Map();
function fmt(moznosti) {
  const kljuc = locale() + JSON.stringify(moznosti);
  let f = oblikovalniki.get(kljuc);
  if (!f) { f = new Intl.DateTimeFormat(locale(), moznosti); oblikovalniki.set(kljuc, f); }
  return f;
}

function datum(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Dogodek iz API-ja + razclenjena datuma (_zacetek, _konec). Manjkajoca polja dobijo privzetke. */
export function normalizirajDogodek(e) {
  return {
    ...e,
    title: e.title || "",
    description: e.description || "",
    poster_url: e.poster_url || "",
    genres: Array.isArray(e.genres) ? e.genres : [],
    min_age: e.min_age ?? 18,
    sold_count: e.sold_count ?? 0,
    lifecycle: e.lifecycle || "upcoming",
    recap_video_url: e.recap_video_url || "",
    _zacetek: datum(e.start_at),
    _konec: datum(e.end_at)
  };
}

export function normalizirajKlub(c) {
  const galerija = (Array.isArray(c.gallery_urls) ? c.gallery_urls : []).filter(Boolean);
  return {
    ...c,
    name: c.name || "",
    logo_url: c.logo_url || "",
    city: c.city || "",
    genres: Array.isArray(c.genres) ? c.genres : [],
    bar_prices: Array.isArray(c.bar_prices) ? c.bar_prices : [],
    min_age: c.min_age ?? 18,
    followers_count: c.followers_count ?? 0,
    // Slideshow; stari klubi brez galerije pokazejo pasico (DECISIONS 22. 9.).
    _slike: galerija.length ? galerija : (c.banner_url ? [c.banner_url] : [])
  };
}

/* ---------- denar (celi centi, EUR) ---------- */
export function denar(centi, valuta = "EUR") {
  return new Intl.NumberFormat(locale(), {
    style: "currency", currency: (valuta || "EUR").toUpperCase(),
    minimumFractionDigits: centi % 100 === 0 ? 0 : 2, maximumFractionDigits: 2
  }).format(centi / 100);
}

/* ---------- dogodek: stanja in oznake ---------- */
export const jeRazprodan = e => e.availability === "sold_out";
export const jeMaloVstopnic = e => e.availability === "few_left";
export const preostanek = e => (e.capacity == null ? null : Math.max(0, e.capacity - e.sold_count));

/** "Popular" = ze zacet (time_status backenda); sicer primerjava z zdaj. */
export function jeMimo(e) {
  if (e.time_status) return e.time_status === "popular";
  return !!e._zacetek && e._zacetek <= new Date();
}

/** Koncan dogodek (backend 019): lifecycle, sicer konec ali zacetek + 8 h. */
export function seJeKoncal(e) {
  if (e.lifecycle === "ended") return true;
  if (e.lifecycle === "live" || e.lifecycle === "upcoming") return false;
  const konec = e._konec || (e._zacetek && new Date(e._zacetek.getTime() + 8 * 3600e3));
  return !!konec && konec <= new Date();
}

export function cena(e) {
  return e.ticket_price_cents == null ? null : denar(e.ticket_price_cents, e.currency);
}

/** Napis cene na karticah. Cena null NI "Free" (vstopnic ni na Outlyju); Free samo pri 0. */
export function napisCene(e) {
  if (jeRazprodan(e)) return "—";
  const c = cena(e);
  if (c) return c;
  if (e.ticket_url) return t("Tickets");
  return t("At the door");
}

export function znacka(e) {
  if (jeMimo(e)) return null;
  if (jeRazprodan(e)) return t("SOLD OUT");
  const n = preostanek(e);
  if (jeMaloVstopnic(e) && n != null) return n === 1 ? t("LAST ONE") : t("{n} LEFT", { n });
  if (e.ticket_price_cents == null && e.ticket_url) return null;
  if (e.ticket_price_cents === 0) return t("FREE");
  return null;
}

const istiDan = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function jeDanes(e) {
  const d = e._zacetek; if (!d) return false;
  const zdaj = new Date();
  return istiDan(d, zdaj) || (d > zdaj && d - zdaj < 6 * 3600e3);
}

export function jeTaVikend(e) {
  const d = e._zacetek; const zdaj = new Date();
  if (!d || d <= zdaj) return false;
  const dan = d.getDay(); // 0 nedelja, 5 petek, 6 sobota
  if (!(dan === 5 || dan === 6 || dan === 0)) return false;
  return d - zdaj < 8 * 24 * 3600e3;
}

/** "Fri 11 Sep · 22:00" */
export function danInUra(d) {
  if (!d) return "";
  const dan = fmt({ weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${dan} · ${ura(d)}`;
}
export const ura = d => (d ? fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "");
export const danDolg = d => (d ? fmt({ weekday: "long", day: "numeric", month: "long" }).format(d) : "");
export const mesecKratko = d => (d ? fmt({ month: "short" }).format(d).replace(".", "") : "");
export const danKratek = d => (d ? fmt({ weekday: "short", day: "numeric", month: "short" }).format(d) : "");

/** Relativna oznaka na zaslonu dogodka: ENDED / TONIGHT / TOMORROW / IN n DAYS. */
export function relativno(e) {
  const d = e._zacetek; if (!d) return null;
  if (jeMimo(e)) return { napis: t("ENDED"), nocoj: false };
  const zdaj = new Date();
  const zjutraj = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dni = Math.round((zjutraj(d) - zjutraj(zdaj)) / 86400e3);
  if (dni === 0) return { napis: t("TONIGHT"), nocoj: true };
  if (dni === 1) return { napis: t("TOMORROW"), nocoj: false };
  if (dni > 0 && dni <= 14) return { napis: t("IN {n} DAYS", { n: dni }), nocoj: false };
  return null;
}

export function pozdrav(ime) {
  const h = new Date().getHours();
  const p = h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
  return ime ? `${p}, ${ime}` : p;
}

export const steviloDogodkov = n => tn("1 event", "{n} events", n);

/* ---------- razdalja ---------- */
export function razdaljaKm(a, b) {
  if (!a || b.lat == null || b.lng == null) return null;
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const napisRazdalje = km => (km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/* ---------- slike ----------
   Nikoli plakat v polni locljivosti v kartico (iOS lekcija 29. 9.): Cloudinary dobi transformacijo
   (sirina, samodejni format in kakovost). Slike z outly.si so staticne in ostanejo, kot so. */
export function slika(url, sirina) {
  if (!url) return "";
  if (url.includes("res.cloudinary.com/") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${sirina}/`);
  }
  return url;
}

export const zanrIme = g => {
  const posebni = { hiphop: "Hip hop", rnb: "R&B", "70s": "70s", "80s": "80s", "90s": "90s", "2000s": "2000s" };
  if (posebni[g]) return posebni[g];
  return g ? g.charAt(0).toUpperCase() + g.slice(1) : "";
};

/** Povezava iz podatkov (klub, dogodek) - samo http(s); javascript:, data: ipd. vrne null. */
export function varenUrl(v) {
  const niz = (v || "").trim();
  if (!niz) return null;
  const url = /^https?:\/\//i.test(niz) ? niz : "https://" + niz;
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
}
