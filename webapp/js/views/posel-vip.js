/* Urejevalnik tlorisa za VIP mize (/app/business/:klub/vip, samo owner/manager - streznik vseeno uveljavi 403).
   Klub tloris narise ENKRAT (mreza width x height, elementi, mize s sedezi in privzeto ceno) in vpise bottle pakete;
   pri vsakem dogodku nato VIP mize vklopi (views/posel-vip-dogodek.js). Shrani -> PUT /business/vip (celoten nadomestek).
   Urejevalnik je samo na spletu (iOS ga nima). Vlecenje s pointer events (miska in dotik), velikost z rocajem ali +/-,
   tipkovnica: puscice premaknejo, Shift+puscice spremenijo velikost, Delete izbrise.
   Cena se vnese v evrih in poslje v CELIH CENTIH (nikoli plavajoca vejica).
   Isti urejevalnik ureja tudi LASTEN razpored dogodka organizatorja (/app/business/:klub/events/:dogodek/vip):
   GET|PUT /business/events/:id/vip-layout ({ source: "event", floor_plan, tables }); paketi steklenic so vedno
   klubovi/organizatorjevi (urejajo se v /vip), zato jih v tem nacinu ni. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { nastaviVarovalo } from "../usmerjanje.js";
import { GlavaNazaj, Ikona, Nalaganje } from "../ui.js";
import { idKluba, poslovno, centiIz, evriBesedilo } from "../posel.js";
import { PoslovnaNapaka } from "./posel.js";
import {
  C, TIPI, NAJVEC_ELEMENTOV, NAJVEC_MIZ, NAJVEC_PAKETOV, imeTipa, normalizirajTloris, normalizirajMize, normalizirajPakete,
  sporociloVip, useSirina, TlorisPlatno, ElementTlorisa, OblikaMize
} from "../vip.js";

const MIN_MREZA = 8, MAX_MREZA = 40;
/* Privzeta velikost ob dodajanju [w, h] v celicah. */
const PRIVZETO = { bar: [6, 2], stage: [8, 3], dj: [3, 2], dancefloor: [8, 6], entrance: [4, 1], wc: [3, 2], label: [6, 1], wall: [8, 1], table: [2, 2] };
const omeji = (v, od, do_) => Math.min(do_, Math.max(od, v));
const evri = c => evriBesedilo(c).replace(/\.00$/, "");

let stevec = 0;   // lokalni kljuc predmeta (id mize/paketa ima samo, kar je ze na streznik)
const kljuc = () => ++stevec;

/** Streznikov odgovor (GET/PUT /business/vip) -> stanje urejevalnika. Elementi in mize so en seznam "predmetov". */
function izStreznika(r, dogodek = false) {
  // Razpored dogodka: tloris je v floor_plan; ce dogodek se uporablja klubski tloris (source != "event"), je urejevalnik prazen.
  const jeDogodek = dogodek && r && r.source === "event";
  const plan = dogodek ? (jeDogodek ? normalizirajTloris(r.floor_plan) : null) : normalizirajTloris(r && r.plan);
  const predmeti = [];
  if (plan) plan.elements.forEach(e => predmeti.push({ k: kljuc(), tip: e.type, x: e.x, y: e.y, w: e.w, h: e.h, label: e.label }));
  normalizirajMize(dogodek && !jeDogodek ? [] : r && r.tables).filter(m => !(dogodek && m.archived === true)).forEach(m => predmeti.push({
    k: kljuc(), tip: "table", id: m.id, x: m.x, y: m.y, w: m.w, h: m.h, label: m.label, shape: m.shape,
    seats: String(m.seats), cena: evri(m.price_cents)
  }));
  const paketi = normalizirajPakete(dogodek ? [] : r && r.packages).map(p => ({ k: kljuc(), id: p.id, name: p.name, description: p.description }));
  return { sirina: plan ? plan.width : 24, visina: plan ? plan.height : 16, predmeti, paketi, imaTloris: !!plan };
}

/** Vsebina za primerjavo "neshranjeno": brez lokalnih kljucev. */
const vsebina = st => JSON.stringify({
  s: st.sirina, v: st.visina,
  p: st.predmeti.map(({ k, ...r }) => r), q: st.paketi.map(({ k, ...r }) => r)
});

