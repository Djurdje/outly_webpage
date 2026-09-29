/* Seznami dogodkov: vsi dogodki (EventView), zanr (GenreEventsView), "Interested events" (SavedView). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import * as P from "../podatki.js";
import { zanrIme, normalizirajDogodek } from "../oblika.js";
import { GlavaNazaj, Nalaganje, Napaka, KarticaDogodka, VrsticaDogodka, Ikona } from "../ui.js";

function useJavni() {
  const [s, setS] = useState({ nalaga: true, napaka: null, klubi: new Map(), prihajajoci: [], pretekli: [] });
  const nalozi = async () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    try {
      const [k, up, pop] = await Promise.all([P.klubi(), P.dogodki({ upcoming: true }), P.dogodki({ upcoming: false })]);
      setS({ nalaga: false, napaka: null, klubi: P.poId(k), prihajajoci: up, pretekli: pop });
    } catch (e) { setS(x => ({ ...x, nalaga: false, napaka: sporocilo(e) })); }
  };
  useEffect(() => { nalozi(); }, []);
  return [s, nalozi];
}

const poCasu = (a, b) => (a._zacetek ? a._zacetek.getTime() : Infinity) - (b._zacetek ? b._zacetek.getTime() : Infinity);

export function VsiDogodki() {
  const [s, nalozi] = useJavni();
  const sekcija = (naslov, seznam) => html`<section class="blok-besedila">
    <h2 class="podnaslov">${naslov}</h2>
    ${!seznam.length && !s.nalaga && !s.napaka ? html`<p class="utisano">${t("No events.")}</p>` : null}
    ${seznam.map(e => html`<${VrsticaDogodka} key=${e.id} dogodek=${e} klub=${s.klubi.get(e.club_id)?.name} />`)}
  </section>`;
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Events")} />
    ${s.nalaga && !s.prihajajoci.length ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${sekcija(t("Popular"), s.pretekli)}
    ${sekcija(t("Coming Soon"), [...s.prihajajoci].sort(poCasu))}
  </div>`;
}

export function Zanr({ genre }) {
  const [s, nalozi] = useJavni();
  const g = genre.toLowerCase();
  const seznam = s.prihajajoci.filter(e => e.genres.some(x => x.toLowerCase() === g)).sort(poCasu);
  return html`<div class="zaslon">
    <${GlavaNazaj} />
    <h1 class="velik-naslov">${zanrIme(genre)}</h1>
    ${s.nalaga && !s.prihajajoci.length ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !seznam.length && !s.napaka ? html`<div class="prazno">
      <${Ikona} ime="music" velikost=${34} razred="modra" />
      <strong>${t("No {genre} events yet", { genre: zanrIme(genre).toLowerCase() })}</strong><span>${t("Check back soon.")}</span>
    </div>` : null}
    <div class="mreza-dogodkov">${seznam.map(e => html`<${KarticaDogodka} key=${e.id} dogodek=${e} klub=${s.klubi.get(e.club_id)?.name} sirina=${165} />`)}</div>
  </div>`;
}

export function Zanimivi() {
  const [s, setS] = useState({ nalaga: true, napaka: null, dogodki: [] });
  const nalozi = async () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    try {
      const r = await send("/me/plans", { auth: true });
      setS({ nalaga: false, napaka: null, dogodki: ((r && r.events) || []).map(normalizirajDogodek).filter(e => e.my_plan === "interested") });
    } catch (e) { setS(x => ({ ...x, nalaga: false, napaka: sporocilo(e) })); }
  };
  useEffect(() => { nalozi(); }, []);
  const zdaj = Date.now() - 6 * 3600e3;
  const prihajajoci = s.dogodki.filter(e => e._zacetek && e._zacetek.getTime() >= zdaj).sort(poCasu);
  const mimo = s.dogodki.filter(e => !(e._zacetek && e._zacetek.getTime() >= zdaj)).sort((a, b) => poCasu(b, a));
  const znacka = html`<span class="cip-plan">${t("Interested")}</span>`;
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Interested events")} />
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !s.napaka && !s.dogodki.length ? html`<div class="prazno">
      <${Ikona} ime="thumbs-up" velikost=${34} razred="modra" />
      <strong>${t("No interested events yet")}</strong>
      <span>${t("Tap \"I'm in\" on any event and it will show up here and on your home screen — on every device you log in to.")}</span>
    </div>` : null}
    ${prihajajoci.length ? html`<section class="blok-besedila"><h2 class="podnaslov">${t("Coming up")}</h2>
      ${prihajajoci.map(e => html`<${VrsticaDogodka} key=${e.id} dogodek=${e} klub=${e.club_name} desno=${znacka} />`)}</section>` : null}
    ${mimo.length ? html`<section class="blok-besedila"><h2 class="podnaslov">${t("Already happened")}</h2>
      ${mimo.map(e => html`<${VrsticaDogodka} key=${e.id} dogodek=${e} klub=${e.club_name} desno=${znacka} />`)}</section>` : null}
  </div>`;
}
