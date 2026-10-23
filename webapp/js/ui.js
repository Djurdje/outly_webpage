/* Skupni gradniki vmesnika (prevod Core/Components iz iOS). Vse vrednosti gredo v DOM prek
   htm predloge kot besedilo ali atribut - nikoli innerHTML. */
import { html, useEffect, useRef, useState } from "./lib.js";
import { IKONE } from "./ikone.js";
import { t } from "./i18n.js";
import { nazaj } from "./usmerjanje.js";
import { napisCene, znacka, jeRazprodan, danInUra, danKratek, zanrIme, slika, slikaZamegljena, jeDemo } from "./oblika.js";

/** Oznaka »Demo« (backend #243: is_demo): majhna siva pilula, NE modra (modra je samo za glavni gumb). Besedilo, brez emojija.
    `kot` = absolutno v kotu kartice (razred demo-kot), sicer vrstica v toku. Uporabi jeDemo() pri klicu. */
export function OznakaDemo({ kot = false, razred = "" }) {
  return html`<small class=${"oznaka-demo" + (kot ? " demo-kot" : "") + (razred ? " " + razred : "")}>${t("Demo")}</small>`;
}

/** Jasno besedilo namesto gumba za nakup na demo klubu (dogodek, VIP mize, nakupni listi). */
export function DemoBesedilo() {
  return html`<p class="opomba-okvir demo-besedilo" role="status"><${Ikona} ime="info" velikost=${18} />${t("This is a demo club. Tickets can't be bought.")}</p>`;
}

/** Neobvezno polje »Promo code« na nakupnem listu navadnih vstopnic (samo statistika: cena se ne spremeni, brez gumba »Apply«).
    Vrednost vedno trim (prazno = polja ne posljemo); velike crke naredi strežnik. Napaka (promo_code_invalid) je ob polju. */
export const promoKoda = v => String(v || "").trim();
export function PromoPolje({ vrednost, spremeni, napaka, onemogoceno }) {
  return html`<label class="polje-oznaceno nakup-promo"><span>${t("Promo code (optional)")}</span>
    <input type="text" name="promo_code" value=${vrednost} maxlength="40" onInput=${x => spremeni(x.target.value)} disabled=${onemogoceno}
      autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" aria-invalid=${napaka ? "true" : "false"} />
    ${napaka ? html`<small class="napaka-besedilo" role="alert">${napaka}</small>` : null}
  </label>`;
}

/** Zaklep gumba po omejitvi streznika (503 semafor nakupov): [zaklenjeno, zakleni(sekunde)]. Samo cas, brez ponovitve zahteve. */
export function useZaklep() {
  const [konec, setKonec] = useState(0);
  useEffect(() => {
    if (!konec) return undefined;
    const id = setTimeout(() => setKonec(0), Math.max(0, konec - Date.now()));
    return () => clearTimeout(id);
  }, [konec]);
  return [konec > 0, sekunde => setKonec(Date.now() + sekunde * 1000)];
}

export function Ikona({ ime, velikost = 20, debelina = 2, razred = "" }) {
  const vozlisca = IKONE[ime] || [];
  return html`<svg class=${"ikona " + razred} width=${velikost} height=${velikost} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width=${debelina} stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">
    ${vozlisca.map(([el, atr]) => html`<${el} ...${atr} />`)}
  </svg>`;
}

/** Slika v okvirju (kot Color.clear.overlay(...).clipped() na iOS): object-fit cover, lena. */
export function Slika({ src, sirina = 600, alt = "", razred = "", nujna = false }) {
  const [nalozena, setNalozena] = useState(false);
  const [napaka, setNapaka] = useState(false);
  const url = slika(src, sirina);
  if (!url || napaka) return html`<div class=${"slika slika-prazna " + razred} role=${alt ? "img" : null} aria-label=${alt || null}></div>`;
  return html`<div class=${"slika " + razred + (nalozena ? " nalozena" : "")}>
    <img src=${url} alt=${alt} loading=${nujna ? "eager" : "lazy"} decoding="async"
      fetchpriority=${nujna ? "high" : null}
      onLoad=${() => setNalozena(true)} onError=${() => setNapaka(true)} />
  </div>`;
}

/** Plakat dogodka v okvirju (okvir se NE spremeni): cel plakat (object-fit: contain), prostor okoli njega zapolni zamegljena,
    potemnjena kopija istega plakata (cover; majhna Cloudinary razlicica z zameglitvijo, brez backdrop-filter). Isti API kot Slika.
    Uporabi povsod, kjer je plakat dogodka; logotipi, avatarji in slike klubov ostanejo na Slika. */