const prekrivanje = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Prvo prosto mesto za nov predmet (sicer levi zgornji kot). */
function prostoMesto(predmeti, sirina, visina, w, h) {
  for (let y = 0; y + h <= visina; y++) for (let x = 0; x + w <= sirina; x++) {
    if (!predmeti.some(p => prekrivanje(p, { x, y, w, h }))) return { x, y };
  }
  return { x: 0, y: 0 };
}

/** Predmet ostane v mrezi: velikost 1..mreza, polozaj znotraj. */
function vMrezi(p, sirina, visina) {
  const w = omeji(p.w, 1, sirina), h = omeji(p.h, 1, visina);
  return { ...p, w, h, x: omeji(p.x, 0, sirina - w), y: omeji(p.y, 0, visina - h) };
}

export function UrejevalnikVip({ klub, dogodek = null }) {
  const id = idKluba(klub);
  const idDogodka = dogodek != null ? idKluba(dogodek) : null;
  const jeDogodek = dogodek != null;
  const pot = jeDogodek ? `/business/events/${idDogodka}/vip-layout` : "/business/vip";
  const [s, setS] = useState({ nalaga: true, napaka: null, st: null });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    poslovno(id, pot)
      .then(r => setS({ nalaga: false, napaka: null, st: izStreznika(r, jeDogodek) }))
      .catch(e => setS({ nalaga: false, napaka: e, st: null }));
  };
  useEffect(() => { if (id && (!jeDogodek || idDogodka)) nalozi(); }, [id, idDogodka]);
  const rezerva = jeDogodek ? `/app/business/${id}/events/${idDogodka}/edit` : `/app/business/${id}`;
  const glava = html`<${GlavaNazaj} naslov=${t("VIP tables")} rezerva=${rezerva} />`;
  if (!id || (jeDogodek && !idDogodka) || s.napaka) return html`<div class="zaslon">${glava}<${PoslovnaNapaka} napaka=${s.napaka || { status: 404 }} znova=${nalozi} rezerva=${rezerva} /></div>`;
  if (!s.st) return html`<div class="zaslon">${glava}<${Nalaganje} /></div>`;
  return html`<${Platno} klub=${id} dogodek=${idDogodka} zacetno=${s.st} glava=${glava} />`;
}

