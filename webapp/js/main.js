/* Spletna aplikacija Outly - vstop. Isti backend, baza in prijava kot iOS; to je samo nov odjemalec.
   Zavihki kot na iOS: Home (0), Search (1), Map (2), Profile (3) v plavajoci spodnji vrstici. */
import { html, render, useEffect, useLayoutEffect } from "./lib.js";
import { t, useJezik } from "./i18n.js";
import { usePot, navigiraj, obnoviDrsenje } from "./usmerjanje.js";
import { zacniSejo, useSeja, potrebujeOnboarding } from "./seja.js";
import { Ikona, Avatar, Nalaganje, GlavaNazaj } from "./ui.js";
import { Home } from "./views/home.js";
import { Iskanje } from "./views/search.js";
import { Dogodek } from "./views/event.js";
import { Klub } from "./views/club.js";
import { VsiDogodki, Zanr, Zanimivi } from "./views/seznami.js";
import { Vstopnice } from "./views/vstopnice.js";
import { Prijava, Registracija, Potrditev, PozabljenoGeslo } from "./views/prijava.js";
import { Onboarding } from "./views/onboarding.js";
import { Profil } from "./views/profil.js";
import { Jezik } from "./views/jezik.js";
import { Zemljevid } from "./views/zemljevid.js";

const AVT = new Set(["login", "register", "verify", "forgot"]);
const SAMO_PRIJAVLJENI = new Set(["tickets", "interested", "onboarding"]);
const ZAVIHKI = [
  { ime: "home", href: "/app", ikona: "house", napis: "Home" },
  { ime: "search", href: "/app/search", ikona: "search", napis: "Search" },
  { ime: "map", href: "/app/map", ikona: "map", napis: "Map" },
  { ime: "profile", href: "/app/profile", ikona: "user", napis: "Profile" }
];
/* Kateri zavihek je aktiven na potisnjenem zaslonu (dogodek, klub ...): kar je bilo zadnje izbrano. */
let zadnjiZavihek = "home";

function Zaslon({ pot }) {
  const p = pot.params;
  switch (pot.ime) {
    case "home": return html`<${Home} />`;
    case "search": return html`<${Iskanje} />`;
    case "map": return html`<${Zemljevid} />`;
    case "profile": return html`<${Profil} />`;
    case "event": return html`<${Dogodek} key=${p.id} id=${p.id} />`;
    case "club": return html`<${Klub} key=${p.id} id=${p.id} />`;
    case "events": return html`<${VsiDogodki} />`;
    case "genre": return html`<${Zanr} key=${p.genre} genre=${p.genre} />`;
    case "interested": return html`<${Zanimivi} />`;
    case "tickets": return html`<${Vstopnice} />`;
    case "login": return html`<${Prijava} />`;
    case "register": return html`<${Registracija} />`;
    case "verify": return html`<${Potrditev} />`;
    case "forgot": return html`<${PozabljenoGeslo} />`;
    case "onboarding": return html`<${Onboarding} />`;
    case "language": return html`<${Jezik} />`;
    default: return html`<div class="zaslon"><${GlavaNazaj} />
      <div class="prazno"><strong>${t("Page not found")}</strong><a class="gumb-siv" href="/app">${t("Go to Home")}</a></div></div>`;
  }
}

function SpodnjaVrstica({ aktiven }) {
  const me = useSeja(s => s.me);
  return html`<nav class="spodnja-vrstica" aria-label=${t("Main")}>
    ${ZAVIHKI.map(z => html`<a href=${z.href} class=${"zavihek" + (z.ime === aktiven ? " aktiven" : "")}
        aria-current=${z.ime === aktiven ? "page" : null}>
      ${z.ime === "profile" && me && me.avatar_url
        ? html`<${Avatar} url=${me.avatar_url} ime=${me.username} velikost=${24} />`
        : html`<${Ikona} ime=${z.ikona} velikost=${22} debelina=${z.ime === aktiven ? 2.4 : 1.9} />`}
      <span>${t(z.napis)}</span>
    </a>`)}
  </nav>`;
}

function App() {
  const koda = useJezik();
  const pot = usePot();
  const { pripravljena, prijavljen, me } = useSeja(s => s);

  // Varovala: samo prijavljeni; onboarding pred vsem ostalim; prijavljen na zaslonu prijave -> naprej.
  let preusmeritev = null;
  if (pripravljena) {
    const naprej = encodeURIComponent(location.pathname + location.search);
    if (!prijavljen && SAMO_PRIJAVLJENI.has(pot.ime)) preusmeritev = `/app/login?next=${naprej}`;
    else if (prijavljen && me && potrebujeOnboarding(me) && pot.ime !== "onboarding" && pot.ime !== "language" && !AVT.has(pot.ime))
      preusmeritev = `/app/onboarding?next=${naprej}`;
    else if (prijavljen && me && !potrebujeOnboarding(me) && AVT.has(pot.ime) && pot.ime !== "forgot") {
      const n = pot.iskanje.get("next") || "";
      preusmeritev = n.startsWith("/app") ? n : "/app";
    }
  }
  useEffect(() => { if (preusmeritev) navigiraj(preusmeritev, { zamenjaj: true }); }, [preusmeritev]);
  useLayoutEffect(() => { obnoviDrsenje(pot); }, [pot.kljuc]);
  useEffect(() => {
    if (!["event", "club"].includes(pot.ime)) document.title = pot.ime === "home" ? "Outly" : `${t(naslovPoti(pot.ime))} · Outly`;
  }, [pot.ime, koda]);

  if (ZAVIHKI.some(z => z.ime === pot.ime)) zadnjiZavihek = pot.ime;
  const brezVrstice = AVT.has(pot.ime) || pot.ime === "onboarding";
  if (!pripravljena || preusmeritev) return html`<main class="okvir"><${Nalaganje} /></main>`;

  return html`<div class="okvir-aplikacije" key=${koda}>
    <main id="vsebina" class=${"okvir" + (brezVrstice ? "" : " z-vrstico")} key=${pot.kljuc} data-smer=${pot.smer}>
      <${Zaslon} pot=${pot} />
    </main>
    ${brezVrstice ? null : html`<${SpodnjaVrstica} aktiven=${ZAVIHKI.some(z => z.ime === pot.ime) ? pot.ime : zadnjiZavihek} />`}
  </div>`;
}

function naslovPoti(ime) {
  return ({ search: "Search", map: "Map", profile: "Profile", events: "Events", interested: "Interested events",
    tickets: "Tickets", login: "Sign in", register: "Create an account", verify: "Verify your email",
    forgot: "Forgot password?", onboarding: "Complete your account", language: "Language", genre: "Events" })[ime] || "Outly";
}

zacniSejo();
const koren = document.getElementById("aplikacija");
koren.textContent = "";   // zacetna vrtavka iz index.html
render(html`<${App} />`, koren);
