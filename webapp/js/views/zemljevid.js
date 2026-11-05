/* Zemljevid klubov (MapView.swift): klubi iz GET /clubs/map, dotik na klub pokaze kartico, "Open" odpre klub.
   Lokacija samo na gumb (se ne poslje na streznik). Ce zemljevida ni mogoce prikazati (brez WebGL, napaka),
   ostane seznam klubov po razdalji. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import { razdaljaKm, napisRazdalje, zanrIme, slika } from "../oblika.js";
import { useLokacija, zahtevajLokacijo } from "../lokacija.js";
import { naloziKnjiznice, slog, povecavaZa, SLOVENIJA, LJUBLJANA } from "../karta.js";
import { Ikona, Vrstica, Nalaganje, Napaka, Slika } from "../ui.js";

export function Zemljevid() {
  const [klubi, setKlubi] = useState(null);
  const [napaka, setNapaka] = useState(null);
  const [napakaKarte, setNapakaKarte] = useState(false);
  const [izbran, setIzbran] = useState(null);
  const lok = useLokacija();
  const posoda = useRef(null);
  const karta = useRef(null);
  const oznakaJaz = useRef(null);
  // Na mojo lokacijo se zemljevid premakne sam le, ce ni odprt na dolocenem mestu (?lat= z mini zemljevida);
  // sicer samo na gumb.
  const premakni = useRef(!ciljIzNaslova());
  const naMojoLokacijo = () => { premakni.current = true; zahtevajLokacijo(); };
  const [pripravljena, setPripravljena] = useState(false);   // zemljevid ustvarjen (ref sam ne sprozi izrisa)

  const nalozi = () => send("/clubs/map").then(r => { setKlubi(Array.isArray(r) ? r : []); setNapaka(null); })
    .catch(e => { setKlubi([]); setNapaka(sporocilo(e)); });
  useEffect(() => { nalozi(); }, []);

  // Zemljevid ustvarimo enkrat; ob odhodu z zaslona ga pobrisemo (sprosti WebGL).
  useEffect(() => {
    let unicen = false;
    naloziKnjiznice().then(K => {
      if (unicen || !posoda.current) return;
      // MapLibre 5 nima vec supported(): WebGL preverimo sami (brez njega Map vrze napako -> seznam).
      const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
      if (!gl) { setNapakaKarte(true); return; }
      const sprosti = gl.getExtension("WEBGL_lose_context"); if (sprosti) sprosti.loseContext();
      // /app/map?lat=..&lng=.. (z mini zemljevida na strani kluba ali dogodka) odpre zemljevid na tem mestu.
      const cilj = ciljIzNaslova();
      let m;
      try { m = new K.maplibregl.Map({
        container: posoda.current, style: slog(K), center: cilj || LJUBLJANA, zoom: cilj ? povecavaZa(cilj[0], cilj[1]) : 12.5,
        maxBounds: [[SLOVENIJA[0][0] - 1, SLOVENIJA[0][1] - 0.6], [SLOVENIJA[1][0] + 1, SLOVENIJA[1][1] + 0.6]],
        minZoom: 6.5, maxZoom: 17, attributionControl: false, dragRotate: false, pitchWithRotate: false
      }); } catch { setNapakaKarte(true); return; }
      m.touchZoomRotate.disableRotation();
      // Pripis OSM levo spodaj nad vrstico zavihkov (desno je gumb lokacije); licenca ODbL ga zahteva.
      m.addControl(new K.maplibregl.AttributionControl({ compact: true }), "bottom-left");
      m.on("error", e => { if (e && e.error && /Failed to fetch|NetworkError/.test(String(e.error.message))) console.warn(e.error.message); });
      m.on("click", () => setIzbran(null));
      karta.current = { m, K, oznake: [] };
      setPripravljena(true);
    }).catch(() => setNapakaKarte(true));
    return () => { unicen = true; if (karta.current) { karta.current.m.remove(); karta.current = null; } };
  }, []);

  // Oznake klubov (HTML: logo v krogu - ne rabijo sprite datotek).
  useEffect(() => {
    const k = karta.current;
    if (!k || !klubi) return;
    k.oznake.forEach(o => o.remove());
    k.oznake = klubi.filter(c => c.lat != null && c.lng != null && c.is_organizer !== true).map(c => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "oznaka-kluba";
      el.setAttribute("aria-label", c.name);
      // MapLibre postavi oznako s transform na elementu - oblika kaplje je zato na notranjem elementu.
      const igla = document.createElement("span");
      igla.className = "igla";
      if (c.logo_url) {
        const img = document.createElement("img");
        img.src = slika(c.logo_url, 96); img.alt = ""; img.loading = "lazy"; img.decoding = "async";
        igla.appendChild(img);
      } else {
        const crka = document.createElement("span");
        crka.textContent = (c.name || "?").charAt(0).toUpperCase();
        igla.appendChild(crka);
      }
      el.appendChild(igla);
      el.addEventListener("click", ev => { ev.stopPropagation(); setIzbran(c); });
      return new k.K.maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([c.lng, c.lat]).addTo(k.m);
    });
  }, [klubi, pripravljena]);

  // Moja lokacija: modra pika + premik zemljevida (samo, ce je uporabnik lokacijo dovolil).
  useEffect(() => {
    const k = karta.current;
    if (!k || !lok.polozaj) return;
    const tocka = [lok.polozaj.lng, lok.polozaj.lat];
    if (!oznakaJaz.current) {
      const el = document.createElement("span");
      el.className = "oznaka-jaz"; el.setAttribute("aria-label", t("You are here"));
      oznakaJaz.current = new k.K.maplibregl.Marker({ element: el }).setLngLat(tocka).addTo(k.m);
    } else oznakaJaz.current.setLngLat(tocka);
    if (premakni.current) k.m.easeTo({ center: tocka, zoom: Math.max(k.m.getZoom(), 13), duration: 600 });
  }, [lok.polozaj, pripravljena]);

  // Escape zapre kartico kluba.
  useEffect(() => {
    if (!izbran) return;
    const tipka = e => { if (e.key === "Escape") setIzbran(null); };
    document.addEventListener("keydown", tipka);
    return () => document.removeEventListener("keydown", tipka);
  }, [izbran]);

  if (napakaKarte) return html`<${SeznamKlubov} klubi=${klubi} lok=${lok} napaka=${napaka} />`;

  const razdalja = izbran && lok.polozaj ? napisRazdalje(razdaljaKm(lok.polozaj, izbran)) : "";
  return html`<div class="zaslon zemljevid-zaslon">
    <div class="karta" ref=${posoda} role="region" aria-label=${t("Map of clubs")}></div>
    ${klubi === null ? html`<div class="karta-obvestilo"><span class="vrtavka"></span></div>` : null}
    ${napaka ? html`<div class="karta-obvestilo"><${Napaka} besedilo=${napaka} znova=${nalozi} /></div>` : null}
    ${klubi && !klubi.length && !napaka ? html`<div class="karta-obvestilo">${t("No clubs on the map yet.")}</div>` : null}
    <button type="button" class="krog-gumb karta-lokacija" onClick=${naMojoLokacijo} disabled=${lok.isce} aria-label=${t("Use my location")}>
      <${Ikona} ime="locate-fixed" velikost=${20} /></button>
    ${lok.napaka ? html`<div class="karta-obvestilo spodaj">${lok.napaka}</div>` : null}
    ${izbran ? html`<div class="karta-kartica" role="region" aria-live="polite" aria-label=${izbran.name}>
      <span class="okrogla-slika">${izbran.logo_url ? html`<${Slika} src=${izbran.logo_url} sirina=${130} alt="" />` : html`<${Ikona} ime="building" velikost=${20} />`}</span>
      <span class="kv-besedilo"><strong>${izbran.name}</strong>
        <span>${[izbran.city, razdalja, (izbran.genres || []).slice(0, 2).map(zanrIme).join(" • ")].filter(Boolean).join(" · ")}</span></span>
      <button type="button" class="gumb-glavni majhen" onClick=${() => navigiraj("/app/club/" + izbran.id)}>${t("Open")}</button>
    </div>` : null}
  </div>`;
}

/** /app/map?lat=..&lng=.. -> [lng, lat] ali null (oba morata biti veljavni stevili). */
function ciljIzNaslova() {
  const q = new URLSearchParams(location.search);
  if (q.get("lat") === null || q.get("lng") === null) return null;
  const c = [Number(q.get("lng")), Number(q.get("lat"))];
  return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
}

