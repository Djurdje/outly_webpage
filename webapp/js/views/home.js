/* Domaci zaslon (HomeView.swift): glava, "Where to?" + filtri, Suggestions, Tonight/This week,
   Interested events, Last week's biggest hits, In your area, Big events coming up,
   This weekend/Trending, Discover your genre, See all events.
   Seznami se filtrirajo na odjemalcu (starost in zanri iz profila, filtri, razdalja) - kot iOS. */
import { html, useEffect, useMemo, useState, useRef } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { useSeja } from "../seja.js";
import { sporocilo } from "../napake.js";
import * as P from "../podatki.js";
import {
  jeDanes, jeTaVikend, jeRazprodan, razdaljaKm, napisRazdalje, pozdrav, danInUra,
  cena, znacka, zanrIme, steviloDogodkov, normalizirajDogodek, napisPrizorisca, prizorisce
} from "../oblika.js";
import {
  Ikona, Slika, Avatar, NaslovSekcije, Skeleton, Napaka, VrstaDogodkov, KarticaPredloga,
  KarticaLogo, KarticaDogodka
} from "../ui.js";
import { zahtevajLokacijo, useLokacija } from "../lokacija.js";
import { SekcijaNacrtov, naloziNacrte } from "./prijatelji.js";
import { Zvonec, MeniObvestil } from "./obvestila.js";
import { useNastavitve, mejaRazdalje } from "../nastavitve.js";
import { useFiltri, FiltriList, ustrezaDogodek, ustrezaKlub, filtriAktivni } from "./filtri.js";

/* Vrstni red predlogov se premesa ENKRAT na sejo strani (ne ob vsakem izrisu - iOS past). */
let vrstniRedPredlogov = null;

export function Home() {
  const me = useSeja(s => s.me);
  const prijavljen = useSeja(s => s.prijavljen);
  const [stanje, setStanje] = useState({ nalaga: true, napaka: null, klubi: [], prihajajoci: [], pretekli: [], zanri: [] });
  const [moji, setMoji] = useState([]);
  const [nacrti, setNacrti] = useState([]);
  const [obvestila, setObvestila] = useState(false);
  const nast = useNastavitve();
  const [filtriOdprti, setFiltriOdprti] = useState(false);
  const lok = useLokacija();
  const f = useFiltri();

  async function nalozi(sveze = false) {
    setStanje(s => ({ ...s, nalaga: true, napaka: null }));
    try {
      const [klubi, prihajajoci, pretekli] = await Promise.all([
        P.klubi(sveze), P.dogodki({ upcoming: true, sveze }), P.dogodki({ upcoming: false, sveze })
      ]);
      const zanri = await P.zanri().catch(() => []);
      if (!vrstniRedPredlogov) vrstniRedPredlogov = premesaj(klubi.map(k => k.id));
      setStanje({ nalaga: false, napaka: null, klubi, prihajajoci, pretekli, zanri });
    } catch (e) {
      setStanje(s => ({ ...s, nalaga: false, napaka: sporocilo(e) }));
    }
  }

  useEffect(() => { nalozi(); }, []);
  useEffect(() => {
    if (!prijavljen) { setMoji([]); setNacrti([]); return; }
    naloziNacrte().then(setNacrti).catch(() => setNacrti([]));   // ni kriticno (kot iOS)
    send("/me/plans", { auth: true })
      .then(r => setMoji(((r && r.events) || []).map(normalizirajDogodek)))
      .catch(() => setMoji([]));   // ni kriticno (kot iOS): razdelek ostane prazen
  }, [prijavljen]);

  const izpeljano = useMemo(() => izpelji(stanje, me, lok, f, moji, mejaRazdalje(nast)), [stanje, me, lok, f, moji, nast]);
  return html`<div class="zaslon home">
    <h1 class="skrito">${t("Home")}</h1>
    <header class="home-glava">
      <div class="home-glava-vrsta">
        ${prijavljen
          ? html`<a class="krog-povezava" href="/app/profile" aria-label=${t("Profile")}><${Avatar} url=${me && me.avatar_url} ime=${me && me.username} velikost=${36} /></a>`
          : html`<a class="prijava-cip" href=${"/app/login?next=/app"}>${t("Sign in")}</a>`}
        <img class="home-logo" src="/assets/transperent-logo.png" alt="Outly" width="104" height="104" />
        ${prijavljen ? html`<${Zvonec} odpri=${() => setObvestila(true)} />` : html`<span class="home-glava-prostor" aria-hidden="true"></span>`}
      </div>
      <p class="home-pozdrav">${pozdrav(me && me.username)}</p>
    </header>

    <div class="kam" role="search">
      <a class="kam-iskanje" href="/app/search"><${Ikona} ime="search" velikost=${18} debelina=${2.4} /><span>${t("Where to?")}</span></a>
      <span class="kam-locilo" aria-hidden="true"></span>
      <button type="button" class="kam-filtri" onClick=${() => setFiltriOdprti(true)} aria-label=${t("Filters")}>
        <${Ikona} ime="sliders-horizontal" velikost=${19} />
        ${filtriAktivni(f) ? html`<span class="modra-pika" aria-hidden="true"></span>` : null}
      </button>
    </div>

    <${Napaka} besedilo=${stanje.napaka} znova=${() => nalozi(true)} />

    ${stanje.nalaga && !stanje.klubi.length && !stanje.prihajajoci.length
      ? html`<div class="sekcija"><div class="skeleton" style="width:120px;height:18px;border-radius:9px"></div><${Skeleton} /></div>
             <div class="sekcija"><div class="skeleton" style="width:160px;height:18px;border-radius:9px"></div><${Skeleton} sirina=${110} visina=${110} /></div>`
      : html`<${Sekcije} i=${izpeljano} lok=${lok} prijavljen=${prijavljen} nacrti=${nacrti} />`}

    <${FiltriList} odprt=${filtriOdprti} zapri=${() => setFiltriOdprti(false)}
      mesta=${izpeljano.mesta} imaLokacijo=${!!lok.polozaj} />
    ${prijavljen ? html`<${MeniObvestil} odprt=${obvestila} zapri=${() => setObvestila(false)} />` : null}
  </div>`;
}

