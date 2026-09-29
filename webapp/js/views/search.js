/* Iskanje (SearchView.swift): GET /search?q= od 2 znakov, 350 ms zamika; prazno stanje = zanri + klubi. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { usePot, navigiraj } from "../usmerjanje.js";
import * as P from "../podatki.js";
import { zanrIme, danInUra } from "../oblika.js";
import { Ikona, Vrstica, NaslovSekcije, Nalaganje, Napaka } from "../ui.js";

export function Iskanje() {
  const pot = usePot();
  const [q, setQ] = useState(pot.iskanje.get("q") || "");
  const [rez, setRez] = useState(null);
  const [nalaga, setNalaga] = useState(false);
  const [napaka, setNapaka] = useState(null);
  const [brskanje, setBrskanje] = useState({ zanri: [], klubi: [], dogodki: [] });
  const vnos = useRef(null);
  const zadnja = useRef(0);

  useEffect(() => {
    Promise.all([P.zanri().catch(() => []), P.klubi().catch(() => []), P.dogodki({ upcoming: true }).catch(() => [])])
      .then(([zanri, klubi, dogodki]) => setBrskanje({ zanri, klubi, dogodki }));
    // Fokus v polje, kot na iOS (Where to? odpre iskanje s tipkovnico) - samo na napravah s kazalcem,
    // na telefonu bi tipkovnica sicer skocila cez polovico zaslona ob vsakem vstopu.
    if (window.matchMedia("(pointer: fine)").matches && vnos.current) vnos.current.focus();
  }, []);

  useEffect(() => {
    const iskano = q.trim();
    // Iskanje ostane v URL-ju (?q=), da gumb Nazaj z dogodka vrne isti rezultat.
    const url = iskano ? `/app/search?q=${encodeURIComponent(iskano)}` : "/app/search";
    if (location.pathname + location.search !== url) history.replaceState(history.state, "", url);
    if (iskano.length < 2) { setRez(null); setNalaga(false); setNapaka(null); return; }
    const st = ++zadnja.current;
    const cas = setTimeout(async () => {
      setNalaga(true); setNapaka(null);
      try {
        const r = await send("/search?q=" + encodeURIComponent(iskano));
        if (st === zadnja.current) setRez(r);
      } catch (e) { if (st === zadnja.current) setNapaka(sporocilo(e)); }
      if (st === zadnja.current) setNalaga(false);
    }, 350);
    return () => clearTimeout(cas);
  }, [q]);

  const iskano = q.trim();
  const steviloPoZanru = g => brskanje.dogodki.filter(e => e.genres.some(x => x.toLowerCase() === g.toLowerCase())).length;
  const podnaslovKluba = k => {
    const n = brskanje.dogodki.filter(e => e.club_id === k.id).length;
    return [k.city, n > 0 ? t("{n} upcoming events", { n }) : ""].filter(Boolean).join(" · ");
  };

  return html`<div class="zaslon iskanje">
    <h1 class="velik-naslov">${t("Search")}</h1>
    <div class="iskalno-polje">
      <${Ikona} ime="search" velikost=${18} razred="utisano" />
      <input ref=${vnos} type="search" value=${q} onInput=${e => setQ(e.target.value)}
        placeholder=${t("Search clubs or events")} aria-label=${t("Search clubs or events")}
        autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" />
      ${q ? html`<button type="button" class="pocisti" onClick=${() => { setQ(""); vnos.current && vnos.current.focus(); }} aria-label=${t("Clear")}><${Ikona} ime="x" velikost=${16} /></button>` : null}
    </div>
    ${nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${napaka} />

    ${rez ? html`
      ${!rez.clubs.length && !rez.events.length && !nalaga ? html`<p class="utisano">${t("No results for \"{q}\".", { q: iskano })}</p>` : null}
      ${rez.clubs.length ? html`<${NaslovSekcije} naslov=${t("Clubs")} />
        <div class="seznam">${rez.clubs.map(k => html`<${Vrstica} key=${"k" + k.id} href=${"/app/club/" + k.id} slikaUrl=${k.logo_url} ikona="building" naslov=${k.name} podnaslov=${k.city} />`)}</div>` : null}
      ${rez.events.length ? html`<${NaslovSekcije} naslov=${t("Events")} />
        <div class="seznam">${rez.events.map(e => html`<${Vrstica} key=${"e" + e.id} href=${"/app/event/" + e.id} slikaUrl=${e.poster_url} ikona="calendar"
          naslov=${e.title} podnaslov=${[e.club_name, danInUra(e.start_at ? new Date(e.start_at) : null)].filter(Boolean).join(" · ")} />`)}</div>` : null}
    ` : iskano.length === 1 ? html`<p class="utisano">${t("Type at least 2 characters.")}</p>` : html`
      ${brskanje.zanri.length ? html`<${NaslovSekcije} naslov=${t("Browse by genre")} />
        <div class="vrsta-drsna cipi">${brskanje.zanri.map(g => {
          const n = steviloPoZanru(g);
          return html`<a key=${g} class="cip-zanra" href=${"/app/genre/" + encodeURIComponent(g)}>${zanrIme(g)}${n ? html`<small>${n}</small>` : null}</a>`;
        })}</div>` : null}
      ${brskanje.klubi.length ? html`<${NaslovSekcije} naslov=${t("Clubs")} />
        <div class="seznam">${brskanje.klubi.map(k => html`<${Vrstica} key=${k.id} href=${"/app/club/" + k.id} slikaUrl=${k.logo_url} naslov=${k.name} podnaslov=${podnaslovKluba(k)} />`)}</div>` : null}
    `}
  </div>`;
}
