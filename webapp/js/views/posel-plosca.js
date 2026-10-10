/* Nadzorna plosca kluba (BusinessDashboardView, prenova 25.-26. 9. 2026) in skeniranja clana ekipe (StaffScansView).
   Vrstni red kot iOS: stiri stevilke, obdobje, graf prodaje, "Check activity", "Event performance".
   Graf je SVG (brez knjiznice): modra krivulja s prelivom pod njo, kot Martinova skica. */
import { html, useEffect, useMemo, useRef, useState } from "../lib.js";
import { t, tn, locale } from "../i18n.js";
import { sporocilo } from "../napake.js";
import { denar } from "../oblika.js";
import { GlavaNazaj, Ikona, Slika, Avatar, Nalaganje, Napaka } from "../ui.js";
import { idKluba, poslovno, imeVloge } from "../posel.js";
import { PoslovnaNapaka } from "./posel.js";

const OBDOBJA = [["year", "By year"], ["month", "By month"], ["week", "By week"]];
const stevilka = n => new Intl.NumberFormat(locale()).format(n || 0);
const datumDogodka = s => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "";
};

export function NadzornaPlosca({ klub }) {
  const id = idKluba(klub);
  const [obdobje, setObdobje] = useState("month");
  const [prodaja, setProdaja] = useState(null);
  const [aktivnost, setAktivnost] = useState(null);
  const [ime, setIme] = useState("");
  const [nalaga, setNalaga] = useState(true);
  const [nalagaGraf, setNalagaGraf] = useState(false);
  const [napaka, setNapaka] = useState(null);
  const baza = `/app/business/${id}`;
  const zadnji = useRef(0);   // samo zadnji odgovor sme dolociti graf (hiter preklop obdobja)

  const nalozi = async () => {
    setNalaga(true); setNapaka(null);
    const st = ++zadnji.current;
    try { const r = await poslovno(id, `/business/sales?range=${obdobje}`); if (st === zadnji.current) setProdaja({ ...r, _obdobje: obdobje }); }
    catch (e) { setNapaka(e); setNalaga(false); return; }
    // Ce streznik (se) nima /business/activity, zaslon vseeno pokaze graf in dogodke.
    poslovno(id, "/business/activity").then(setAktivnost).catch(() => setAktivnost(null));
    poslovno(id, "/business/clubs/me").then(k => setIme(k.name || "")).catch(() => {});
    setNalaga(false);
  };
  useEffect(() => { if (id) nalozi(); }, [id]);
  async function zamenjajObdobje(o) {
    if (o === obdobje) return;
    setObdobje(o); setNalagaGraf(true);
    const st = ++zadnji.current;
    try {
      const r = await poslovno(id, `/business/sales?range=${o}`);
      if (st === zadnji.current) setProdaja({ ...r, _obdobje: o });
    } catch (e) {
      // Ob napaki gumb pokaze obdobje grafa, ki je na zaslonu.
      if (st === zadnji.current) { setNapaka(e); setObdobje(p => (prodaja && prodaja._obdobje) || p); }
    }
    if (st === zadnji.current) setNalagaGraf(false);
  }

  if (!id) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/profile" /><${PoslovnaNapaka} napaka=${{ status: 404 }} /></div>`;
  const s = prodaja;
  const povzetek = (s && s.summary) || {};
  // Napis temelji na payment_mode TEGA kluba (backend #149); star backend ga nima -> kot doslej globalni `mode`.
  const test = !!s && (s.payment_mode ? s.payment_mode === "test" : s.mode === "test");
  return html`<div class="zaslon plosca">
    <${GlavaNazaj} rezerva=${baza} />
    <div class="naslov-z-gumbom"><h1 class="velik-naslov">${t("Dashboard")}</h1>${test ? html`<span class="znacka-test">${t("TEST")}</span>` : null}</div>
    ${ime ? html`<p class="podnaslov-plosce">${ime}</p>` : null}
    ${test ? html`<p class="opomba oranzna">${t("Test mode: purchases are simulated, no money moves. Numbers show how the real dashboard will look.")}</p>` : null}
    ${nalaga && !s ? html`<${Nalaganje} />` : null}
    ${napaka && !s ? html`<${PoslovnaNapaka} napaka=${napaka} znova=${nalozi} />` : null}
    ${napaka && s ? html`<${Napaka} besedilo=${sporocilo(napaka)} />` : null}
    ${s ? html`
      <div class="mreza-stevilk">
        <${Stevilka} naslov=${t("Total revenue")} vrednost=${denar(povzetek.gross_cents || 0)} opis=${t("gross, all events")} />
        <${Stevilka} naslov=${t("Tickets sold")} vrednost=${stevilka(povzetek.tickets_sold)}
          opis=${t("{orders} orders · {buyers} buyers", { orders: stevilka(povzetek.orders), buyers: stevilka(povzetek.buyers) })} />
        <${Stevilka} naslov=${t("Outly fee")} vrednost=${denar(povzetek.fee_cents || 0)} opis=${s.fee_percent != null ? t("{p} % of gross", { p: Math.round(s.fee_percent) }) : ""} />
        <${Stevilka} naslov=${t("Your payout")} vrednost=${denar(povzetek.net_cents || 0)} opis=${t("after fee and refunds")} modra=${true} />
      </div>
      <div class="obdobja" role="group" aria-label=${t("Period")}>
        ${OBDOBJA.map(([o, napis]) => html`<button type="button" class=${"obdobje" + (o === obdobje ? " izbrano" : "")} aria-pressed=${o === obdobje} onClick=${() => zamenjajObdobje(o)}>${t(napis)}</button>`)}
      </div>
      <${GrafProdaje} serija=${Array.isArray(s.series) ? s.series : []} obdobje=${s._obdobje || obdobje} nalaga=${nalagaGraf} />
      ${aktivnost ? html`<${Aktivnost} a=${aktivnost} baza=${baza} />` : null}
      <div class="sekcija-glava"><h2>${t("Event performance")}</h2><a class="povezava-desno" href=${baza + "/events"}>${t("View all")}</a></div>
      ${!(s.events || []).length ? html`<p class="opomba">${t("No events yet. Add one under Events.")}</p>` : html`<div class="seznam">
        ${s.events.map(e => html`<a class="vrstica-uspesnosti" key=${e.id} href=${`${baza}/events/${e.id}/tickets`}>
          <span class="vu-slika">${e.poster_url ? html`<${Slika} src=${e.poster_url} sirina=${160} alt="" />` : html`<${Ikona} ime="calendar" velikost=${20} razred="modra" />`}</span>
          <span class="kv-besedilo"><strong>${e.title}</strong>
            <span>${datumDogodka(e.start_at)}${e.status && e.status !== "published" ? " · " + (e.status === "cancelled" ? t("cancelled") : e.status === "draft" ? t("draft") : e.status) : ""}</span>
            <span class="vu-meta">${[e.capacity != null ? t("{sold}/{cap} sold", { sold: e.tickets_sold || 0, cap: e.capacity }) : t("{n} sold", { n: e.tickets_sold || 0 }),
              t("{n} in", { n: e.checked_in || 0 }), e.interested_count > 0 ? t("{n} interested", { n: e.interested_count }) : ""].filter(Boolean).join(" · ")}</span></span>
          <span class="vu-desno"><strong class="modra">${denar(e.gross_cents || 0)}</strong>
            ${e.capacity > 0 ? html`<span class="napredek" role="progressbar" aria-label=${t("{sold}/{cap} sold", { sold: e.sold_count || 0, cap: e.capacity })} aria-valuemin="0" aria-valuemax=${e.capacity} aria-valuenow=${Math.min(e.sold_count || 0, e.capacity)}>
              <span style=${{ transform: `scaleX(${Math.min(1, (e.sold_count || 0) / e.capacity)})` }}></span></span>` : null}</span>
        </a>`)}
      </div>`}` : null}
  </div>`;
}