function Sekcije({ i, lok, prijavljen, nacrti }) {
  const { klubiPoId } = i;
  return html`
    ${i.uradni.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov="Organized by Outly" />
      <${KarticaVelika} dogodek=${i.uradni[0]} klub=${klubiPoId.get(i.uradni[0].club_id)} napis=${napisPrizorisca(i.uradni[0])} />
      ${i.uradni.length > 1 ? html`<div class="vrsta-drsna">${i.uradni.slice(1).map(e => html`<${KarticaDogodka} key=${e.id} dogodek=${e} klub=${klubiPoId.get(e.club_id)?.name} />`)}</div>` : null}
    </section>` : null}

    ${i.predlogi.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Suggestions")} />
      <div class="vrsta-drsna">${i.predlogi.map(k => html`<${KarticaPredloga} key=${k.id} klub=${k} />`)}</div>
    </section>` : null}

    ${i.nocoj.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Tonight")} /><${VrstaDogodkov} dogodki=${i.nocoj} kluby=${klubiPoId} />
    </section>` : i.tedenl.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("This week")} /><${VrstaDogodkov} dogodki=${i.tedenl} kluby=${klubiPoId} />
    </section>` : null}

    ${i.zanimivi.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Interested events")} desno=${html`<a class="vec" href="/app/interested">${t("See all")}</a>`} />
      <div class="vrsta-drsna">${i.zanimivi.map(e => html`<${KarticaDogodka} key=${e.id} dogodek=${e} klub=${e.club_name || klubiPoId.get(e.club_id)?.name} />`)}</div>
    </section>` : null}

    ${i.hit ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Last week's biggest hits")} />
      <${KarticaHit} dogodek=${i.hit.dogodek} klub=${klubiPoId.get(i.hit.dogodek.club_id)} napis=${i.hit.napis} />
    </section>` : null}

    ${i.obmocje.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("In your area")} desno=${lok.polozaj ? null : html`
        <button type="button" class="vec" onClick=${zahtevajLokacijo} disabled=${lok.isce}>
          <${Ikona} ime="locate-fixed" velikost=${14} /> ${lok.isce ? t("Locating...") : t("Use my location")}
        </button>`} />
      ${lok.napaka ? html`<p class="opomba">${lok.napaka}</p>` : null}
      <div class="vrsta-drsna">${i.obmocje.map(k => html`<${KarticaLogo} key=${k.id} klub=${k} razdalja=${napisRazdalje(i.razdalje.get(k.id))} />`)}</div>
    </section>` : null}

    ${prijavljen ? html`<${SekcijaNacrtov} nacrti=${nacrti} />` : null}

    ${i.velik ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Big events coming up")} />
      <${KarticaVelika} dogodek=${i.velik} klub=${klubiPoId.get(i.velik.club_id)} />
    </section>` : null}

    ${i.vikend.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("This weekend")} /><${VrstaDogodkov} dogodki=${i.vikend} kluby=${klubiPoId} />
    </section>` : i.trending.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Trending now")} /><${VrstaDogodkov} dogodki=${i.trending} kluby=${klubiPoId} />
    </section>` : null}

    ${i.zanri.length ? html`<section class="sekcija">
      <${NaslovSekcije} naslov=${t("Discover your genre")} />
      <div class="zanri-seznam">${i.zanri.map(z => html`<${VrsticaZanra} key=${z.zanr} ...${z} />`)}</div>
    </section>` : null}

    ${!i.imaKaj ? html`<div class="prazno">
      <${Ikona} ime="music" velikost=${36} razred="modra" />
      <strong>${t("Nothing on yet")}</strong><span>${t("Clubs and events will show up here.")}</span>
    </div>` : null}

    <a class="gumb-siv" href="/app/events">${t("See all events")}</a>
  `;
}

