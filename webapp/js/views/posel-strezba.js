/* Table service (strezba VIP miz; issue Djurdje/outly-backend#176, 9. 10. 2026). Vratar skenira VIP QR, strezba nastane ob
   prvem skenu; natakar (bartender), manager in lastnik vidijo seznam in oznacijo "Delivered" (z Undo).
   Natakar vidi SAMO oznako mize, stevilo sedezev, paket, opis paketa in cas skena - nikoli podatkov kupca (I11/I13);
   streznik teh polj sploh ne poslje, tu jih ne prikazujemo.
   Poti: GET /business/events/:id/table-service -> { items: [...] }, PUT /business/table-service/:id { delivered }.
   Vloge uveljavlja streznik (vratar 403); vratarju pogled klicev sploh ne poslje. Osvezitev vsakih 30 s, ko je zavihek viden. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { sporocilo } from "../napake.js";
import { useSeja } from "../seja.js";
import { usePot } from "../usmerjanje.js";
import { GlavaNazaj, Ikona, Nalaganje, Napaka } from "../ui.js";
import { idKluba, poslovno, normalizirajDogodke } from "../posel.js";
import { ura, danInUra } from "../oblika.js";
import { PoslovnaNapaka } from "./posel.js";

const URA = 3600 * 1000;
const OSVEZITEV_MS = 30000;

/* Dogodek "tece" (kot zvonec na backendu): od 2 h pred zacetkom do konca; brez konca zacetek + 8 h. */
const konecMs = e => {
  const z = e._zacetek.getTime();
  const k = e._konec ? e._konec.getTime() : 0;
  return k > z ? k : z + 8 * URA;
};
const tece = (e, zdaj) => zdaj >= e._zacetek.getTime() - 2 * URA && zdaj <= konecMs(e);
const objavljen = e => typeof e.status !== "string" || e.status === "published";

/** Dogodki za izbiro: objavljeni, od 3 dni nazaj do 30 dni naprej, po zacetku. */
export function dogodkiZaIzbiro(vsi, zdaj = Date.now()) {
  return vsi.filter(e => e._zacetek && objavljen(e) && e._zacetek.getTime() >= zdaj - 72 * URA && e._zacetek.getTime() <= zdaj + 30 * 24 * URA)
    .sort((a, b) => a._zacetek - b._zacetek || a.id - b.id);
}
/** Privzeti dogodek: tisti, ki tece (najprej zacet); sicer najblizji po zacetku. */
export function privzetiDogodek(seznam, zdaj = Date.now()) {
  const tekoci = seznam.filter(e => tece(e, zdaj));
  if (tekoci.length) return tekoci[0];
  let naj = null;
  for (const e of seznam) if (!naj || Math.abs(e._zacetek - zdaj) < Math.abs(naj._zacetek - zdaj)) naj = e;
  return naj;
}

const cas = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? ura(d) : "";
};
const zaporedje = (a, b) => (Date.parse(a.scanned_at) || 0) - (Date.parse(b.scanned_at) || 0) || a.id - b.id;

function Kartica({ x, zaseden, ob }) {
  const dostavljeno = !!x.delivered_at;
  const sedezi = Number(x.table_seats) > 0 ? tn("1 seat", "{n} seats", Number(x.table_seats)) : "";
  return html`<div class=${"strezba-kartica" + (dostavljeno ? " dostavljeno" : "")}>
    <div class="strezba-miza" aria-label=${t("Table {label}", { label: x.table_label })}>
      <strong>${x.table_label}</strong>${sedezi ? html`<span>${sedezi}</span>` : null}
    </div>
    <div class="strezba-besedilo">
      <strong>${x.package_name || t("No package")}</strong>
      ${x.package_description ? html`<span class="strezba-opis">${x.package_description}</span>` : null}
      <span class="strezba-cas"><${Ikona} ime="clock" velikost=${13} />
        ${dostavljeno
          ? [t("Delivered {cas}", { cas: cas(x.delivered_at) }), x.delivered_by_username ? t("by {name}", { name: x.delivered_by_username }) : ""].filter(Boolean).join(" · ")
          : t("Scanned {cas}", { cas: cas(x.scanned_at) })}</span>
    </div>
    ${dostavljeno
      ? html`<button type="button" class="gumb-siv majhen strezba-gumb" disabled=${zaseden} onClick=${() => ob(x, false)}>${zaseden ? html`<span class="vrtavka majhna"></span>` : t("Undo")}</button>`
      : html`<button type="button" class="gumb-glavni majhen strezba-gumb" disabled=${zaseden} onClick=${() => ob(x, true)}>${zaseden ? html`<span class="vrtavka majhna"></span>` : html`<${Ikona} ime="check" velikost=${16} /> ${t("Delivered")}`}</button>`}
  </div>`;
}

