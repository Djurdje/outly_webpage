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
