/* Stran kluba (ClubView.swift): slideshow do 3 slik, ime, sledilci + Follow, Popular (koncani
   s posnetkom), video kluba, Coming Soon, zemljevid (povezava), kontakti, opis. Cenik bara v listu. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send, zabeleziOgled } from "../api.js";
import { useSeja } from "../seja.js";
import { sporocilo } from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import * as P from "../podatki.js";
import { denar, zanrIme } from "../oblika.js";
import { Ikona, Slika, GlavaNazaj, Nalaganje, Napaka, List, VrsticaDogodka } from "../ui.js";

export function Klub({ id }) {
  const prijavljen = useSeja(s => s.prijavljen);
  const [k, setK] = useState(null);
  const [popularni, setPopularni] = useState([]);
  const [kmalu, setKmalu] = useState([]);
  const [napaka, setNapaka] = useState(null);
  const [nalaga, setNalaga] = useState(true);
  const [sledi, setSledi] = useState({ da: false, st: 0, tece: false });
  const [cenik, setCenik] = useState(false);

  async function nalozi() {
    setNalaga(true); setNapaka(null);
    try {
      const [klub, pop, up] = await Promise.all([P.klub(id), P.popularniKluba(id), P.dogodki({ upcoming: true, clubId: id })]);
      setK(klub); setPopularni(pop); setKmalu(up);
      setSledi({ da: !!klub.is_following, st: klub.followers_count, tece: false });
      document.title = klub.name + " · Outly";
    } catch (e) { setNapaka(sporocilo(e)); }
    setNalaga(false);
  }
  useEffect(() => { nalozi(); zabeleziOgled({ club_id: Number(id) }); }, [id, prijavljen]);

  async function preklopiSledenje() {
    if (!prijavljen) { navigiraj(`/app/login?next=${encodeURIComponent("/app/club/" + id)}`); return; }
    if (sledi.tece) return;
    const novo = !sledi.da, prej = sledi;
    setSledi({ da: novo, st: Math.max(0, sledi.st + (novo ? 1 : -1)), tece: true });
    try {
      const r = await send(`/clubs/${id}/follow`, { method: novo ? "PUT" : "DELETE", auth: true });
      setSledi({ da: r && "following" in r ? !!r.following : novo, st: r && r.followers_count != null ? r.followers_count : Math.max(0, prej.st + (novo ? 1 : -1)), tece: false });
    } catch (e) { setSledi({ ...prej, tece: false }); setNapaka(sporocilo(e)); }
  }

  if (!k && napaka) return html`<div class="zaslon"><${GlavaNazaj} /><${Napaka} besedilo=${napaka} znova=${nalozi} /></div>`;
  if (!k) return html`<div class="zaslon"><${GlavaNazaj} /><${Nalaganje} /></div>`;

  const kraj = [k.city, k.country].map(x => (x || "").trim()).filter(Boolean).join(", ");
  return html`<div class="zaslon klub">
    <div class="klub-glava">
      <${Diaprojekcija} slike=${k._slike} ime=${k.name} />
      <span class="hero-senca spodaj" aria-hidden="true"></span>
      <${GlavaNazaj} prosojna=${true} />
      <h1 class="klub-ime">${k.name}</h1>
    </div>

    <div class="klub-info">
      <span class="okrogla-slika velika">${k.logo_url ? html`<${Slika} src=${k.logo_url} sirina=${190} alt="" />` : html`<${Ikona} ime="building" velikost=${24} />`}</span>
      <div class="klub-meta">
        ${kraj ? html`<span>${kraj}</span>` : null}
        ${k.genres.length ? html`<span>${k.genres.map(zanrIme).join(" • ")}</span>` : null}
        <span>${t("Min age: {n}+", { n: k.min_age })}</span>
      </div>
      <div class="klub-sledenje">
        <span class="sledilci"><${Ikona} ime="users" velikost=${14} /> <strong>${kratko(sledi.st)}</strong> ${t("followers")}</span>
        <button type="button" class=${"gumb-sledi" + (sledi.da ? " sledim" : "")} onClick=${preklopiSledenje}
          disabled=${sledi.tece} aria-pressed=${sledi.da}>
          <${Ikona} ime=${sledi.da ? "check" : "plus"} velikost=${14} debelina=${2.6} /> ${sledi.da ? t("Following") : t("Follow")}
        </button>
      </div>
    </div>
    <${Napaka} besedilo=${napaka} />

    <${SeznamDogodkov} naslov=${t("Popular")} dogodki=${popularni} ime=${k.name} nalaga=${nalaga} />

    ${k.video_url
      ? html`<video class="klub-video" src=${k.video_url} autoplay muted loop playsinline preload="metadata" aria-label=${t("Club video")}></video>`
      : html`<div class="klub-video prazen"><${Ikona} ime="play" velikost=${30} /><span>${t("Club video coming soon")}</span></div>`}

    <${SeznamDogodkov} naslov=${t("Coming Soon")} dogodki=${kmalu} ime=${k.name} nalaga=${nalaga} />

    <button type="button" class="kartica-vrstica" onClick=${() => setCenik(true)}>
      <${Ikona} ime="wine" velikost=${20} />
      <span class="kv-besedilo"><strong>${t("Bar prices")}</strong></span>
      <span class="utisano">${k.bar_prices.length ? t("{n} items", { n: k.bar_prices.length }) : t("Not added yet")}</span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </button>

    ${k.lat != null && k.lng != null ? html`<a class="kartica-vrstica" target="_blank" rel="noopener noreferrer"
      href=${`https://www.openstreetmap.org/?mlat=${k.lat}&mlon=${k.lng}#map=17/${k.lat}/${k.lng}`}>
      <${Ikona} ime="map-pin" velikost=${20} />
      <span class="kv-besedilo"><strong>${t("Open in maps")}</strong>${k.address ? html`<span>${k.address}</span>` : null}</span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>` : null}

    <section class="blok-besedila">
      <h2 class="podnaslov">${t("Contact")}</h2>
      <${Kontakt} oznaka=${t("Email")} vrednost=${k.contact_email} href=${k.contact_email ? "mailto:" + k.contact_email : null} />
      <${Kontakt} oznaka=${t("Phone")} vrednost=${k.contact_phone} href=${k.contact_phone ? "tel:" + k.contact_phone.replace(/[^\d+]/g, "") : null} />
      <${Kontakt} oznaka=${t("Instagram")} vrednost=${k.instagram} href=${instagram(k.instagram)} />
      <${Kontakt} oznaka=${t("Website")} vrednost=${k.website} href=${spletna(k.website)} />
    </section>

    ${(k.description || "").trim() ? html`<section class="blok-besedila">
      <h2 class="podnaslov">${t("About the club")}</h2><p class="besedilo-opis">${k.description}</p>
    </section>` : null}

    <${CenikList} odprt=${cenik} zapri=${() => setCenik(false)} klub=${k} />
  </div>`;
}

const kratko = n => (n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1) + "k" : Math.round(n / 1000) + "k");

/* Povezave iz podatkov kluba: samo http(s), nikoli javascript: ipd. */
function spletna(v) {
  const s = (v || "").trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : "https://" + s;
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
}
function instagram(v) {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return spletna(s);
  const ime = s.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(ime) ? "https://instagram.com/" + ime : null;
}

