/* Spletna aplikacija Outly - vstop. Isti backend, baza in prijava kot iOS; to je samo nov odjemalec.
   Zavihki kot na iOS: Home (0), Search (1), Map (2), Profile (3) v plavajoci spodnji vrstici. */
import { html, render, useEffect, useLayoutEffect, useState } from "./lib.js";
import { t, useJezik, pripraviJezik } from "./i18n.js";
import { usePot, navigiraj, obnoviDrsenje } from "./usmerjanje.js";
import { zacniSejo, useSeja, potrebujeOnboarding } from "./seja.js";
import { Ikona, Avatar, Nalaganje, GlavaNazaj, Napaka } from "./ui.js";
import { Home, OzadjeHome } from "./views/home.js";
import { Iskanje } from "./views/search.js";
import { Dogodek } from "./views/event.js";
import { Klub } from "./views/club.js";
import { VsiDogodki, Zanr, Zanimivi } from "./views/seznami.js";
import { Zemljevid } from "./views/zemljevid.js";
import { registrirajSW } from "./pwa.js";

/* Zasloni, ki jih ni na zacetnem zaslonu, se nalozijo sele, ko so potrebni (faza 5: manj JS ob prvem obisku).
   Home, iskanje, dogodek, klub in zemljevid ostanejo takoj (deljene povezave vodijo nanje). */
const NALAGALNIKI = {
  "./views/vstopnice.js": () => import("./views/vstopnice.js"),
  "./views/guest-lists.js": () => import("./views/guest-lists.js"),
  "./views/gost-narocilo.js": () => import("./views/gost-narocilo.js"),
  "./views/gost-vstopnica.js": () => import("./views/gost-vstopnica.js"),
  "./views/prijava.js": () => import("./views/prijava.js"),
  "./views/onboarding.js": () => import("./views/onboarding.js"),
  "./views/profil.js": () => import("./views/profil.js"),
  "./views/jezik.js": () => import("./views/jezik.js"),
  "./views/racun.js": () => import("./views/racun.js"),
  "./views/prijatelji.js": () => import("./views/prijatelji.js"),
  "./views/zloraba.js": () => import("./views/zloraba.js"),
  "./views/klubi.js": () => import("./views/klubi.js"),
  "./views/posel.js": () => import("./views/posel.js"),
  "./views/posel-dogodki.js": () => import("./views/posel-dogodki.js"),
  "./views/posel-plosca.js": () => import("./views/posel-plosca.js"),
  "./views/posel-ekipa.js": () => import("./views/posel-ekipa.js"),
  "./views/posel-skener.js": () => import("./views/posel-skener.js"),
  "./views/posel-strezba.js": () => import("./views/posel-strezba.js"),
  "./views/posel-vip.js": () => import("./views/posel-vip.js"),
};
const Vstopnice = leno("./views/vstopnice.js", "Vstopnice");
const GuestListDetajl = leno("./views/guest-lists.js", "GuestListDetajl");
const GostNarocilo = leno("./views/gost-narocilo.js", "GostNarocilo");
const GostVstopnica = leno("./views/gost-vstopnica.js", "GostVstopnica");
const Prijava = leno("./views/prijava.js", "Prijava");
const Registracija = leno("./views/prijava.js", "Registracija");
const Potrditev = leno("./views/prijava.js", "Potrditev");
const PozabljenoGeslo = leno("./views/prijava.js", "PozabljenoGeslo");
const Onboarding = leno("./views/onboarding.js", "Onboarding");
const Profil = leno("./views/profil.js", "Profil");
const Jezik = leno("./views/jezik.js", "Jezik");
const MojRacun = leno("./views/racun.js", "MojRacun");
const OsebniPodatki = leno("./views/racun.js", "OsebniPodatki");
const GesloVarnost = leno("./views/racun.js", "GesloVarnost");
const Nastavitve = leno("./views/racun.js", "Nastavitve");
const MojeNastavitve = leno("./views/racun.js", "MojeNastavitve");
const IzbrisRacuna = leno("./views/racun.js", "IzbrisRacuna");
const ProsnjaUstvarjalca = leno("./views/racun.js", "ProsnjaUstvarjalca");
const Placila = leno("./views/racun.js", "Placila");
const Pomoc = leno("./views/racun.js", "Pomoc");
const ClanekPomoci = leno("./views/racun.js", "ClanekPomoci");
const OAplikaciji = leno("./views/racun.js", "OAplikaciji");
const BlokiraniUporabniki = leno("./views/zloraba.js", "BlokiraniUporabniki");
const MojiPrijatelji = leno("./views/prijatelji.js", "MojiPrijatelji");
const NacrtiPrijateljev = leno("./views/prijatelji.js", "NacrtiPrijateljev");
const MojiKlubi = leno("./views/klubi.js", "MojiKlubi");
const VabilaKlubov = leno("./views/klubi.js", "VabilaKlubov");
const SredisceKluba = leno("./views/posel.js", "SredisceKluba");
const NastavitveLastnika = leno("./views/posel.js", "NastavitveLastnika");
const PodatkiKluba = leno("./views/posel.js", "PodatkiKluba");
const LokacijaKluba = leno("./views/posel.js", "LokacijaKluba");
const UrejanjeCenika = leno("./views/posel.js", "UrejanjeCenika");
const SamoUredniki = leno("./views/posel.js", "SamoUredniki");
const DogodkiKluba = leno("./views/posel-dogodki.js", "DogodkiKluba");
const ObrazecDogodka = leno("./views/posel-dogodki.js", "ObrazecDogodka");
const VstopniceDogodkaKluba = leno("./views/posel-dogodki.js", "VstopniceDogodkaKluba");
const NadzornaPlosca = leno("./views/posel-plosca.js", "NadzornaPlosca");
const SkeniranjaClana = leno("./views/posel-plosca.js", "SkeniranjaClana");
const Ekipa = leno("./views/posel-ekipa.js", "Ekipa");
const Skener = leno("./views/posel-skener.js", "Skener");
const Strezba = leno("./views/posel-strezba.js", "Strezba");
const UrejevalnikVip = leno("./views/posel-vip.js", "UrejevalnikVip");