export function Plakat({ src, sirina = 600, alt = "", razred = "", nujna = false }) {
  const [nalozena, setNalozena] = useState(false);
  const [napaka, setNapaka] = useState(false);
  const url = slika(src, sirina);
  if (!url || napaka) return html`<div class=${"slika slika-prazna " + razred} role=${alt ? "img" : null} aria-label=${alt || null}></div>`;
  const ozadje = slikaZamegljena(src);
  return html`<div class=${"slika plakat " + razred + (nalozena ? " nalozena" : "")}>
    <img class=${"plakat-ozadje" + (ozadje.cssZamegli ? " css-zamegli" : "")} src=${ozadje.url} alt="" aria-hidden="true" loading=${nujna ? "eager" : "lazy"} decoding="async" />
    <img class="plakat-slika" src=${url} alt=${alt} loading=${nujna ? "eager" : "lazy"} decoding="async"
      fetchpriority=${nujna ? "high" : null}
      onLoad=${() => setNalozena(true)} onError=${() => setNapaka(true)} />
  </div>`;
}

export function Avatar({ url, velikost = 36, ime = "" }) {
  const zacetnica = (ime || "").charAt(0).toUpperCase();
  return html`<span class="avatar" style=${{ width: velikost + "px", height: velikost + "px" }}>
    ${url ? html`<${Slika} src=${url} sirina=${velikost * 3} alt="" />`
          : zacetnica ? html`<span class="avatar-crka" style=${{ fontSize: Math.round(velikost * 0.42) + "px" }}>${zacetnica}</span>`
          : html`<${Ikona} ime="user" velikost=${Math.round(velikost * 0.5)} />`}
  </span>`;
}

/** Glava potisnjenega zaslona: gumb nazaj (+ neobvezen naslov). */
export function GlavaNazaj({ naslov, rezerva = "/app", prosojna = false }) {
  return html`<div class=${"glava-nazaj" + (prosojna ? " prosojna" : "")}>
    <button class="krog-gumb" type="button" onClick=${() => nazaj(rezerva)} aria-label=${t("Back")}>
      <${Ikona} ime="chevron-left" velikost=${22} />
    </button>
    ${naslov ? html`<h1 class="glava-naslov">${naslov}</h1>` : null}
  </div>`;
}

export function NaslovSekcije({ naslov, desno }) {
  return html`<div class="sekcija-glava"><h2>${naslov}</h2>${desno || null}</div>`;
}

export function Nalaganje() {
  return html`<div class="nalaganje" role="status" aria-label=${t("Loading")}><span class="vrtavka"></span></div>`;
}

export function Skeleton({ sirina = 150, visina = 200, stevilo = 3 }) {
  return html`<div class="vrsta-drsna" aria-hidden="true">
    ${Array.from({ length: stevilo }, (_, i) => html`<div key=${i} class="skeleton" style=${{ width: sirina + "px", height: visina + "px" }}></div>`)}
  </div>`;
}

export function Napaka({ besedilo, znova }) {
  if (!besedilo) return null;
  return html`<div class="napaka-blok" role="alert">
    <p>${besedilo}</p>
    ${znova ? html`<button type="button" class="povezava-gumb" onClick=${znova}>${t("Try again")}</button>` : null}
  </div>`;
}

/** Pokoncna kartica dogodka s plakatom in spodnjim pasom (EventPosterCard.swift). */
export function KarticaDogodka({ dogodek: e, klub, sirina = 150 }) {
  const z = znacka(e);
  return html`<a class="kartica-dogodka" href=${"/app/event/" + e.id} style=${{ width: sirina + "px" }}>
    <div class="kd-plakat">
      ${e.poster_url ? html`<${Plakat} src=${e.poster_url} sirina=${sirina * 2} alt="" />`
                     : html`<div class="plakat-prazen"><${Ikona} ime="music" velikost=${32} /></div>`}
      ${z ? html`<span class=${"znacka" + (jeRazprodan(e) ? " rdeca" : "")}>${z}</span>` : null}
      ${jeDemo(e) ? html`<${OznakaDemo} kot=${true} />` : null}
      <div class="kd-pas">
        <div class="kd-besedilo">
          <strong>${e.title}</strong>
          ${klub ? html`<span>${klub}</span>` : null}
          ${e._zacetek ? html`<span>${danInUra(e._zacetek)}</span>` : null}
        </div>
        <span class="kd-locilo"></span>
        <span class="kd-cena">${napisCene(e)}</span>
      </div>
    </div>
  </a>`;
}

export function VrstaDogodkov({ dogodki, kluby }) {
  return html`<div class="vrsta-drsna">
    ${dogodki.map(e => html`<${KarticaDogodka} key=${e.id} dogodek=${e} klub=${kluby.get(e.club_id)?.name} />`)}
  </div>`;
}