function Kontakt({ oznaka, vrednost, href }) {
  const v = (vrednost || "").trim();
  return html`<div class="info-vrstica razmaknjena"><span class="info-oznaka">${oznaka}:</span>
    ${v && href ? html`<a href=${href} target=${href.startsWith("http") ? "_blank" : null} rel="noopener noreferrer">${v}</a>` : html`<span>${v || "-"}</span>`}
  </div>`;
}

function SeznamDogodkov({ naslov, dogodki, ime, nalaga }) {
  return html`<section class="blok-besedila">
    <h2 class="podnaslov">${naslov}</h2>
    ${!dogodki.length && !nalaga ? html`<p class="utisano">${t("No events.")}</p>` : null}
    ${dogodki.map(e => html`<${VrsticaDogodka} key=${e.id} dogodek=${e} />`)}
  </section>`;
}

/* Slideshow: samodejno vsakih 4 s, puscici, pike; rocni premik ponastavi stevec. Samo transform. */
function Diaprojekcija({ slike, ime }) {
  const [i, setI] = useState(0);
  const [premik, setPremik] = useState(0);
  const n = slike.length;
  const zmanjsanoGibanje = useRef(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (n < 2 || zmanjsanoGibanje.current) return;
    const id = setInterval(() => setI(x => (x + 1) % n), 4000);
    return () => clearInterval(id);
  }, [n, premik]);
  if (!n) return html`<div class="diaprojekcija prazna"></div>`;
  const pojdi = smer => { setI(x => (x + smer + n) % n); setPremik(p => p + 1); };
  return html`<div class="diaprojekcija" aria-roledescription="carousel" aria-label=${ime}>
    <div class="dia-trak" style=${{ transform: `translateX(${-i * 100}%)` }}>
      ${slike.map((s, j) => html`<div class="dia-slika" key=${j} aria-hidden=${j !== i}><${Slika} src=${s} sirina=${1000} alt="" nujna=${j === 0} /></div>`)}
    </div>
    ${n > 1 ? html`
      <button type="button" class="dia-puscica levo" onClick=${() => pojdi(-1)} aria-label=${t("Previous photo")}><${Ikona} ime="chevron-left" velikost=${14} /></button>
      <button type="button" class="dia-puscica desno" onClick=${() => pojdi(1)} aria-label=${t("Next photo")}><${Ikona} ime="chevron-right" velikost=${14} /></button>
      <div class="dia-pike" aria-hidden="true">${slike.map((_, j) => html`<span class=${j === i ? "aktivna" : ""}></span>`)}</div>` : null}
  </div>`;
}

/* Cenik bara (BarPricesView.swift): po kategorijah, "Other" na koncu, centi -> evri. */
export function CenikList({ odprt, zapri, klub }) {
  if (!odprt) return null;
  const postavke = (klub && klub.bar_prices) || [];
  const skupine = new Map();
  for (const p of postavke) {
    const kat = (p.category || "").trim() || t("Other");
    if (!skupine.has(kat)) skupine.set(kat, []);
    skupine.get(kat).push(p);
  }
  const drugo = t("Other");
  const kategorije = [...skupine.keys()].sort((a, b) => (a === drugo) - (b === drugo));
  return html`<${List} odprt=${true} zapri=${zapri} naslov=${t("Bar prices")}>
    ${klub ? html`<p class="utisano">${klub.name}</p>` : null}
    ${!postavke.length ? html`<p class="utisano">${t("The club has not added bar prices yet.")}</p>` : null}
    ${kategorije.map(kat => html`<div class="cenik-skupina" key=${kat}>
      <h3 class="nadnapis">${kat.toUpperCase()}</h3>
      ${skupine.get(kat).map((p, j) => html`<div class="cenik-vrsta" key=${j}><span>${p.name}</span><strong>${denar(p.price_cents || 0)}</strong></div>`)}
    </div>`)}
  <//>`;
}