const AVT = new Set(["login", "register", "verify", "forgot"]);
const SAMO_PRIJAVLJENI = new Set(["tickets", "guest-list", "interested", "onboarding", "account", "personal", "security", "preferences",
  "delete", "creator", "blocked", "friends", "friends-plans", "my-clubs", "invites", "biz", "biz-settings", "biz-dashboard", "biz-staff",
  "biz-events", "biz-event-new", "biz-event-edit", "biz-event-tickets", "biz-event-vip", "biz-team", "biz-info", "biz-location", "biz-bar-prices", "biz-scan", "biz-service", "biz-vip"]);
const ZAVIHKI = [
  { ime: "home", href: "/app", ikona: "house", napis: "Home" },
  { ime: "search", href: "/app/search", ikona: "search", napis: "Search" },
  { ime: "map", href: "/app/map", ikona: "map", napis: "Map" },
  { ime: "profile", href: "/app/profile", ikona: "user", napis: "Profile" }
];
/* Kateri zavihek je aktiven na potisnjenem zaslonu (dogodek, klub ...): kar je bilo zadnje izbrano. */
let zadnjiZavihek = "home";

/* Leno nalozena komponenta: modul se nalozi ob prvem prikazu in ostane v pomnilniku. */
const nalozeni = new Map();
function leno(pot, ime) {
  return function LenaKomponenta(props) {
    const [modul, setModul] = useState(() => nalozeni.get(pot) || null);
    const [napaka, setNapaka] = useState(false);
    useEffect(() => {
      if (modul) return;
      let zivo = true;
      NALAGALNIKI[pot]().then(m => { nalozeni.set(pot, m); if (zivo) setModul(m); }).catch(() => {
        // Najpogosteje nova objava: odprta stran ima se stare module, nov zaslon pa jih ne najde. Ena samodejna
        // osvezitev (najvec na minuto) nalozi novo razlicico; sicer pokazemo napako s "Try again".
        let prej = 0;
        try { prej = Number(sessionStorage.getItem("outly_leno_osvezitev")) || 0; } catch { /* brez */ }
        if (navigator.onLine && Date.now() - prej > 60000) {
          try { sessionStorage.setItem("outly_leno_osvezitev", String(Date.now())); } catch { /* brez */ }
          // Ne navadna osvezitev: brskalnik bi (Cloudflare max-age=14400) znova vzel stare module - zagon.js jih prenese na novo.
          if (window.outlyObnovi) window.outlyObnovi(true); else location.reload();
          return;
        }
        if (zivo) setNapaka(true);
      });
      return () => { zivo = false; };
    }, []);
    if (napaka) return html`<div class="zaslon"><${Napaka} besedilo=${navigator.onLine ? t("This screen could not be loaded. Please try again.") : t("No internet connection. Check your network and try again.")} znova=${() => (window.outlyObnovi ? window.outlyObnovi(true) : location.reload())} /></div>`;
    if (!modul) return html`<div class="zaslon"><${Nalaganje} /></div>`;
    const K = modul[ime];
    return html`<${K} ...${props} />`;
  };
}
/* Ko je zacetni zaslon nalozen, v miru nalozimo se najpogostejse (prehod na Profil in vstopnice brez cakanja). */
function prednaloziVMiru() {
  const zacni = () => {
    ["./views/profil.js", "./views/vstopnice.js", "./views/prijava.js"].forEach(p => NALAGALNIKI[p]().then(m => nalozeni.set(p, m)).catch(() => {}));
    import("/vendor/qrcode-generator-2.0.4.mjs").catch(() => {});   // vstopnica pred vrati mora pokazati QR tudi brez signala
  };
  if ("requestIdleCallback" in window) requestIdleCallback(zacni, { timeout: 8000 }); else setTimeout(zacni, 4000);
}

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
    case "guest-list": return html`<${GuestListDetajl} key=${p.id} id=${p.id} />`;
    case "guest-ticket": return html`<${GostVstopnica} />`;   // NI v SAMO_PRIJAVLJENI: prijatelj brez racuna odpre vstopnico z zetonom iz maila
    case "guest-order": return html`<${GostNarocilo} />`;   // NI v SAMO_PRIJAVLJENI: gost odpre vstopnice z zetonom iz maila
    case "login": return html`<${Prijava} />`;
    case "register": return html`<${Registracija} />`;
    case "verify": return html`<${Potrditev} />`;
    case "forgot": return html`<${PozabljenoGeslo} />`;
    case "onboarding": return html`<${Onboarding} />`;
    case "language": return html`<${Jezik} />`;
    case "account": return html`<${MojRacun} />`;
    case "personal": return html`<${OsebniPodatki} />`;
    case "security": return html`<${GesloVarnost} />`;
    case "preferences": return html`<${Nastavitve} />`;
    case "my-preferences": return html`<${MojeNastavitve} />`;
    case "blocked": return html`<${BlokiraniUporabniki} />`;
    case "delete": return html`<${IzbrisRacuna} />`;
    case "creator": return html`<${ProsnjaUstvarjalca} />`;
    case "payment": return html`<${Placila} />`;
    case "help": return html`<${Pomoc} />`;
    case "article": return html`<${ClanekPomoci} key=${p.id} id=${p.id} />`;
    case "about": return html`<${OAplikaciji} />`;
    case "friends": return html`<${MojiPrijatelji} />`;
    case "friends-plans": return html`<${NacrtiPrijateljev} />`;
    case "my-clubs": return html`<${MojiKlubi} />`;
    case "invites": return html`<${VabilaKlubov} />`;
    case "biz": return html`<${SredisceKluba} key=${p.klub} klub=${p.klub} />`;
    // Skener: vse vloge v klubu (tudi vratar) - brez SamoUredniki.
    case "biz-scan": return html`<${Skener} key=${p.klub} klub=${p.klub} />`;
    // Table service: owner, manager, bartender - vratarja zavrne pogled sam (brez klicev), strezba pa s 403.
    case "biz-service": return html`<${Strezba} key=${p.klub} klub=${p.klub} />`;
    case "biz-settings": return html`<${SamoUredniki} klub=${p.klub}><${NastavitveLastnika} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-dashboard": return html`<${SamoUredniki} klub=${p.klub}><${NadzornaPlosca} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-staff": return html`<${SamoUredniki} klub=${p.klub}><${SkeniranjaClana} key=${p.klub + "/" + p.clan} klub=${p.klub} clan=${p.clan} /><//>`;
    case "biz-events": return html`<${SamoUredniki} klub=${p.klub}><${DogodkiKluba} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-event-new": return html`<${SamoUredniki} klub=${p.klub}><${ObrazecDogodka} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-event-edit": return html`<${SamoUredniki} klub=${p.klub}><${ObrazecDogodka} key=${p.klub + "/" + p.dogodek} klub=${p.klub} dogodek=${p.dogodek} /><//>`;
    case "biz-event-tickets": return html`<${VstopniceDogodkaKluba} key=${p.klub + "/" + p.dogodek} klub=${p.klub} dogodek=${p.dogodek} />`;
    case "biz-team": return html`<${SamoUredniki} klub=${p.klub}><${Ekipa} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-info": return html`<${SamoUredniki} klub=${p.klub}><${PodatkiKluba} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-location": return html`<${SamoUredniki} klub=${p.klub}><${LokacijaKluba} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-bar-prices": return html`<${SamoUredniki} klub=${p.klub}><${UrejanjeCenika} key=${p.klub} klub=${p.klub} /><//>`;
    case "biz-event-vip": return html`<${SamoUredniki} klub=${p.klub}><${UrejevalnikVip} key=${p.klub + "/" + p.dogodek} klub=${p.klub} dogodek=${p.dogodek} /><//>`;
    case "biz-vip": return html`<${SamoUredniki} klub=${p.klub}><${UrejevalnikVip} key=${p.klub} klub=${p.klub} /><//>`;
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
    ${pot.ime === "home" ? html`<${OzadjeHome} />` : null}
    <main id="vsebina" class=${"okvir" + (brezVrstice ? "" : " z-vrstico") + (pot.ime === "biz-vip" || pot.ime === "biz-event-vip" ? " siroko" : "")} key=${pot.kljuc} data-smer=${pot.smer}>
      <${Zaslon} pot=${pot} />
    </main>
    ${brezVrstice ? null : html`<${SpodnjaVrstica} aktiven=${ZAVIHKI.some(z => z.ime === pot.ime) ? pot.ime : pot.ime.startsWith("biz") ? "profile" : zadnjiZavihek} />`}
  </div>`;
}

function naslovPoti(ime) {
  return ({ search: "Search", map: "Map", profile: "Profile", events: "Events", interested: "Interested events",
    tickets: "Tickets", "guest-list": "Guest list", "guest-order": "Your tickets", "guest-ticket": "Your ticket", login: "Sign in", register: "Create an account", verify: "Verify your email",
    forgot: "Forgot password?", onboarding: "Complete your account", language: "Language", genre: "Events",
    account: "My Account", personal: "Personal info", security: "Password and security", preferences: "Preferences",
    "my-preferences": "My preferences", blocked: "Blocked users", delete: "Delete account", creator: "Request for creator", payment: "Payment",
    help: "Help Center", article: "Help Center", about: "About", friends: "My friends", "friends-plans": "Friends plans",
    "my-clubs": "My clubs", invites: "Notifications", biz: "My clubs", "biz-settings": "Settings", "biz-dashboard": "Dashboard",
    "biz-staff": "Staff activity", "biz-events": "Events", "biz-event-new": "New event", "biz-event-edit": "Edit event",
    "biz-event-tickets": "Tickets", "biz-team": "Team", "biz-info": "Club info", "biz-location": "Location on the map",
    "biz-bar-prices": "Bar prices", "biz-service": "Table service", "biz-vip": "VIP tables", "biz-event-vip": "VIP tables" })[ime] || "Outly";
}

zacniSejo();
registrirajSW();
window.addEventListener("load", () => setTimeout(prednaloziVMiru, 2500));
pripraviJezik().then(() => {
  const koren = document.getElementById("aplikacija");
  koren.textContent = "";   // zacetna vrtavka iz index.html
  render(html`<${App} />`, koren);
  if (window.outlyZagnano) window.outlyZagnano();   // varovalo zagona (webapp/zagon.js)
});