function Platno({ klub, dogodek, zacetno, glava }) {
  const jeDogodek = dogodek != null;
  const [st, setSt] = useState({ sirina: zacetno.sirina, visina: zacetno.visina, predmeti: zacetno.predmeti, paketi: zacetno.paketi });
  const [izbran, setIzbran] = useState(null);
  const [napaka, setNapaka] = useState("");
  const [shranjeno, setShranjeno] = useState(false);
  const [shranjujem, setShranjujem] = useState(false);
  const imaTloris = useRef(zacetno.imaTloris);
  const izhodisce = useRef(vsebina(zacetno));
  const svgRef = useRef(null);
  const povlek = useRef(null);
  const sirinaPx = useSirina(svgRef);
  const merilo = sirinaPx ? sirinaPx / (st.sirina * C) : 1;   // pikslov na enoto viewBox

  const neshranjeno = vsebina(st) !== izhodisce.current;
  const neshranjenoRef = useRef(false);
  neshranjenoRef.current = neshranjeno;

  // Opozorilo ob odhodu z neshranjenimi spremembami: zavihek/osvezitev (beforeunload) in navigacija v aplikaciji (varovalo).
  useEffect(() => {
    nastaviVarovalo(() => !neshranjenoRef.current || confirm(t("You have unsaved changes. Leave without saving?")));
    const pred = ev => { if (neshranjenoRef.current) { ev.preventDefault(); ev.returnValue = ""; } };
    window.addEventListener("beforeunload", pred);
    return () => { nastaviVarovalo(null); window.removeEventListener("beforeunload", pred); };
  }, []);

  const spremeni = () => { setShranjeno(false); setNapaka(""); };
  const posodobi = (k, delta) => {
    spremeni();
    setSt(x => ({ ...x, predmeti: x.predmeti.map(p => (p.k === k ? vMrezi({ ...p, ...delta }, x.sirina, x.visina) : p)) }));
  };
  const trenutni = st.predmeti.find(p => p.k === izbran) || null;

  /* ---- mreza ---- */
  const najmanjSirina = Math.max(MIN_MREZA, ...st.predmeti.map(p => p.x + p.w));
  const najmanjVisina = Math.max(MIN_MREZA, ...st.predmeti.map(p => p.y + p.h));
  const nastaviMrezo = (sirina, visina) => {
    spremeni();
    setSt(x => ({ ...x, sirina: omeji(sirina, najmanjSirina, MAX_MREZA), visina: omeji(visina, najmanjVisina, MAX_MREZA) }));
  };

  /* ---- dodajanje in brisanje ---- */
  function dodaj(tip) {
    spremeni();
    const [w0, h0] = PRIVZETO[tip];
    const w = Math.min(w0, st.sirina), h = Math.min(h0, st.visina);
    const { x, y } = prostoMesto(st.predmeti, st.sirina, st.visina, w, h);
    const p = { k: kljuc(), tip, x, y, w, h, label: "" };
    if (tip === "table") {
      const uporabljene = new Set(st.predmeti.filter(q => q.tip === "table").map(q => q.label.trim().toLowerCase()));
      let n = 1; while (uporabljene.has("t" + n)) n++;
      Object.assign(p, { label: "T" + n, shape: "round", seats: "6", cena: "300" });
    }
    setSt(x2 => ({ ...x2, predmeti: [...x2.predmeti, p] }));
    setIzbran(p.k);
  }
  function odstrani(k) {
    spremeni();
    setSt(x => ({ ...x, predmeti: x.predmeti.filter(p => p.k !== k) }));
    setIzbran(null);
  }

  /* ---- vlecenje (pointer events: miska in dotik) ---- */
  function zacniPovlek(ev, p, nacin) {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === "mouse") return;
    ev.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const celica = svg.getBoundingClientRect().width / st.sirina;
    try { svg.setPointerCapture(ev.pointerId); } catch { /* brez */ }
    povlek.current = { k: p.k, nacin, id: ev.pointerId, ex: ev.clientX, ey: ev.clientY, celica, x: p.x, y: p.y, w: p.w, h: p.h };
    setIzbran(p.k);
  }
  function gibanje(ev) {
    const d = povlek.current;
    if (!d || ev.pointerId !== d.id) return;
    const dx = Math.round((ev.clientX - d.ex) / d.celica), dy = Math.round((ev.clientY - d.ey) / d.celica);
    if (dx === 0 && dy === 0 && !d.premaknjeno) return;
    d.premaknjeno = true;
    posodobi(d.k, d.nacin === "premik" ? { x: d.x + dx, y: d.y + dy }
      : { w: omeji(d.w + dx, 1, st.sirina - d.x), h: omeji(d.h + dy, 1, st.visina - d.y) });   // velikost se ustavi ob robu mreze
  }
  function konecPovleka(ev) {
    const d = povlek.current;
    if (!d || ev.pointerId !== d.id) return;
    povlek.current = null;
    try { svgRef.current.releasePointerCapture(ev.pointerId); } catch { /* brez */ }
  }
  function tipka(ev, p) {
    const koraki = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (koraki[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = koraki[ev.key];
      posodobi(p.k, ev.shiftKey ? { w: omeji(p.w + dx, 1, st.sirina - p.x), h: omeji(p.h + dy, 1, st.visina - p.y) } : { x: p.x + dx, y: p.y + dy });
    } else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); odstrani(p.k); }
  }

  /* ---- paketi ---- */
  const posodobiPaket = (k, delta) => { spremeni(); setSt(x => ({ ...x, paketi: x.paketi.map(q => (q.k === k ? { ...q, ...delta } : q)) })); };

  /* ---- shranjevanje ---- */
  async function shrani() {
    setNapaka(""); setShranjeno(false);
    const mize = st.predmeti.filter(p => p.tip === "table");
    const oznake = new Set();
    for (const m of mize) {
      const oznaka = m.label.trim();
      if (!oznaka || [...oznaka].length > 20 || oznake.has(oznaka.toLowerCase())) { setIzbran(m.k); return setNapaka(t("Every table needs a unique label of up to 20 characters.")); }
      oznake.add(oznaka.toLowerCase());
      if (!/^\d{1,2}$/.test(String(m.seats).trim()) || Number(m.seats) < 1 || Number(m.seats) > 20) { setIzbran(m.k); return setNapaka(t("Seats must be a whole number from 1 to 20.")); }
      const c = centiIz(m.cena, 100000);
      if (c === undefined) { setIzbran(m.k); return setNapaka(t("Enter the price as a number, e.g. 12.50.")); }
      if (c === null) { setIzbran(m.k); return setNapaka(t("Enter a price for every table, e.g. 300.")); }
    }
    for (const p of st.paketi) {
      if (!p.name.trim() || [...p.name.trim()].length > 60) return setNapaka(t("Every bottle package needs a name of up to 60 characters."));
    }
    const elementi = st.predmeti.filter(p => p.tip !== "table")
      .map(p => ({ type: p.tip, x: p.x, y: p.y, w: p.w, h: p.h, label: p.tip === "wall" ? "" : [...p.label.trim()].slice(0, 30).join("") }));
    // plan: null je dovoljen samo brez miz; kdor tloris ze ima, ga ohrani (tudi prazen).
    const plan = elementi.length || mize.length || imaTloris.current ? { width: st.sirina, height: st.visina, elements: elementi } : null;
    const tables = mize.map(m => ({
      ...(m.id ? { id: m.id } : {}), label: m.label.trim(), x: m.x, y: m.y, w: m.w, h: m.h, shape: m.shape,
      seats: Number(m.seats), price_cents: centiIz(m.cena, 100000)
    }));
    const body = jeDogodek ? { source: "event", floor_plan: plan, tables }
      : { plan, tables, packages: st.paketi.map(p => ({ ...(p.id ? { id: p.id } : {}), name: p.name.trim(), description: p.description.trim() })) };
    setShranjujem(true);
    try {
      const r = izStreznika(await poslovno(klub, jeDogodek ? `/business/events/${dogodek}/vip-layout` : "/business/vip", { method: "PUT", body }), jeDogodek);
      imaTloris.current = r.imaTloris;
      izhodisce.current = vsebina(r);
      setSt({ sirina: r.sirina, visina: r.visina, predmeti: r.predmeti, paketi: r.paketi });
      setIzbran(null);
      setShranjeno(true);
    } catch (e) { setNapaka(sporociloVip(e)); }
    setShranjujem(false);
  }

  /* ---- izris ---- */
  const elementi = st.predmeti.filter(p => p.tip !== "table");
  const mize = st.predmeti.filter(p => p.tip === "table");
  const vrstniRed = [...elementi, ...mize];   // stalen vrstni red (mize nad elementi): premik v DOM-u bi izgubil fokus tipkovnice
  // Rocaj za velikost: vidna pika 6 px v spodnjem desnem kotu; zadetno obmocje je pri majhnem predmetu manjse,
  // da pika ne prekrije sredine (tam se predmet prime za premik).
  const rv = 6 / merilo;
  const rh = trenutni ? Math.max(8, Math.min(20, 0.45 * Math.min(trenutni.w, trenutni.h) * C * merilo)) / merilo : 0;
  const rx = trenutni ? (trenutni.x + trenutni.w) * C - 3 / merilo : 0, ry = trenutni ? (trenutni.y + trenutni.h) * C - 3 / merilo : 0;

  const opisPredmeta = p => (p.tip === "table"
    ? `${t("Table")} ${p.label}` : (p.label && p.label.trim()) || imeTipa(p.tip));
  const platno = html`<${TlorisPlatno} plan=${{ width: st.sirina, height: st.visina }} svgRef=${svgRef} oznaka=${t("Floor plan editor")}
    razred=${"urejevalnik" + (trenutni ? " izbrano" : "")}
    onPointerDown=${() => setIzbran(null)} onPointerMove=${gibanje} onPointerUp=${konecPovleka} onPointerCancel=${konecPovleka}>
    ${vrstniRed.map(p => html`<g key=${p.k} class=${"tl-predmet" + (p.k === izbran ? " izbran" : "")} role="button" tabindex="0"
      aria-label=${opisPredmeta(p)} aria-pressed=${p.k === izbran}
      onPointerDown=${ev => zacniPovlek(ev, p, "premik")} onFocus=${() => setIzbran(p.k)} onKeyDown=${ev => tipka(ev, p)}>
      ${p.tip === "table"
        ? html`<g class="tl-miza prosta"><${OblikaMize} m=${{ ...p, seats: Number(p.seats) || 0 }} napis2=${p.seats ? String(p.seats) : ""} /></g>`
        : html`<${ElementTlorisa} e=${{ type: p.tip, x: p.x, y: p.y, w: p.w, h: p.h, label: p.label }} />`}
    </g>`)}
    ${trenutni ? html`<g class="tl-izbira">
      <rect class="tl-okvir-izbire" x=${trenutni.x * C} y=${trenutni.y * C} width=${trenutni.w * C} height=${trenutni.h * C} rx="3" />
      <g class="tl-rocaj" onPointerDown=${ev => zacniPovlek(ev, trenutni, "velikost")}>
        <circle class="tl-rocaj-zadetek" cx=${rx} cy=${ry} r=${rh} />
        <circle class="tl-rocaj-pika" cx=${rx} cy=${ry} r=${rv} />
      </g>
    </g>` : null}
  <//>`;

  return html`<div class="zaslon vip-zaslon">
    ${glava}
    <p class="besedilo-opis">${jeDogodek ? t("Draw a floor plan just for this event: add the bar, stage and tables, set seats and the price of each table.")
      : t("Draw your floor plan once: add the bar, stage and tables, set seats and the default price. Then switch VIP tables on for each event.")}</p>
    <div class="vip-urejevalnik">
      <div class="vip-platno-stolpec">
        <div class="vip-paleta" role="group" aria-label=${t("Add to the floor plan")}>
          ${["table", ...TIPI].map(tip => html`<button type="button" class=${"gumb-siv majhen" + (tip === "table" ? " poudarjen" : "")} key=${tip} onClick=${() => dodaj(tip)}
            disabled=${tip === "table" ? mize.length >= NAJVEC_MIZ : elementi.length >= NAJVEC_ELEMENTOV}>
            <${Ikona} ime="plus" velikost=${14} /> ${imeTipa(tip)}</button>`)}
        </div>
        ${platno}
        <p class="opomba">${t("Tap an item to select it, then drag it. Drag the corner dot to resize.")}</p>
      </div>
      <div class="vip-stranski">
        ${trenutni ? html`<${Lastnosti} p=${trenutni} st=${st} posodobi=${d => posodobi(trenutni.k, d)} odstrani=${() => odstrani(trenutni.k)} />`
          : html`<p class="opomba srednje">${t("Select a table or an item to edit it.")}</p>`}
        <section class="vip-skupina">
          <h3 class="nastavitev-naslov">${t("Floor size")}</h3>
          <div class="dve-polji">
            <${Stevec} oznaka=${t("Floor width")} vrednost=${st.sirina} min=${najmanjSirina} max=${MAX_MREZA} ob=${v => nastaviMrezo(v, st.visina)} />
            <${Stevec} oznaka=${t("Floor height")} vrednost=${st.visina} min=${najmanjVisina} max=${MAX_MREZA} ob=${v => nastaviMrezo(st.sirina, v)} />
          </div>
        </section>
        ${jeDogodek ? html`<p class="opomba"><a class="povezava-modra" href=${`/app/business/${klub}/vip`}>${t("Edit bottle packages")}</a> ${t("Bottle packages are shared by all your events.")}</p>` : html`<section class="vip-skupina">
          <h3 class="nastavitev-naslov">${t("Bottle packages")}</h3>
          <p class="opomba">${t("Included in the table price. Guests pick one when they book a table.")}</p>
          ${st.paketi.map((p, i) => html`<div class="vip-paket-urejanje" key=${p.k}>
            <div class="vc-vrh">
              <label class="polje"><span class="skrito">${t("Package {n}", { n: i + 1 })}</span>
                <input value=${p.name} maxlength="60" placeholder=${t("e.g. Jameson 0.7 l")} onInput=${e => posodobiPaket(p.k, { name: e.target.value })} /></label>
              <button type="button" class="krog-gumb majhen rdeca" aria-label=${t("Remove package {n}", { n: i + 1 })}
                onClick=${() => { spremeni(); setSt(x => ({ ...x, paketi: x.paketi.filter(q => q.k !== p.k) })); }}><${Ikona} ime="trash" velikost=${16} /></button>
            </div>
            <label class="polje"><span class="skrito">${t("Description")}</span>
              <textarea rows="2" maxlength="200" placeholder=${t("e.g. 4x Red Bull, 1 l orange juice")} value=${p.description}
                onInput=${e => posodobiPaket(p.k, { description: e.target.value })}></textarea></label>
          </div>`)}
          ${st.paketi.length < NAJVEC_PAKETOV ? html`<button type="button" class="gumb-siv" onClick=${() => { spremeni(); setSt(x => ({ ...x, paketi: [...x.paketi, { k: kljuc(), name: "", description: "" }] })); }}>
            <${Ikona} ime="circle-plus" velikost=${18} /> ${t("Add package")}</button>` : null}
        </section>`}
        ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
        ${shranjeno ? html`<p class="uspeh-besedilo" role="status">${jeDogodek ? t("Saved.") : t("Saved. You can now switch VIP tables on for each event.")}</p>` : null}
        ${neshranjeno ? html`<p class="opomba oranzna" role="status">${t("Unsaved changes")}</p>` : null}
        <button type="button" class="gumb-glavni" onClick=${shrani} disabled=${shranjujem || !neshranjeno}>${shranjujem ? t("Saving...") : t("Save")}</button>
      </div>
    </div>
  </div>`;
}