function Stevilka({ naslov, vrednost, opis, modra }) {
  return html`<div class="kartica-stevilke"><span class="ks-naslov">${naslov}</span>
    <strong class=${modra ? "modra" : ""}>${vrednost}</strong><span class="ks-opis">${opis}</span></div>`;
}

function Aktivnost({ a, baza }) {
  const clani = Array.isArray(a.staff) ? a.staff : [];
  const kartica = (naslov, v, d) => html`<div class="kartica-stevilke"><span class="ks-naslov">${naslov}</span>
    <strong>${stevilka(v)}</strong><span class="ks-opis">${t("+{n} this week", { n: stevilka(d) })}</span></div>`;
  return html`<section class="aktivnost">
    <h2 class="naslov-sekcije-velik">${t("Check activity")}</h2>
    <div class="aktivnost-mreza">
      <div class="aktivnost-levo">
        ${kartica(t("Clicks on profile"), a.clicks_profile, a.clicks_profile_7d)}
        ${kartica(t("Clicks on events"), a.clicks_events, a.clicks_events_7d)}
        ${kartica(t("Followers"), a.followers_count, a.followers_new_7d)}
      </div>
      <div class="kartica-ekipe"><span class="ks-naslov">${t("Staff activity")}</span>
        ${!clani.length ? html`<span class="opomba srednje ke-prazno">${t("No staff yet")}</span>` : html`<div class="ke-seznam">
          ${clani.map(m => html`<a class="ke-vrstica" key=${m.id} href=${`${baza}/staff/${m.id}`}>
            <${Avatar} url=${m.avatar_url} ime=${m.username} velikost=${28} /><span>${m.username}</span><strong class="modra">${stevilka(m.scans)}</strong></a>`)}
        </div>`}
      </div>
    </div>
  </section>`;
}

