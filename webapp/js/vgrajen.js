/* Vgrajen brskalnik (Instagram, Facebook, TikTok ...): shramba (localStorage) tam med odprtji pogosto ne ostane in ima drugo
   mesto kot Safari/Chrome, zato prijava ne ostane. Aplikacija tega ne more popraviti; uporabniku povemo, kje se prijava ohrani.
   Nevsiljiv trak (zapre ga), z gumbom "Copy link". Ne obljubljamo odprtja v drugem brskalniku: na iOS za to ni zanesljive poti
   (shema x-safari-https:// je v vgrajenih brskalnikih blokirana ali nezanesljiva), na Androidu intent: povezave Instagram/Facebook
   pogosto blokirata - zato samo kopiranje povezave in navodilo za meni (⋯ -> "Open in browser"). Namescena aplikacija
   (display-mode: standalone) ni vgrajen brskalnik. Samo besedilo prek htm (ne innerHTML). */
import { html, useState } from "./lib.js";
import { t } from "./i18n.js";
import { lokalno } from "./store.js";
import { Ikona } from "./ui.js";

const VGRAJEN = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|FB4A|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Pinterest|MicroMessenger|KAKAOTALK|\bLine\//i;
const KLJUC_ZAPRT = "outly_vgrajen_zaprt";

export function jeVgrajenBrskalnik(ua = navigator.userAgent) {
  try {
    if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return false;
    if (navigator.standalone === true) return false;
  } catch { /* brez */ }
  return VGRAJEN.test(ua || "");
}

async function kopiraj(besedilo) {
  try { await navigator.clipboard.writeText(besedilo); return true; } catch { /* nadaljuj */ }
  try {   // starejsi vgrajeni brskalniki brez Clipboard API
    const polje = document.createElement("textarea");
    polje.value = besedilo; polje.setAttribute("readonly", ""); polje.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(polje); polje.select(); polje.setSelectionRange(0, besedilo.length);
    const ok = document.execCommand && document.execCommand("copy");
    polje.remove();
    return !!ok;
  } catch { return false; }
}

const vgrajen = jeVgrajenBrskalnik();

export function TrakVgrajen() {
  const [zaprt, setZaprt] = useState(() => !!lokalno.get(KLJUC_ZAPRT, false));
  const [izid, setIzid] = useState("");   // "" | "ok" | "ne"
  if (!vgrajen || zaprt) return null;
  const zapri = () => { lokalno.set(KLJUC_ZAPRT, true); setZaprt(true); };
  const klik = async () => setIzid((await kopiraj(location.href)) ? "ok" : "ne");
  return html`<aside class="trak-vgrajen" role="note">
    <div class="trak-vgrajen-besedilo">
      <span>${t("For a lasting sign-in, open Outly in Safari or Chrome.")}</span>
      ${izid === "ne" ? html`<span class="opomba">${t("Copy is not available here. Open the menu of this browser and choose Open in browser.")}</span>` : null}
    </div>
    <button type="button" class="gumb-siv majhen" onClick=${klik}>${izid === "ok" ? t("Link copied") : t("Copy link")}</button>
    <button type="button" class="trak-vgrajen-zapri" onClick=${zapri} aria-label=${t("Close")}><${Ikona} ime="x" velikost=${16} /></button>
  </aside>`;
}