/* ---------- izpeljani seznami (kot racunane lastnosti HomeView) ---------- */
function izpelji(s, me, lok, f, moji, maxKm) {
  const klubiPoId = P.poId(s.klubi);
  const starost = me && me.date_of_birth ? letaIz(me.date_of_birth) : null;
  const mojiZanri = new Set(((me && me.genres) || []).map(g => g.toLowerCase()));
  const razdalje = new Map();
  if (lok.polozaj) for (const k of s.klubi) { const d = razdaljaKm(lok.polozaj, k); if (d != null) razdalje.set(k.id, d); }

  const filtriraniKlubi = s.klubi.filter(k => {
    if (starost != null && k.min_age > starost) return false;
    if (mojiZanri.size && k.genres.length && !k.genres.some(g => mojiZanri.has(g.toLowerCase()))) return false;
    // Najvecja razdalja iz "My preferences" (kot iOS prefs.maxDistanceKm) - samo ko je lokacija znana.
    if (razdalje.has(k.id) && razdalje.get(k.id) > maxKm) return false;
    return ustrezaKlub(f, k, razdalje.get(k.id));
  });
  const dovoljeni = new Set(filtriraniKlubi.map(k => k.id));
  const predlogi = (vrstniRedPredlogov || []).filter(id => dovoljeni.has(id)).map(id => klubiPoId.get(id)).filter(Boolean).slice(0, 8);

  const casZ = e => (e._zacetek ? e._zacetek.getTime() : Infinity);
  const razvrsceni = s.prihajajoci
    .filter(e => ustrezaDogodek(f, e) && ustrezaKlubuDogodka(f, e, klubiPoId, razdalje))
    .sort((a, b) => casZ(a) - casZ(b));
  const zdaj = Date.now();
  const nocoj = razvrsceni.filter(jeDanes);
  const tedenl = razvrsceni.filter(e => casZ(e) - zdaj < 7 * 86400e3);
  const vikend = razvrsceni.filter(jeTaVikend);
  const trending = s.prihajajoci.filter(e => e.sold_count > 0 || jeRazprodan(e))
    .sort((a, b) => b.sold_count - a.sold_count || casZ(a) - casZ(b)).slice(0, 8);

  // "Organized by Outly": prihajajoci dogodki klubov z is_official (najblizji najprej); v "Big events" se ne ponovijo.
  // NAMERNO ignorira filter mesta (in razdalje): Outlyjevi dogodki so vedno na vrhu (odlocitev 9. 10. 2026); filtri zanrov,
  // starosti in cene veljajo (ustrezaDogodek).
  const uradni = s.prihajajoci.filter(e => { const k = klubiPoId.get(e.club_id); return k && k.is_official === true && ustrezaDogodek(f, e); })
    .sort((a, b) => casZ(a) - casZ(b));
  const uradniId = new Set(uradni.map(e => e.id));

  let velik = null;
  for (const e of razvrsceni) {
    if (uradniId.has(e.id)) continue;
    if (!velik) { velik = e; continue; }
    const a = [e.capacity || 0, e.sold_count, -casZ(e)], b = [velik.capacity || 0, velik.sold_count, -casZ(velik)];
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) velik = e;
  }

  const teden = zdaj - 7 * 86400e3;
  const hitPretekli = s.pretekli.filter(e => e.sold_count > 0 && e._zacetek && e._zacetek.getTime() >= teden)
    .sort((a, b) => b.sold_count - a.sold_count)[0];
  const hit = hitPretekli ? { dogodek: hitPretekli, napis: t("Last week's biggest hit") }
    : trending[0] ? { dogodek: trending[0], napis: t("Trending right now") } : null;

  // Organizator nima naslova ne pina - v "In your area" ni.
  const prizorisca = s.klubi.filter(k => !k.is_organizer);
  const blizu = lok.polozaj ? prizorisca.filter(k => razdalje.has(k.id)).sort((a, b) => razdalje.get(a.id) - razdalje.get(b.id)).slice(0, 10) : [];
  const obmocje = blizu.length ? blizu : prizorisca.slice(0, 10);

  const vsiZanri = s.zanri.length ? s.zanri : [...new Set(s.prihajajoci.flatMap(e => e.genres.map(g => g.toLowerCase())))].sort();
  const zanri = [...vsiZanri].sort((a, b) => {
    const ma = mojiZanri.has(a.toLowerCase()), mb = mojiZanri.has(b.toLowerCase());
    return ma !== mb ? (ma ? -1 : 1) : a.localeCompare(b);
  }).map(z => {
    const evs = razvrsceni.filter(e => e.genres.some(g => g.toLowerCase() === z.toLowerCase()));
    return { zanr: z, plakat: evs[0] ? evs[0].poster_url : "", stevilo: evs.length };
  });

  const zanimivi = moji.filter(e => e.my_plan === "interested" && casZ(e) >= zdaj - 6 * 3600e3).sort((a, b) => casZ(a) - casZ(b));
  // Mesta: klubi + prizorisca dogodkov organizatorjev (venue_city); mesto gostiteljskega kluba je ze med klubi.
  const mesta = [...new Set([...s.klubi.map(k => k.city), ...s.prihajajoci.map(e => e.venue_city)].map(m => (m || "").trim()).filter(Boolean))].sort();

  return {
    klubiPoId, predlogi, uradni, nocoj, tedenl, vikend, trending, velik, hit, obmocje, razdalje: blizu.length ? razdalje : new Map(),
    zanri, zanimivi, mesta, imaKaj: s.prihajajoci.length > 0 || s.klubi.length > 0 || s.nalaga || !!s.napaka
  };
}