/* Nadomestek brez WebGL: klubi po razdalji (prejsnji zaslon faze 1). */
function SeznamKlubov({ klubi, lok, napaka }) {
  // Organizator nima naslova ne pina: v nadomestnem seznamu ga ni (stran ima na /app/club/:id).
  const seznam = (klubi || []).filter(k => k.is_organizer !== true).map(k => ({ k, d: razdaljaKm(lok.polozaj, k) }))
    .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || a.k.name.localeCompare(b.k.name));
  return html`<div class="zaslon">
    <h1 class="velik-naslov">${t("Map")}</h1>
    <p class="opomba">${t("The map can't be shown in this browser. Here are the clubs on Outly, closest first.")}</p>
    ${lok.polozaj ? null : html`<button type="button" class="gumb-siv" onClick=${zahtevajLokacijo} disabled=${lok.isce}>
      <${Ikona} ime="locate-fixed" velikost=${16} /> ${lok.isce ? t("Locating...") : t("Use my location")}</button>`}
    <${Napaka} besedilo=${napaka} />
    ${!klubi ? html`<${Nalaganje} />` : html`<div class="seznam">
      ${seznam.map(({ k, d }) => html`<${Vrstica} key=${k.id} href=${"/app/club/" + k.id} slikaUrl=${k.logo_url}
        naslov=${k.name} podnaslov=${[k.city, d != null ? napisRazdalje(d) : ""].filter(Boolean).join(" · ")} />`)}
    </div>`}
  </div>`;
}