/** Siroka kartica kluba (Suggestions): prva slika slideshowa, zatemnjena, ime na sredini. */
export function KarticaPredloga({ klub }) {
  return html`<a class="kartica-predloga" href=${"/app/club/" + klub.id}>
    ${klub._slike[0] ? html`<${Slika} src=${klub._slike[0]} sirina=${400} alt="" />`
                     : html`<div class="plakat-prazen"><${Ikona} ime="music" velikost=${26} /></div>`}
    <span class="kp-senca"></span>
    ${jeDemo(klub) ? html`<${OznakaDemo} kot=${true} />` : null}
    <strong>${klub.name}</strong>
  </a>`;
}

/** Kvadratni logo kluba z imenom pod njim (In your area). */
export function KarticaLogo({ klub, razdalja }) {
  return html`<a class="kartica-logo" href=${"/app/club/" + klub.id}>
    <span class="kl-slika">
      ${klub.logo_url ? html`<${Slika} src=${klub.logo_url} sirina=${250} alt="" />`
                      : html`<span class="kl-crka">${klub.name.charAt(0).toUpperCase()}</span>`}
      ${jeDemo(klub) ? html`<${OznakaDemo} kot=${true} />` : null}
      ${razdalja ? html`<span class="kl-razdalja"><${Ikona} ime="navigation" velikost=${11} /> ${razdalja}</span>` : null}
    </span>
    <strong>${klub.name}</strong>
  </a>`;
}

/** Vrstica s sliko (iskanje, seznami). */
export function Vrstica({ href, slikaUrl, ikona = "building", naslov, podnaslov, desno, demo = false, plakat = false }) {
  return html`<a class="vrstica" href=${href}>
    <span class="vrstica-slika">${slikaUrl ? html`<${plakat ? Plakat : Slika} src=${slikaUrl} sirina=${120} alt="" />` : html`<${Ikona} ime=${ikona} velikost=${20} />`}</span>
    <span class="vrstica-besedilo"><strong>${naslov}</strong>${podnaslov ? html`<span>${podnaslov}</span>` : null}</span>
    ${demo ? html`<${OznakaDemo} />` : null}
    ${desno || html`<${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />`}
  </a>`;
}

/** Spodnji list (sheet). Zapre ga Escape, klik na ozadje ali gumb. Fokus gre v list. */
/** brezZapiranja: med letecim nakupom lista ni mogoce zapreti (gumb, ozadje, Escape) - uporabnik bi izgubil odgovor. */
export function List({ odprt, zapri, naslov, children, brezZapiranja = false }) {
  const ref = useRef(null);
  const zapriRef = useRef(zapri);
  const brezRef = useRef(brezZapiranja);
  brezRef.current = brezZapiranja;
  zapriRef.current = () => { if (!brezRef.current) zapri(); };   // Escape vedno poklice zadnji zapri (npr. po uspehu drug kot ob odprtju)
  useEffect(() => {
    if (!odprt) return;
    const prej = document.activeElement;
    const tipka = e => { if (e.key === "Escape") zapriRef.current(); };
    document.addEventListener("keydown", tipka);
    document.body.classList.add("brez-drsenja");
    ref.current && ref.current.focus();
    return () => {
      document.removeEventListener("keydown", tipka);
      document.body.classList.remove("brez-drsenja");
      prej && prej.focus && prej.focus();
    };
  }, [odprt]);
  if (!odprt) return null;
  return html`<div class="list-ozadje" onClick=${e => { if (e.target === e.currentTarget && !brezZapiranja) zapri(); }}>
    <div class="list" role="dialog" aria-modal="true" aria-label=${naslov} tabindex="-1" ref=${ref}>
      <div class="list-rocaj" aria-hidden="true"></div>
      <div class="list-glava">
        <h2>${naslov}</h2>
        <button type="button" class="krog-gumb majhen" onClick=${zapri} disabled=${brezZapiranja} aria-label=${t("Close")}><${Ikona} ime="x" velikost=${18} /></button>
      </div>
      <div class="list-vsebina">${children}</div>
    </div>
  </div>`;
}

/** Vrstica dogodka (EventCardAPI .clubRow): majhen plakat, naslov, zanri, datum, cena desno. */
export function VrsticaDogodka({ dogodek: e, klub, desno }) {
  return html`<a class="vrstica-dogodka" href=${"/app/event/" + e.id}>
    <span class="vd-slika"><${Plakat} src=${e.poster_url} sirina=${150} alt="" /></span>
    <span class="kv-besedilo"><strong>${e.title}</strong>
      ${klub ? html`<span>${klub}</span>` : e.genres.length ? html`<span>${e.genres.map(zanrIme).join(" • ")}</span>` : null}
      <span>${danKratek(e._zacetek)}</span></span>
    ${jeDemo(e) ? html`<${OznakaDemo} />` : null}
    ${desno || html`<span class="vd-cena">${napisCene(e)}</span>`}
  </a>`;
}
