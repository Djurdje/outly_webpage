import { html } from "./lib.js";
import { t, useJezik } from "./i18n.js";

/* Skupno za prijavo in nakup brez racuna: verzija pogojev (kot auth.js na outly.si / terms.html) in oblika e-naslova. */
export const TERMS_VERSION = "1.1";
export const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;


/* Opomba ob gumbu za placilo prijavljenega kupca (vstopnice, VIP miza): gost ima kljukico, prijavljen je pogoje sprejel ob
   registraciji. Prevod doloci sklon: povezavi sta v [oglatih oklepajih], prva = pogoji, druga = politika zasebnosti
   (EN /privacy, SL /privacy-app kot nakup-gost.js). Samo htm predloga, brez innerHTML. */
export function PogojiNakupa() {
  const zasebnost = useJezik() === "sl" ? "/privacy-app" : "/privacy";
  const povezave = ["/terms", zasebnost];
  const deli = t("By continuing you agree to the [Terms of Use] and acknowledge the [Privacy Policy].").split(/\[([^\]]+)\]/);
  return html`<p class="avt-pravno">${deli.map((del, i) => i % 2 === 0 ? del
    : html`<a key=${i} href=${povezave[(i - 1) / 2] || "/terms"} target="_blank" rel="noopener">${del}</a>`)}</p>`;
}

/* Podatki prodajalca nad gumbom za placilo (backend #94, ZVPot-1 18/1-2, 130/1-1): kupec pred nakupom izve, kdo mu prodaja.
   Prodajalec je klub, Outly je posrednik. Podatki gredo v DOM samo kot besedilo (htm), nikoli prek innerHTML.
   Brez prodajalca (star backend, odgovor brez `seller`) bloka ni - kupec vidi stavek OpombaVracila kot doslej. */
export function BlokProdajalca({ prodajalec: p }) {
  if (!p) return null;
  const stevilke = [
    p.registration_number ? t("Reg. no. {n}", { n: p.registration_number }) : "",
    p.tax_number ? t("Tax no. {n}", { n: p.tax_number }) : ""
  ].filter(Boolean).join(" · ");
  const kontakt = [p.phone, p.email].filter(Boolean).join(" · ");
  return html`<div class="prodajalec" role="group" aria-label=${t("Seller")}>
    <span class="nadnapis">${t("Seller")}</span>
    ${p.name ? html`<strong>${p.name}</strong>` : null}
    ${p.address ? html`<span>${p.address}</span>` : null}
    ${stevilke ? html`<span>${stevilke}</span>` : null}
    ${kontakt ? html`<span>${kontakt}</span>` : null}
    <span class="utisano">${t("Outly is the intermediary.")}</span>
  </div>`;
}

/* Opomba o vracilu pod gumbom: z blokom prodajalca stavek o posredniku ostane v bloku (ne podvajamo), brez njega kot doslej. */
export function OpombaVracila({ prodajalec, vip = false }) {
  if (vip) {   // VIP miza (s paketom): pravnik 11. 10. 2026 - "Tickets" samo ne pokrije mize in paketa
    return html`<p class="opomba">${prodajalec
      ? t("VIP tables (including any package) and tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12).")
      : t("VIP tables (including any package) and tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12). The seller is the club; Outly is the intermediary.")}</p>`;
  }
  return html`<p class="opomba">${prodajalec
    ? t("Tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12).")
    : t("Tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12). The seller is the club; Outly is the intermediary.")}</p>`;
}