/** Stevec - / + (isti videz kot stevec vstopnic); dostopen nadomestek za vlecenje. */
function Stevec({ oznaka, vrednost, min, max, ob }) {
  return html`<div class="vip-stevec"><span class="vip-stevec-oznaka">${oznaka}</span>
    <div class="stevec" role="group" aria-label=${oznaka}>
      <button type="button" onClick=${() => ob(vrednost - 1)} disabled=${vrednost <= min} aria-label=${oznaka + " −"}>−</button>
      <output aria-live="polite">${vrednost}</output>
      <button type="button" onClick=${() => ob(vrednost + 1)} disabled=${vrednost >= max} aria-label=${oznaka + " +"}>+</button>
    </div></div>`;
}

/** Lastnosti izbranega predmeta: oznaka, sedezi, cena v EUR, oblika, polozaj/velikost, brisanje. */
function Lastnosti({ p, st, posodobi, odstrani }) {
  const miza = p.tip === "table";
  return html`<section class="vip-skupina vip-lastnosti" aria-label=${t("Selected item")}>
    <h3 class="nastavitev-naslov">${miza ? t("Table") + " " + p.label : imeTipa(p.tip)}</h3>
    ${p.tip !== "wall" ? html`<label class="polje-oznaceno">${t("Label")}
      <input value=${p.label} maxlength=${miza ? 20 : 30} placeholder=${miza ? "T1" : imeTipa(p.tip)} onInput=${e => posodobi({ label: e.target.value })} /></label>` : null}
    ${miza ? html`
      <div class="dve-polji">
        <label class="polje-oznaceno">${t("Seats")}
          <input inputmode="numeric" value=${p.seats} maxlength="2" onInput=${e => posodobi({ seats: e.target.value })} /></label>
        <label class="polje-oznaceno">${t("Price (EUR)")}
          <input inputmode="decimal" value=${p.cena} placeholder="300" onInput=${e => posodobi({ cena: e.target.value })} /></label>
      </div>
      <div class="skupina-polj"><span class="oznaka-polja">${t("Shape")}</span>
        <div class="vrsta-izbir dve">${[["round", t("Round")], ["rect", t("Rectangle")]].map(([v, ime]) => html`<button type="button" key=${v}
          class=${"cip" + (p.shape === v ? " izbran" : "")} aria-pressed=${p.shape === v} onClick=${() => posodobi({ shape: v })}>${ime}</button>`)}</div></div>` : null}
    <div class="dve-polji">
      <${Stevec} oznaka=${t("Left")} vrednost=${p.x} min=${0} max=${st.sirina - p.w} ob=${v => posodobi({ x: v })} />
      <${Stevec} oznaka=${t("Top")} vrednost=${p.y} min=${0} max=${st.visina - p.h} ob=${v => posodobi({ y: v })} />
      <${Stevec} oznaka=${t("Width")} vrednost=${p.w} min=${1} max=${st.sirina - p.x} ob=${v => posodobi({ w: v })} />
      <${Stevec} oznaka=${t("Height")} vrednost=${p.h} min=${1} max=${st.visina - p.y} ob=${v => posodobi({ h: v })} />
    </div>
    <button type="button" class="gumb-rdec" onClick=${odstrani}><${Ikona} ime="trash" velikost=${16} /> ${t("Delete")}</button>
  </section>`;
}