/** Majhen zemljevid z oznako (zaslon dogodka in kluba, kot iOS). Nalozi se sele, ko pride v vidno polje;
    ni interaktiven - dotik odpre polni zemljevid na tem mestu. */
export function MiniKarta({ lat, lng, ime }) {
  const posoda = useRef(null);
  const [napaka, setNapaka] = useState(false);
  useEffect(() => {
    if (lat == null || lng == null || !posoda.current) return;
    setNapaka(false);
    let m = null, unicen = false;
    const ustvari = () => naloziKnjiznice().then(K => {
      if (unicen || !posoda.current) return;
      // Pripis je stalen napis spodaj (kontrola MapLibre bi bila v povezavi neveljaven HTML in skrita).
      m = new K.maplibregl.Map({ container: posoda.current, style: slog(K), center: [lng, lat], zoom: Math.min(15, povecavaZa(lng, lat)),
        interactive: false, attributionControl: false });
      const el = document.createElement("span"); el.className = "oznaka-kluba mala";
      el.appendChild(Object.assign(document.createElement("span"), { className: "igla" }));
      new K.maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(m);
    }).catch(() => { if (!unicen) setNapaka(true); });
    const opazovalec = new IntersectionObserver(v => { if (v.some(x => x.isIntersecting)) { opazovalec.disconnect(); ustvari(); } }, { rootMargin: "200px" });
    opazovalec.observe(posoda.current);
    return () => { unicen = true; opazovalec.disconnect(); if (m) m.remove(); };
  }, [lat, lng]);
  if (lat == null || lng == null || napaka) return null;
  return html`<div class="mini-karta">
    <div class="mini-karta-platno" ref=${posoda} aria-hidden="true"></div>
    <a class="mini-karta-povezava" href=${`/app/map?lat=${lat}&lng=${lng}`} aria-label=${t("Show {name} on the map", { name: ime || "" })}></a>
    <span class="mini-karta-pripis">© OpenStreetMap</span>
  </div>`;
}
