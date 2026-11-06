/* Okno ob zagonu na iPhonu/iPadu: "Download the app" (App Store) ali "Continue in browser".
   Android aplikacije ni (DECISIONS 2026-09-29), zato tam in na racunalniku okna ni. Okno NIC ne shrani (ne localStorage, ne
   piskotka): politika zasebnosti nasteva, kaj aplikacija hrani v brskalniku. Pokaze se najvec enkrat na nalaganje strani
   (stanje je samo v pomnilniku), odlocitev pade ob prvem izrisu zaslona. Povezava je navaden <a> (iOS jo odpre v App Storu). */
import { html } from "./lib.js";
import { t } from "./i18n.js";
import { ustvariTrgovino, useStore } from "./store.js";
import { List } from "./ui.js";
import { pwa, jeIOS } from "./pwa.js";

export const URL_APP_STORE = "https://apps.apple.com/si/app/outly-nightlife/id6812742331";

/* Zasloni, kjer okno ne sme biti: prijava/registracija/potrditev/pozabljeno geslo, onboarding, gostje brez racuna (vstopnica na vratih),
   ves poslovni del (skener vratarja - skeniranje na vratih ne sme pasti). */
const BREZ_OKNA = new Set(["login", "register", "verify", "forgot", "onboarding", "guest-order", "guest-ticket"]);
/* Povratek s placila (Stripe) je ponovno nalaganje sredi uporabe: URL ima ?placilo=... ali ?stripe=... */
const jePovratekSPlacila = () => { const q = new URLSearchParams(location.search); return q.has("placilo") || q.has("stripe"); };
export const smeNamig = ime => !BREZ_OKNA.has(ime) && !String(ime).startsWith("biz") && !jePovratekSPlacila();

const stanje = ustvariTrgovino({ odlocen: false, odprt: false });

export function NamigAplikacije({ ime }) {
  const s = useStore(stanje);
  if (!s.odlocen) {   // prvi izris zaslona po nalaganju: odlocitev velja do osvezitve strani
    stanje.set({ odlocen: true, odprt: jeIOS() && !pwa.get().namescena && smeNamig(ime) });
    return null;
  }
  const zapri = () => stanje.set({ odprt: false });
  return html`<${List} odprt=${s.odprt} zapri=${zapri} naslov=${t("Outly is better in the app")}>
    <p class="namig-besedilo">${t("Get the Outly app for the best experience, or continue in your browser.")}</p>
    <a class="gumb-glavni" href=${URL_APP_STORE}>${t("Download the app")}</a>
    <button type="button" class="gumb-siv" onClick=${zapri}>${t("Continue in browser")}</button>
  <//>`;
}