export function Strezba({ klub }) {
  const id = idKluba(klub);
  const me = useSeja(s => s.me);
  const pot = usePot();
  const zahtevan = /^\d{1,9}$/.test(pot.iskanje.get("dogodek") || "") ? Number(pot.iskanje.get("dogodek")) : null;
  const clanstvo = me && Array.isArray(me.clubs) ? me.clubs.find(c => Number(c.club_id) === id) : null;
  const vratar = !!clanstvo && clanstvo.role === "doorman";   // vratar seznama ne vidi (brez klicev); sicer odloci streznik

  const [dogodki, setDogodki] = useState({ nalaga: true, napaka: null, seznam: [] });
  const [izbran, setIzbran] = useState(zahtevan);
  const [s, setS] = useState({ nalaga: false, napaka: null, items: [] });
  const [zaseden, setZaseden] = useState(null);
  const [napakaAkcije, setNapakaAkcije] = useState("");
  const zasedenRef = useRef(false);   // PUT tece: tihe osvezitve ne smejo teci (pozen GET bi povozil Delivered)
  const vsiDogodki = useRef([]);
  const stevec = useRef(0);   // zadnji klic zmaga: pozni odgovor osvezitve ne povozi oznacitve Delivered

  const rezerva = `/app/business/${id}`;

  const naloziDogodke = () => {
    setDogodki(x => ({ ...x, nalaga: true, napaka: null }));
    poslovno(id, "/business/events")
      .then(r => {
        const vsi = normalizirajDogodke(r);
        vsiDogodki.current = vsi;
        const seznam = dogodkiZaIzbiro(vsi);
        // Dogodek iz zvonca (?dogodek=ID) ostane izbran, tudi ce ni med predlogi.
        if (zahtevan && !seznam.some(e => e.id === zahtevan)) { const e = vsi.find(v => v.id === zahtevan); if (e) seznam.push(e); }
        setDogodki({ nalaga: false, napaka: null, seznam });
        setIzbran(prej => prej || (privzetiDogodek(seznam) || {}).id || null);
      })
      .catch(e => {
        setDogodki({ nalaga: false, napaka: zahtevan ? null : e, seznam: [] });
        if (!zahtevan) setIzbran(null);
      });
  };
  useEffect(() => { if (id && !vratar) naloziDogodke(); }, [id, vratar]);

  const nalozi = tiho => {
    if (!id || !izbran) return;
    if (tiho && zasedenRef.current) return;
    const zeton = ++stevec.current;
    if (!tiho) setS(x => ({ ...x, nalaga: true, napaka: null }));
    poslovno(id, `/business/events/${izbran}/table-service`)
      .then(r => { if (zeton === stevec.current) setS({ nalaga: false, napaka: null, items: Array.isArray(r && r.items) ? r.items : [] }); })
      .catch(e => {
        if (zeton !== stevec.current) return;
        // Tiha osvezitev ob izpadu povezave pusti seznam, kakrsen je; 403/404 ga zamenjata s sporocilom.
        if (tiho && e.status !== 403 && e.status !== 404) return;
        setS(x => ({ nalaga: false, napaka: e, items: tiho && e.status !== 403 && e.status !== 404 ? x.items : [] }));
      });
  };
  useEffect(() => {
    if (!id || !izbran || vratar) return undefined;
    setNapakaAkcije("");
    setS({ nalaga: true, napaka: null, items: [] });   // seznam starega dogodka se ne sme kazati
    nalozi(false);
    const vidno = () => document.visibilityState === "visible";
    const kolo = setInterval(() => { if (vidno()) nalozi(true); }, OSVEZITEV_MS);
    const ob = () => { if (vidno()) nalozi(true); };
    document.addEventListener("visibilitychange", ob);
    return () => { clearInterval(kolo); document.removeEventListener("visibilitychange", ob); stevec.current += 1; };
  }, [id, izbran, vratar]);

  /* ?dogodek se spremeni, ko komponenta ostane (npr. dotik v zvoncu na drug dogodek istega kluba). */
  useEffect(() => {
    if (!zahtevan) return;
    setDogodki(d => (d.seznam.some(e => e.id === zahtevan) ? d : (() => {
      const e = vsiDogodki.current.find(v => v.id === zahtevan);
      return e ? { ...d, seznam: [...d.seznam, e].sort((a, b) => a._zacetek - b._zacetek || a.id - b.id) } : d;
    })()));
    setIzbran(zahtevan);
  }, [zahtevan]);

  async function oznaci(x, dostavljeno) {
    zasedenRef.current = true;
    setZaseden(x.id); setNapakaAkcije("");
    stevec.current += 1;   // odgovor osvezitve, ki je ze na poti, zavrzemo
    try {
      const r = await poslovno(id, `/business/table-service/${x.id}`, { method: "PUT", body: { delivered: dostavljeno } });
      const novo = r && (r.item || r);
      setS(prej => ({ ...prej, napaka: null, items: prej.items.map(y => (y.id === x.id
        ? { ...y, ...(novo && novo.id === x.id ? novo : {}), delivered_at: novo && novo.id === x.id ? novo.delivered_at : (dostavljeno ? new Date().toISOString() : null) }
        : y)) }));
    } catch (e) { setNapakaAkcije(sporocilo(e)); }
    finally { zasedenRef.current = false; stevec.current += 1; }
    setZaseden(null);
  }

  if (!id) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/profile" /><${PoslovnaNapaka} napaka=${{ status: 404 }} /></div>`;
  if (vratar) return html`<div class="zaslon"><${GlavaNazaj} rezerva=${rezerva} /><${PoslovnaNapaka} napaka=${{ status: 403 }} rezerva=${rezerva} /></div>`;

  const odprti = s.items.filter(x => !x.delivered_at).sort(zaporedje);
  const koncani = s.items.filter(x => x.delivered_at).sort((a, b) => (Date.parse(b.delivered_at) || 0) - (Date.parse(a.delivered_at) || 0));
  const prepovedano = s.napaka && (s.napaka.status === 403 || s.napaka.status === 404);
  const vrstica = x => html`<${Kartica} key=${x.id} x=${x} zaseden=${zaseden === x.id} ob=${oznaci} />`;

  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${rezerva} />
    <h1 class="velik-naslov">${t("Table service")}</h1>
    ${dogodki.nalaga && !dogodki.seznam.length ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${dogodki.napaka} znova=${naloziDogodke} rezerva=${rezerva} />
    ${dogodki.seznam.length ? html`<label class="polje-oznaceno">${t("Event")}
      <select value=${izbran || ""} onChange=${ev => setIzbran(Number(ev.target.value))}>
        ${dogodki.seznam.map(e => html`<option key=${e.id} value=${e.id} selected=${e.id === izbran}>${e.title} · ${danInUra(e._zacetek)}</option>`)}
      </select></label>` : null}
    ${!dogodki.nalaga && !dogodki.napaka && !izbran ? html`<div class="prazno">
      <${Ikona} ime="wine" velikost=${34} razred="modra" />
      <strong>${t("No events to serve")}</strong><span>${t("VIP tables appear here once the door staff scans them.")}</span></div>` : null}

    ${izbran && s.nalaga && !s.items.length ? html`<${Nalaganje} />` : null}
    ${prepovedano ? html`<${PoslovnaNapaka} napaka=${s.napaka} rezerva=${rezerva} />`
      : s.napaka && !s.items.length ? html`<${Napaka} besedilo=${sporocilo(s.napaka)} znova=${() => nalozi(false)} />` : null}
    ${napakaAkcije ? html`<p class="napaka-besedilo" role="alert">${napakaAkcije}</p>` : null}

    ${izbran && !s.nalaga && !s.napaka && !s.items.length ? html`<div class="prazno">
      <${Ikona} ime="wine" velikost=${34} razred="modra" />
      <strong>${t("Nothing to serve yet")}</strong><span>${t("A table shows up here when the door staff scans its VIP ticket.")}</span></div>` : null}

    ${odprti.length ? html`<h2 class="podnaslov-sekcije">${t("To serve")} · ${odprti.length}</h2>
      <div class="strezba-seznam">${odprti.map(vrstica)}</div>` : null}
    ${koncani.length ? html`<h2 class="podnaslov-sekcije">${t("Delivered")} · ${koncani.length}</h2>
      <div class="strezba-seznam">${koncani.map(vrstica)}</div>` : null}
  </div>`;
}
