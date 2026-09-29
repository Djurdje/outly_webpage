/* Filtri domacega zaslona (FiltersView.swift): mesto, zanri, razdalja, starost, cena.
   Samo lokalno stanje (kot iOS); "Use my preferences" pride s profilom (faza 2). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { ustvariTrgovino, useStore } from "../store.js";
import * as P from "../podatki.js";
import { zanrIme, denar } from "../oblika.js";
import { List, Ikona } from "../ui.js";
import { nastavitve } from "../nastavitve.js";
import { seja } from "../seja.js";

export const PRIVZETI = Object.freeze({
  city: "", genres: [], minKm: 0, maxKm: 100, ageMin: 16, ageMax: 60, priceMin: 0, priceMax: 10000, izNastavitev: false
});
export const filtri = ustvariTrgovino({ ...PRIVZETI });
export const useFiltri = () => useStore(filtri);

export const filtriAktivni = f => Object.keys(PRIVZETI).filter(k => k !== "izNastavitev").some(k =>
  k === "genres" ? f.genres.length > 0 : f[k] !== PRIVZETI[k]);

export function ustrezaDogodek(f, e) {
  if (f.genres.length) {
    const g = new Set(e.genres.map(x => x.toLowerCase()));
    if (!f.genres.some(x => g.has(x.toLowerCase()))) return false;
  }
  if (e.min_age > f.ageMax) return false;
  const c = e.ticket_price_cents;
  if (c != null && (c < f.priceMin || c > f.priceMax)) return false;
  return true;
}

export function ustrezaKlub(f, k, km) {
  if (f.city && k.city.toLowerCase() !== f.city.toLowerCase()) return false;
  if (f.genres.length && k.genres.length) {
    const g = new Set(k.genres.map(x => x.toLowerCase()));
    if (!f.genres.some(x => g.has(x.toLowerCase()))) return false;
  }
  if (km != null && (km < f.minKm || km > f.maxKm)) return false;
  return true;
}

export function FiltriList({ odprt, zapri, mesta, imaLokacijo }) {
  const trenutni = useFiltri();
  const [o, setO] = useState(trenutni);          // osnutek - velja sele z "Apply filters"
  const [vsiZanri, setVsiZanri] = useState([]);
  useEffect(() => { if (odprt) { setO(filtri.get()); P.zanri().then(setVsiZanri).catch(() => setVsiZanri([])); } }, [odprt]);
  const spremeni = delni => setO(s => ({ ...s, ...delni }));
  const preklopiZanr = g => spremeni({ genres: o.genres.includes(g) ? o.genres.filter(x => x !== g) : [...o.genres, g] });
  // "Use my preferences" (kot iOS): vklop naloži zanre, razdaljo, starost in ceno iz My preferences
  // (zanri: lokalni, sicer iz profila); izklop jih vrne na privzeto, mesto ostane.
  function mojeNastavitve(vklop) {
    if (!vklop) { spremeni({ genres: [], minKm: 0, maxKm: PRIVZETI.maxKm, ageMin: PRIVZETI.ageMin, ageMax: PRIVZETI.ageMax, priceMin: PRIVZETI.priceMin, priceMax: PRIVZETI.priceMax, izNastavitev: false }); return; }
    const n = nastavitve.get(), me = seja.get().me;
    spremeni({ genres: n.genres.length ? n.genres : ((me && me.genres) || []), minKm: 0, maxKm: n.maxKm, ageMin: n.ageMin, ageMax: n.ageMax, priceMin: n.priceMin, priceMax: n.priceMax, izNastavitev: true });
  }

  return html`<${List} odprt=${odprt} zapri=${zapri} naslov=${t("Filters")}>
    <div class="nastavitev">
      <label class="nastavitev-naslov" for="f-mesto">${t("City")}</label>
      <div class="izbira"><${Ikona} ime="map-pin" velikost=${18} />
        <select id="f-mesto" value=${o.city} onChange=${e => spremeni({ city: e.target.value })}>
          <option value="">${t("All cities")}</option>
          ${mesta.map(m => html`<option value=${m}>${m}</option>`)}
        </select>
        <${Ikona} ime="chevron-down" velikost=${16} razred="utisano" />
      </div>
    </div>

    <label class="stikalo-vrstica">
      <span class="kv-besedilo"><strong>${t("Use my preferences")}</strong><span>${t("Apply preferences from your profile")}</span></span>
      <input type="checkbox" role="switch" class="stikalo" checked=${o.izNastavitev} onChange=${e => mojeNastavitve(e.target.checked)} />
    </label>

    <div class="nastavitev">
      <span class="nastavitev-naslov">${t("Music genres")}</span>
      <div class="mreza-cipov">
        ${vsiZanri.map(g => html`<button type="button" class=${"cip" + (o.genres.includes(g) ? " izbran" : "")}
          aria-pressed=${o.genres.includes(g)} onClick=${() => preklopiZanr(g)}>${zanrIme(g)}</button>`)}
      </div>
    </div>

    <div class="nastavitev">
      <span class="nastavitev-naslov">${t("Distance")}</span>
      <${Razpon} od=${0} do=${100} korak=${1} spodaj=${o.minKm} zgoraj=${o.maxKm}
        napis=${v => `${v} km`} ob=${(a, b) => spremeni({ minKm: a, maxKm: b })} ime=${t("Distance")} />
      ${imaLokacijo ? null : html`<p class="opomba">${t("Distance applies once you share your location on Home.")}</p>`}
    </div>

    <div class="nastavitev">
      <span class="nastavitev-naslov">${t("Age range")}</span>
      <${Razpon} od=${16} do=${60} korak=${1} spodaj=${o.ageMin} zgoraj=${o.ageMax}
        napis=${v => `${v}`} ob=${(a, b) => spremeni({ ageMin: a, ageMax: b })} ime=${t("Age range")} />
    </div>

    <div class="nastavitev">
      <span class="nastavitev-naslov">${t("Entry price")}</span>
      <${Razpon} od=${0} do=${100} korak=${1} spodaj=${o.priceMin / 100} zgoraj=${o.priceMax / 100}
        napis=${v => denar(v * 100)} ob=${(a, b) => spremeni({ priceMin: a * 100, priceMax: b * 100 })} ime=${t("Entry price")} />
    </div>

    <div class="gumba-dno">
      <button type="button" class="gumb-obrobljen" onClick=${() => setO({ ...PRIVZETI })}>${t("Reset")}</button>
      <button type="button" class="gumb-glavni" onClick=${() => { filtri.set({ ...o }); zapri(); }}>${t("Apply filters")}</button>
    </div>
  <//>`;
}

/* Drsnik od-do: dva input[type=range] na istem tiru (tipkovnica in bralniki zaslona delajo). */
export function Razpon({ od, do: dO, korak, spodaj, zgoraj, napis, ob, ime, samoZgoraj = false }) {
  const odstotek = v => ((v - od) / (dO - od)) * 100;
  return html`<div class="razpon">
    <div class="razpon-napisa"><span>${napis(spodaj)}</span><span>${napis(zgoraj)}${zgoraj >= dO ? "+" : ""}</span></div>
    <div class="razpon-tir" style=${{ "--od": odstotek(spodaj) + "%", "--do": odstotek(zgoraj) + "%" }}>
      ${samoZgoraj ? null : html`<input type="range" min=${od} max=${dO} step=${korak} value=${spodaj} aria-label=${ime + " – min"}
        onInput=${e => ob(Math.min(Number(e.target.value), zgoraj), zgoraj)} />`}
      <input type="range" min=${od} max=${dO} step=${korak} value=${zgoraj} aria-label=${ime + " – max"}
        onInput=${e => ob(spodaj, Math.max(Number(e.target.value), spodaj))} />
    </div>
  </div>`;
}