/* ---------- Graf ---------- */
const S = 340, V = 200, LEVO = 44, SPODAJ = 22, ZGORAJ = 10, DESNO = 8;

/** Sest "lepih" vrednosti osi Y (0, ~max/12, ~max/6, ~max/3, ~max/2, max), zaokrozeno na 10/50/100 - kot iOS. */
function osY(najvec) {
  if (!(najvec > 0)) return [0];
  const gor = v => { if (v <= 0) return 0; const k = v < 100 ? 10 : v < 1000 ? 50 : 100; return Math.ceil(v / k) * k; };
  const vr = [0, 1 / 12, 1 / 6, 1 / 3, 1 / 2, 1].map(f => gor(najvec * f));
  for (let i = 1; i < vr.length; i++) if (vr[i] <= vr[i - 1]) vr[i] = vr[i - 1] + (vr[i - 1] < 100 ? 10 : vr[i - 1] < 1000 ? 50 : 100);
  return vr;
}

/** Gladka krivulja skozi tocke (Catmull-Rom -> Bezier), kot .catmullRom na iOS. */
function pot(tocke) {
  if (!tocke.length) return "";
  if (tocke.length === 1) return `M${tocke[0][0]},${tocke[0][1]}`;
  let d = `M${tocke[0][0]},${tocke[0][1]}`;
  for (let i = 0; i < tocke.length - 1; i++) {
    const p0 = tocke[i - 1] || tocke[i], p1 = tocke[i], p2 = tocke[i + 1], p3 = tocke[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function datumKosa(b) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(b || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1)) : null;
}

function GrafProdaje({ serija, obdobje, nalaga }) {
  const vsota = serija.reduce((a, p) => a + (p.gross_cents || 0), 0);
  const g = useMemo(() => {
    if (!serija.length || !vsota) return null;
    const evri = serija.map(p => (p.gross_cents || 0) / 100);
    const os = osY(Math.max(...evri));
    const vrh = Math.max(os[os.length - 1], 1);
    const sirina = S - LEVO - DESNO, visina = V - ZGORAJ - SPODAJ;
    const x = i => LEVO + (serija.length === 1 ? sirina / 2 : (i / (serija.length - 1)) * sirina);
    const y = v => ZGORAJ + visina - (v / vrh) * visina;
    const tocke = evri.map((v, i) => [x(i), y(v)]);
    const crta = pot(tocke);
    const ploskev = `${crta} L${tocke[tocke.length - 1][0].toFixed(1)},${ZGORAJ + visina} L${tocke[0][0].toFixed(1)},${ZGORAJ + visina} Z`;
    const f = moznosti => new Intl.DateTimeFormat(locale(), moznosti);
    const oznaka = d => (!d ? "" : obdobje === "year" ? f({ month: "short" }).format(d).replace(".", "").toLowerCase()
      : obdobje === "week" ? f({ weekday: "short" }).format(d).replace(".", "").toLowerCase() : `${d.getDate()}. ${d.getMonth() + 1}.`);
    // Oznake osi Y: vrednosti so neenakomerne (kot iOS) - preblizu lezece (< 14 enot) izpustimo.
    const oznakeY = [];
    for (const v of os) if (!oznakeY.length || Math.abs(y(v) - y(oznakeY[oznakeY.length - 1])) >= 14) oznakeY.push(v);
    const oznakeX = serija.map((p, i) => ({ i, napis: oznaka(datumKosa(p.bucket)) }))
      .filter(o => obdobje !== "month" || o.i % 5 === 0);
    return { oznakeY, y, x, crta, ploskev, oznakeX };
  }, [serija, obdobje, vsota]);

  return html`<section class="graf-prodaje">
    <div class="gp-glava"><h2>${t("Sales")}</h2>
      ${nalaga ? html`<span class="vrtavka majhna" aria-label=${t("Loading...")}></span>` : html`<strong class="modra">${denar(vsota)}</strong>`}</div>
    <div class="gp-platno">
      ${!g ? html`<p class="opomba srednje gp-prazno">${t("No sales in this period")}</p>` : html`
        <svg viewBox=${`0 0 ${S} ${V}`} role="img" aria-label=${t("Sales in this period: {sum}", { sum: denar(vsota) })}>
          <defs>
            <linearGradient id="gp-preliv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#4C76FF" stop-opacity=".55" />
              <stop offset=".45" stop-color="#4C76FF" stop-opacity=".18" />
              <stop offset="1" stop-color="#4C76FF" stop-opacity="0" />
            </linearGradient>
          </defs>
          ${g.oznakeY.map(v => html`<text x=${LEVO - 6} y=${g.y(v) + 3} text-anchor="end" class="gp-os">${v === 0 ? "0 €" : `${Math.round(v)} €`}</text>`)}
          ${g.oznakeX.map(o => html`<text x=${g.x(o.i)} y=${V - 6} text-anchor="middle" class="gp-os">${o.napis}</text>`)}
          <path d=${g.ploskev} fill="url(#gp-preliv)" />
          <path d=${g.crta} fill="none" stroke="#4C76FF" stroke-opacity=".14" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
          <path d=${g.crta} fill="none" stroke="#4C76FF" stroke-opacity=".35" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
          <path d=${g.crta} fill="none" stroke="#4C76FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>`}
    </div>
  </section>`;
}

/* ---------- Skeniranja clana ekipe ---------- */
export function SkeniranjaClana({ klub, clan }) {
  const id = idKluba(klub);
  const uid = idKluba(clan);
  const [s, setS] = useState({ nalaga: true, napaka: null, dogodki: [], oseba: null });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    Promise.all([poslovno(id, `/business/team/${uid}/scans`), poslovno(id, "/business/activity").catch(() => null)])
      .then(([r, a]) => setS({
        nalaga: false, napaka: null, dogodki: (r && Array.isArray(r.events)) ? r.events : [],
        oseba: a && Array.isArray(a.staff) ? a.staff.find(m => m.id === uid) || null : null
      }))
      .catch(e => setS({ nalaga: false, napaka: e, dogodki: [], oseba: null }));
  };
  useEffect(() => { if (id && uid) nalozi(); }, [id, uid]);
  const rezerva = `/app/business/${id}/dashboard`;
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${rezerva} />
    ${s.oseba ? html`<div class="poslovna-glava"><${Avatar} url=${s.oseba.avatar_url} ime=${s.oseba.username} velikost=${44} />
      <div class="kv-besedilo"><strong class="profil-ime">${s.oseba.username}</strong><span>${imeVloge(s.oseba.role)}</span></div></div>` : null}
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${s.napaka} znova=${nalozi} rezerva=${rezerva} />
    ${!s.nalaga && !s.napaka && !s.dogodki.length ? html`<p class="opomba srednje">${t("No scans yet")}</p>` : null}
    <div class="seznam">${s.dogodki.map(e => html`<div class="vrstica-uspesnosti" key=${e.id}>
      <span class="vu-slika">${e.poster_url ? html`<${Slika} src=${e.poster_url} sirina=${140} alt="" />` : html`<${Ikona} ime="calendar" velikost=${18} razred="modra" />`}</span>
      <span class="kv-besedilo"><strong>${e.title}</strong><span>${datumDogodka(e.start_at)}</span></span>
      <strong class="modra" aria-label=${tn("1 scan", "{n} scans", e.scans || 0)}>${stevilka(e.scans)}</strong>
    </div>`)}</div>
  </div>`;
}