/** Filter mesta/razdalje za dogodek: dogodek organizatorja (ali z navedenim prizoriscem) velja za mesto PRIZORISCA
    (klub gostitelj iz seznama klubov ali venue_city), ne za organizatorjev klub (ta nima mesta). */
function ustrezaKlubuDogodka(f, e, klubiPoId, razdalje) {
  const k = klubiPoId.get(e.club_id);
  if (!k) return true;
  const p = prizorisce(e);
  if (p && p.klubId != null) {
    const g = klubiPoId.get(p.klubId);
    return g ? ustrezaKlub(f, { ...k, city: g.city }, razdalje.get(g.id)) : ustrezaKlub(f, { ...k, city: "" }, undefined);
  }
  if (p) return ustrezaKlub(f, { ...k, city: p.mesto }, undefined);
  return ustrezaKlub(f, k, razdalje.get(k.id));
}

function letaIz(dob) {
  const d = new Date(dob.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const z = new Date();
  let l = z.getFullYear() - d.getFullYear();
  if (z.getMonth() < d.getMonth() || (z.getMonth() === d.getMonth() && z.getDate() < d.getDate())) l -= 1;
  return l;
}

function premesaj(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/* ---------- kartice domacega zaslona (HomeCards.swift) ---------- */
function KarticaHit({ dogodek: e, klub, napis }) {
  return html`<a class="kartica-hit" href=${"/app/event/" + e.id}>
    <div class="kh-levo">
      <span class="kh-logo">${klub && klub.logo_url ? html`<${Slika} src=${klub.logo_url} sirina=${120} alt="" />` : html`<${Ikona} ime="building" velikost=${18} />`}</span>
      <div class="kh-besedilo">
        <span class="nadnapis">${napis}</span>
        <strong>${e.title}</strong>
        <span class="kh-meta">${[klub && klub.name, danInUra(e._zacetek)].filter(Boolean).join(" · ")}</span>
        ${e.genres.length ? html`<span class="kh-zanri">${e.genres.map(g => g.toUpperCase()).join("  ")}</span>` : null}
        ${e.sold_count > 0 ? html`<span class="kh-gre">${t("{n} going", { n: e.sold_count })}</span>` : null}
      </div>
    </div>
    <div class="kh-plakat"><${Slika} src=${e.poster_url} sirina=${300} alt="" /></div>
  </a>`;
}

function KarticaVelika({ dogodek: e, klub, napis = t("BIG EVENT COMING UP") }) {
  const z = znacka(e);
  const napisGumba = jeRazprodan(e) ? t("Sold out") : cena(e) || (e.ticket_url ? t("Tickets") : t("Free"));
  return html`<a class="kartica-velika" href=${"/app/event/" + e.id}>
    <${Slika} src=${e.poster_url} sirina=${900} alt="" />
    <span class="kv-senca" aria-hidden="true"></span>
    <div class="kv-vrh">
      <span class="kv-logo">${klub && klub.logo_url ? html`<${Slika} src=${klub.logo_url} sirina=${130} alt="" />` : html`<${Ikona} ime="building" velikost=${20} />`}</span>
      <div><strong>${klub ? klub.name : ""}</strong>${napis ? html`<span class="nadnapis">${napis}</span>` : null}</div>
      ${z ? html`<span class=${"znacka staticna" + (jeRazprodan(e) ? " rdeca" : "")}>${z}</span>` : null}
    </div>
    <div class="kv-dno">
      <strong class="kv-naslov">${e.title}</strong>
      <div class="kv-vrsta">
        <span class="kv-datum"><${Ikona} ime="calendar" velikost=${14} /> ${danInUra(e._zacetek)}</span>
        <span class="kv-cena">${napisGumba}</span>
      </div>
    </div>
  </a>`;
}

function VrsticaZanra({ zanr, plakat, stevilo }) {
  return html`<a class="vrstica-zanra" href=${"/app/genre/" + encodeURIComponent(zanr)}>
    ${plakat ? html`<${Slika} src=${plakat} sirina=${500} alt="" razred="vz-slika" />` : html`<span class="vz-barva" style=${{ background: barvaZanra(zanr) }}></span>`}
    <span class="vz-senca" aria-hidden="true"></span>
    <strong>${zanrIme(zanr).toUpperCase()}</strong>
    ${stevilo > 0 ? html`<span class="vz-stevilo">${steviloDogodkov(stevilo)}</span>` : null}
    <${Ikona} ime="chevron-right" velikost=${14} />
  </a>`;
}

/* Deterministicna barva po imenu (kot GenreRow.odtenek), a samo modri/turkizni odtenki (190-230):
   pravilo "brez vijolicnih prelivov" - iOS po imenu lahko dobi tudi vijolicno (Issue #36). */
function barvaZanra(z) {
  const vsota = [...z.toLowerCase()].reduce((a, c) => a + c.codePointAt(0), 0);
  const h = 190 + (vsota % 41);
  return `linear-gradient(90deg, hsl(${h} 55% 35%), hsl(${h} 55% 35% / .4))`;
}

/* ---------- ozadje: temno modri preliv z dvema sijema, ki se ob drsenju premikata ----------
   Premik samo prek transform/opacity na eni plasti (CSS spremenljivka --t), requestAnimationFrame,
   poslusalec passive. Brez filter: blur (iOS lekcija 29. 9.). */
/* Izrise ga App (main.js) ZUNAJ animiranega okvirja: vstopna animacija okvirja uporablja transform, zato bi bil
   position:fixed med animacijo vezan na okvir in bi ob koncu poskocil (premik postavitve, CLS 0,84 - faza 5). */
export function OzadjeHome() {
  const ref = useRef(null);
  useEffect(() => {
    let cakajoce = false;
    const posodobi = () => {
      cakajoce = false;
      const t = Math.min(Math.max(window.scrollY / 1400, 0), 1);
      if (ref.current) ref.current.style.setProperty("--t", t.toFixed(3));
    };
    const obDrsenju = () => { if (!cakajoce) { cakajoce = true; requestAnimationFrame(posodobi); } };
    window.addEventListener("scroll", obDrsenju, { passive: true });
    posodobi();
    return () => window.removeEventListener("scroll", obDrsenju);
  }, []);
  return html`<div class="ozadje-home" ref=${ref} aria-hidden="true"><span class="sij sij-a"></span><span class="sij sij-b"></span></div>`;
}
