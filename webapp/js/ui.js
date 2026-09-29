/* Skupni gradniki vmesnika (prevod Core/Components iz iOS). Vse vrednosti gredo v DOM prek
   htm predloge kot besedilo ali atribut - nikoli innerHTML. */
import { html, useEffect, useRef, useState } from "./lib.js";
import { IKONE } from "./ikone.js";
import { t } from "./i18n.js";
import { nazaj } from "./usmerjanje.js";
import { napisCene, znacka, jeRazprodan, danInUra, danKratek, zanrIme, slika } from "./oblika.js";

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
      ${e.poster_url ? html`<${Slika} src=${e.poster_url} sirina=${sirina * 2} alt="" />`
                     : html`<div class="plakat-prazen"><${Ikona} ime="music" velikost=${32} /></div>`}
      ${z ? html`<span class=${"znacka" + (jeRazprodan(e) ? " rdeca" : "")}>${z}</span>` : null}
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
    <strong>${klub.name}</strong>
  </a>`;
}

/** Kvadratni logo kluba z imenom pod njim (In your area). */
export function KarticaLogo({ klub, razdalja }) {
  return html`<a class="kartica-logo" href=${"/app/club/" + klub.id}>
    <span class="kl-slika">
      ${klub.logo_url ? html`<${Slika} src=${klub.logo_url} sirina=${250} alt="" />`
                      : html`<span class="kl-crka">${klub.name.charAt(0).toUpperCase()}</span>`}
      ${razdalja ? html`<span class="kl-razdalja"><${Ikona} ime="navigation" velikost=${11} /> ${razdalja}</span>` : null}
    </span>
    <strong>${klub.name}</strong>
  </a>`;
}

/** Vrstica s sliko (iskanje, seznami). */
export function Vrstica({ href, slikaUrl, ikona = "building", naslov, podnaslov, desno }) {
  return html`<a class="vrstica" href=${href}>
    <span class="vrstica-slika">${slikaUrl ? html`<${Slika} src=${slikaUrl} sirina=${120} alt="" />` : html`<${Ikona} ime=${ikona} velikost=${20} />`}</span>
    <span class="vrstica-besedilo"><strong>${naslov}</strong>${podnaslov ? html`<span>${podnaslov}</span>` : null}</span>
    ${desno || html`<${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />`}
  </a>`;
}

/** Spodnji list (sheet). Zapre ga Escape, klik na ozadje ali gumb. Fokus gre v list. */
export function List({ odprt, zapri, naslov, children }) {
  const ref = useRef(null);
  const zapriRef = useRef(zapri);
  zapriRef.current = zapri;   // Escape vedno poklice zadnji zapri (npr. po uspehu drug kot ob odprtju)
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
  return html`<div class="list-ozadje" onClick=${e => { if (e.target === e.currentTarget) zapri(); }}>
    <div class="list" role="dialog" aria-modal="true" aria-label=${naslov} tabindex="-1" ref=${ref}>
      <div class="list-rocaj" aria-hidden="true"></div>
      <div class="list-glava">
        <h2>${naslov}</h2>
        <button type="button" class="krog-gumb majhen" onClick=${zapri} aria-label=${t("Close")}><${Ikona} ime="x" velikost=${18} /></button>
      </div>
      <div class="list-vsebina">${children}</div>
    </div>
  </div>`;
}

/** Vrstica dogodka (EventCardAPI .clubRow): majhen plakat, naslov, zanri, datum, cena desno. */
export function VrsticaDogodka({ dogodek: e, klub, desno }) {
  return html`<a class="vrstica-dogodka" href=${"/app/event/" + e.id}>
    <span class="vd-slika"><${Slika} src=${e.poster_url} sirina=${150} alt="" /></span>
    <span class="kv-besedilo"><strong>${e.title}</strong>
      ${klub ? html`<span>${klub}</span>` : e.genres.length ? html`<span>${e.genres.map(zanrIme).join(" • ")}</span>` : null}
      <span>${danKratek(e._zacetek)}</span></span>
    ${desno || html`<span class="vd-cena">${napisCene(e)}</span>`}
  </a>`;
}
