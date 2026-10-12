/* VIP mize za kupca (zaslon dogodka): tloris, izbira mize, izbira bottle paketa, nakup mize.
   GET /events/:id/vip (javno), POST /events/:id/tables/:tableId/orders (zeton). Testni nacin kot pri vstopnicah:
   narocilo je takoj placano, nic se ne zaracuna. Kupec dobi toliko VIP vstopnic, kolikor ima miza sedezev; razdeli
   jih prijateljem z obstojecim prenosom (Profile -> Tickets). Ta modul se nalozi leno (event.js), ko dogodek ponuja VIP. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, tn, kodaJezika } from "../i18n.js";
import { send, pocistiPredpomnilnik, kljucNakupa, pozabiKljucNakupa, nerazresenNakup, oznaciIzidNakupa, zapomniCakajocePlacilo, obnoviCakajocePlacilo } from "../api.js";
import { uidSeje, useSeja } from "../seja.js";
import {
  sporocilo, ApiError, jeNakup503, jeNakupZaseden, nakupPocakajS, nakupZasedenoSporocilo,
  jeNakupVObdelavi, NAKUP_V_OBDELAVI_S, izidNakupa, jeNarociloNeaktivno, nakupNapakaSporocilo, nakupBrezOdgovoraSporocilo, potekloPlacilo, placiloVObdelavi, placiloNepripravljeno, jeMejaBrezplacnih, jeProdajalecNepopoln
} from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import { odpriStripe, izidStripeNakupa, jeStripeUrl } from "../stripe.js";
import { PogojiNakupa, BlokProdajalca, OpombaVracila, TERMS_VERSION } from "../pogoji.js";
import { denar, danInUra, nacinPlacila, normalizirajProdajalca, ddvBesedilo } from "../oblika.js";
import { List, Ikona, Nalaganje, Napaka, useZaklep } from "../ui.js";
import { VipRazdeli, mejaStarostiVip, zapomniCakajocVip } from "./vip-razdeli.js";
import {
  C, doOseb, normalizirajTloris, normalizirajMize, normalizirajPakete, useSirina,
  TlorisPlatno, ElementTlorisa, OblikaMize, LegendaMiz, VipVrstica
} from "../vip.js";

/** Tloris za kupca: dotik proste mize jo izbere; prodane so zatemnjene ("Booked"). */
function TlorisKupec({ plan, mize, valuta, izbrana, moja, ob }) {
  const ref = useRef(null);
  const sirina = useSirina(ref);
  const merilo = sirina ? sirina / (plan.width * C) : 1;
  const najmanj = 44 / merilo;   // tarca za dotik vsaj 44 px (majhna miza dobi vecje nevidno zadetno obmocje)
  return html`<${TlorisPlatno} plan=${plan} svgRef=${ref} oznaka=${t("Floor plan")}>
    ${plan.elements.map((e, i) => html`<${ElementTlorisa} key=${"e" + i} e=${e} />`)}
    ${mize.map(m => {   // stalen vrstni red v DOM-u: premik izbrane mize bi izgubil fokus tipkovnice
      const prosta = m.available !== false || m.id === moja;   // moja = miza z mojim cakajocim placilom: zasedena zaradi mojega narocila, a jo smem nadaljevati
      const stanje = !prosta ? "prodana" : m.id === izbrana ? "izbrana" : "prosta";
      const sir = m.w * C, vis = m.h * C;
      const zw = Math.max(sir, najmanj), zh = Math.max(vis, najmanj);
      const opis = `${t("Table")} ${m.label}, ${doOseb(m.seats)}, ${denar(m.price_cents, valuta)}, `
        + (!prosta ? t("Booked") : stanje === "izbrana" ? t("Selected") : t("Available"));
      const izberi = () => { if (prosta) ob(m); };
      return html`<g key=${m.id} class=${"tl-miza " + stanje} role="button" aria-label=${opis} aria-pressed=${stanje === "izbrana"}
        aria-disabled=${prosta ? null : "true"} tabindex=${prosta ? 0 : -1}
        onClick=${izberi} onKeyDown=${ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); izberi(); } }}>
        <rect class="tl-zadetek" x=${m.x * C + sir / 2 - zw / 2} y=${m.y * C + vis / 2 - zh / 2} width=${zw} height=${zh} />
        <${OblikaMize} m=${m} napis2=${prosta ? "" : t("Booked")} />
      </g>`;
    })}
  <//>`;
}

export function VipList({ odprt, zapri, dogodek: e, imeKluba, klub, prijavljen, predizbor }) {
  const [s, setS] = useState({ nalaga: true, napaka: "", d: null });
  const [mizaId, setMizaId] = useState(null);
  const [mojPaket, setMojPaket] = useState(null);   // paket iz zapisa cakajocega placila (id ali null): ponovitev ga poslje, tudi ce ga katalog ne pozna vec
  const [moja, setMoja] = useState(null);   // id mize z mojim nedokoncanim Stripe placilom (miza je zasedena s pending narocilom; outly-app #59)
  const [paketId, setPaketId] = useState(null);
  const [posiljam, setPosiljam] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [nakup, setNakup] = useState(null);
  const [razdeljujem, setRazdeljujem] = useState(false);   // prenosi prijateljem tecejo: list se ne da zapreti
  const tece = useRef(false);   // zascita pred dvojnim klikom (stanje se posodobi prepozno)
  const [zaklenjeno, zakleni] = useZaklep();   // po 503 (semafor nakupov) je gumb nekaj sekund onemogocen

  /** Tloris + mize + paketi. tiho = brez vrtavke (osvezitev po 409: kupec ostane na istem mestu). */
  async function nalozi(tiho, izbor, nejasen) {
    if (!tiho) setS({ nalaga: true, napaka: "", d: null });
    try {
      const r = await send(`/events/${e.id}/vip`, { auth: "optional" });
      const d = {
        enabled: !!(r && r.enabled), onSale: !!(r && r.on_sale), valuta: (r && r.currency) || e.currency || "EUR",
        // payment_mode (backend #149): na vrhu odgovora VIP; sicer iz dogodka; star backend = "stripe".
        nacin: nacinPlacila({ payment_mode: (r && r.payment_mode) || e.payment_mode }),
        // Prodajalec (backend #94): iz odgovora VIP, sicer iz dogodka; star backend = null (blok se ne pokaze).
        prodajalec: normalizirajProdajalca(r && r.seller) || e.seller || null,
        plan: normalizirajTloris(r && r.plan), mize: normalizirajMize(r && r.tables), paketi: normalizirajPakete(r && r.packages)
      };
      setS({ nalaga: false, napaka: "", d });
      // Nedokoncano Stripe placilo (kupec je prisel do Stripa in se vrnil): pending narocilo mizo zaseda ("Booked"), a ponovitev z ISTIM
      // kljucem vrne isti checkout_url (ali placano narocilo, ali order_not_active). Zato se TA miza (in samo ona, iz zapisa tega
      // uporabnika in dogodka) izbere tudi, ce je zasedena, in gumb postane "Continue to payment". Tuja zasedena miza ostane nedosegljiva.
      const cakajoca = nejasen && nejasen.cakaPlacilo === true ? nejasen : null;
      const lastna = cakajoca && d.nacin === "stripe" ? d.mize.find(x => x.id === cakajoca.miza && x.available === false) : null;
      // Izbira (tudi po vrnitvi s prijave): miza mora se obstajati in biti prosta; en sam paket se izbere sam.
      const miza = lastna || d.mize.find(m => m.id === (izbor ? izbor.miza : null) && m.available !== false);
      setMoja(lastna ? lastna.id : null);
      setMojPaket(lastna && cakajoca.paket != null ? cakajoca.paket : null);
      setMizaId(miza ? miza.id : null);
      const paket = d.paketi.find(p => p.id === (lastna ? cakajoca.paket : izbor ? izbor.paket : null));
      setPaketId(paket ? paket.id : !lastna && d.paketi.length === 1 ? d.paketi[0].id : null);
      // Ponovno odprt list po nejasnem izidu: napotek, da je narocilo morda ze nastalo. Ce je lastna miza ze "Booked" (ni je
      // vec mogoce izbrati), naj kupec pogleda Profil -> Vstopnice. Pri cakajocem placilu napotka ni (kupec je bil pri Stripu).
      if (nejasen && !cakajoca) setNapaka(miza && nejasen.miza === miza.id ? nakupBrezOdgovoraSporocilo() : t("No response from the server. Check Profile → Tickets before you try again."));
    } catch (err) {
      if (tiho) return;
      setS({ nalaga: false, napaka: sporocilo(err), d: null });
    }
  }
  const ziv = useRef(true);   // komponenta je nameščena
  const odprtRef = useRef(odprt);
  odprtRef.current = odprt;
  const sejaEmail = useSeja(s => s.email);   // uid seje je ob hladnem zagonu lahko se prazen: obnova se ponovi, ko seja dobi uporabnika
  useEffect(() => () => { ziv.current = false; }, []);
  // Nazaj iz Stripove strani (gumb Nazaj, bfcache): stran se obnovi s stanjem "Processing..." - gumb odklenemo (kot nakup-gost.js).
  useEffect(() => {
    const ob = ev => { if (ev.persisted) { tece.current = false; setPosiljam(false); } };
    window.addEventListener("pageshow", ob);
    return () => window.removeEventListener("pageshow", ob);
  }, []);
  useEffect(() => {
    if (!odprt) return;
    setNapaka(""); setNakup(null); setPosiljam(tece.current);
    // Cakajoce Stripe placilo, shranjeno ob preusmeritvi (stran se je medtem naložila znova), se vrne v zapis kljucev.
    const uid = uidSeje();
    if (uid) obnoviCakajocePlacilo("vip", uid, e.id);
    // Izbira po vrnitvi s prijave ima prednost; sicer nerazresen nakup tega dogodka (miza se obdrzi samo, ce je se prosta - nalozi()).
    const prej = nerazresenNakup("vip", uid, e.id);
    nalozi(false, predizbor || (prej ? { miza: prej.miza, paket: prej.paket } : null), prej);
  }, [odprt, sejaEmail]);
  if (!odprt) return null;

  const d = s.d;
  const miza = d && d.mize.find(m => m.id === mizaId);
  const paket = d && d.paketi.find(p => p.id === paketId);
  const imaPakete = !!d && d.paketi.length > 0;

  async function rezerviraj() {
    if (!miza || tece.current || (d && d.nacin === "unavailable")) return;
    if (!prijavljen) {
      // Prijava in nazaj na isti dogodek (kot pri nakupu vstopnic); izbira mize in paketa se ohrani.
      const nazajNa = `/app/event/${e.id}?vip=1&table=${miza.id}` + (paketId ? `&pkg=${paketId}` : "");
      navigiraj(`/app/login?next=${encodeURIComponent(nazajNa)}`);
      return;
    }
    if (imaPakete && !paket && moja == null) return setNapaka(t("Choose your bottle"));   // cakajoce placilo: paket je ze v zapisu
    // Uid seje se ni znan (pocasen zagon, seja se osvezuje): nakup ne dovolimo - kljuc pod "" bi po pridobitvi uid ostal sirota.
    const uid = uidSeje();
    if (!uid) return setNapaka(sporocilo(new ApiError(-1, "Could not refresh session.")));
    tece.current = true;
    setPosiljam(true); setNapaka("");
    // Ista vsebina nakupa (uporabnik + dogodek + miza + paket) = isti kljuc (api.js, 24 h od zadnje uporabe), tudi po
    // timeoutu/503/409 request_in_progress in po zaprtju ter ponovnem odprtju lista.
    const idPaketa = moja != null ? mojPaket : paket ? paket.id : null;   // moja: paket iz zapisa (isti kljuc), ne iz kataloga
    const paketPrejsnji = idPaketa;
    const kljuc = kljucNakupa("vip", uid, e.id, `${miza.id}|${paketPrejsnji ?? ""}`, { dogodek: e.id, miza: miza.id, paket: paketPrejsnji });
    try {
      const r = await send(`/events/${e.id}/tables/${miza.id}/orders`, {
        method: "POST", body: paketPrejsnji != null ? { package_id: paketPrejsnji, expected_price_cents: miza.price_cents, locale: kodaJezika(), terms_version: TERMS_VERSION } : { expected_price_cents: miza.price_cents, locale: kodaJezika(), terms_version: TERMS_VERSION }, auth: true,
        glave: { "Idempotency-Key": kljuc }
      });
      pocistiPredpomnilnik();
      // Stripe (backend #19): narocilo caka na placilo na Stripovi strani. Kljuca NE pozabimo: ce se kupec vrne brez
      // placila, ponovni pritisk vrne ISTO narocilo in isti checkout_url (ne rezervira se enkrat).
      // Potekla Stripova seja: Stripa ne odpiramo; kljuc OSTANE (placano tik pred rokom -> ponovitev vrne placano miza; sicer 409 order_not_active).
      const izidS = izidStripeNakupa(r);
      if (izidS === "preusmeri") {
        // Po placilu Stripe vrne na /app/tickets?placilo=uspeh: tam se razdelitev ponudi vnovic (vip-razdeli.js).
        zapomniCakajocVip(uid, r.order && r.order.id);
        if (jeStripeUrl(r.checkout_url)) zapomniCakajocePlacilo("vip", uid, e.id, kljuc, r.order && r.order.public_ref);   // vrnitev po polni nalozitvi strani najde isti kljuc
        if (odpriStripe(r.checkout_url)) return;   // stran se preusmerja; gumb ostane "Processing..."
        throw new ApiError(-1, "Could not open the payment page.");
      }
      // payment_processing (odlozeno placilo): NI potekla seja; kljuc ostane (ponovitev = 409 request_in_progress).
      if (izidS === "obdelava") { oznaciIzidNakupa("vip", uid, e.id, kljuc, "nerazresen"); zakleni(30); if (ziv.current) setNapaka(placiloVObdelavi()); }
      else if (izidS === "poteklo") { oznaciIzidNakupa("vip", uid, e.id, kljuc, "dokoncen"); if (ziv.current) { setMoja(null); setNapaka(potekloPlacilo()); } }
      else if (izidS === "nepripravljeno") { oznaciIzidNakupa("vip", uid, e.id, kljuc, "nerazresen"); if (ziv.current) setNapaka(placiloNepripravljeno()); }
      else if (ziv.current && odprtRef.current) { pozabiKljucNakupa("vip", uid, e.id, kljuc); setNakup(r); }   // uspeh: naslednji nakup dobi nov kljuc
      // Uspeh, ki ga uporabnik ni videl (list se je medtem odmontiral): kljuca NE pozabimo - ponovitev vrne isto narocilo (Idempotent-Replayed).
      else oznaciIzidNakupa("vip", uid, e.id, kljuc, "nerazresen");
    } catch (err) {
      // 409 request_in_progress NI "zasedeno": isti nakup se se obdeluje - izbiro mize obdrzimo (isti kljuc), samo pocakamo.
      // 409 order_not_active tudi NI "zasedeno": prejsnje narocilo ni vec aktivno - izbira ostane, tloris se tiho osvezi (miza je morda spet prosta).
      if (jeNarociloNeaktivno(err)) nalozi(true, { miza: miza.id, paket: paketId });
      else if (jeMejaBrezplacnih(err)) { /* miza za 0 EUR: izbira ostane, sporocilo pove omejitev */ }
      else if (jeProdajalecNepopoln(err)) { /* klub brez podatkov prodajalca: miza ni zasedena, izbira ostane, sporocilo pove razlog */ }
      else if (err && err.status === 409 && !jeNakupVObdelavi(err)) { nalozi(true); setMizaId(null); }   // zasedeno ali prodaja zaprta: osvezi tloris
      // Nakupa NE ponavljamo sami: uporabnik pritisne znova (isti kljuc, razen ob 422, 400, 409 order_not_active, free_limit in seller_incomplete - jeKljucZavrzen v napake.js).
      const izid = izidNakupa(err);
      if (izid === "zavrzen") pozabiKljucNakupa("vip", uid, e.id, kljuc);   // nov nakup
      else oznaciIzidNakupa("vip", uid, e.id, kljuc, izid);   // nerazresen: predizpolnitev in napotek ob ponovnem odprtju
      // Streznik je zaseden (503): kratek premor; sporocilo o navalu samo za znano telo (napake.js).
      if (jeNakup503(err)) zakleni(nakupPocakajS(err));   // gumb pri vsakem 503 na nakupu nekaj sekund onemogocen
      else if (jeNakupVObdelavi(err)) zakleni(nakupPocakajS(err, NAKUP_V_OBDELAVI_S));
      if (jeNakupZaseden(err)) setNapaka(nakupZasedenoSporocilo());
      // Brez odgovora: narocilo je morda nastalo - ponovni pritisk z istim kljucem ga najde, ne ustvari drugega.
      // (Neuspela osvezitev seje to NI: zahtevek ni odsel; nakupNapakaSporocilo ju loci.)
      else setNapaka(nakupNapakaSporocilo(err));
    }
    tece.current = false;
    setPosiljam(false);
  }
  // Med letecim nakupom lista ni mogoce zapreti (odgovor bi se izgubil, kupec bi rezerviral znova).
  const zapriVarno = () => { if (!tece.current) zapri(); };

  /* ---- potrditev ---- */
  if (nakup) {
    const o = nakup.order || {};
    const vst = Array.isArray(nakup.tickets) ? nakup.tickets : [];
    const stevilo = vst.length || o.table_seats || (miza && miza.seats) || 0;
    // Razdelitev prijateljem: samo, ce streznik vrne vsaj dve vstopnici (ena vedno ostane kupcu). Ponovitev nakupa (isti
    // Idempotency-Key) vrne TRENUTNO stanje: ze poslane (`transferred`) niso vec kupceve in ne smejo v razdelitev.
    const svoje = vst.filter(x => x && x.transferred !== true);
    const razdeli = svoje.length >= 2;
    const meja = mejaStarostiVip(vst[0], e.min_age, !!(paket || o.package_name || o.package_id != null));
    return html`<${List} odprt=${true} zapri=${zapriVarno} brezZapiranja=${razdeljujem} naslov=${t("VIP tables")}>
      <div class="uspeh">
        <span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("Your VIP table is booked")}</strong>
        <${VipVrstica} v=${{ is_vip: true, table_label: o.table_label || (miza && miza.label), package_name: o.package_name || (paket && paket.name) }} velika=${true} />
        <span>${t("Order {ref}", { ref: o.public_ref || "" })} · ${tn("1 VIP ticket", "{n} VIP tickets", stevilo)}</span>
        ${nakup.mode === "test" ? html`<span class="opomba">${t("Test purchase — nothing was charged")}</span>` : null}
      </div>
      ${razdeli
        ? html`<${VipRazdeli} vstopnice=${svoje} meja=${meja} zapri=${zapriVarno} obZaposlen=${setRazdeljujem} />`
        : html`<p class="opomba srednje">${t("Send the VIP tickets to your friends from Tickets.")}</p>
          <a class="gumb-glavni" href="/app/tickets">${t("Open my tickets")}</a>`}
    <//>`;
  }

  const imaMize = d && d.enabled && d.mize.length > 0;
  return html`<${List} odprt=${true} zapri=${zapriVarno} brezZapiranja=${posiljam} naslov=${t("VIP tables")}>
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    ${s.napaka ? html`<${Napaka} besedilo=${s.napaka} znova=${() => nalozi(false, null)} />` : null}
    ${d && !imaMize ? html`<div class="prazno"><${Ikona} ime="crown" velikost=${34} razred="modra" />
      <strong>${t("No VIP tables available")}</strong>
      ${klub && klub.contact_phone ? html`<span>${t("Until then, call the club to reserve a table.")}</span>
        <a class="gumb-siv" href=${"tel:" + klub.contact_phone.replace(/[^\d+]/g, "")}>${klub.contact_phone}</a>` : null}
    </div>` : null}
    ${imaMize ? html`
      <div class="nakup-dogodek">
        <span class="nadnapis">${(imeKluba || "").toUpperCase()}</span>
        <strong>${e.title}</strong>
        <span class="utisano">${danInUra(e._zacetek)}</span>
      </div>
      ${!d.onSale ? html`<p class="opomba oranzna" role="status">${t("Table reservations are closed for this event.")}</p>` : null}
      ${d.plan
        ? html`<${TlorisKupec} plan=${d.plan} mize=${d.mize} valuta=${d.valuta} izbrana=${mizaId} moja=${moja}
            ob=${m => { if (tece.current || (moja != null && m.id !== moja)) return; setMizaId(m.id); setNapaka(""); }} />`
        : html`<div class="mreza-cipov" role="group" aria-label=${t("VIP tables")}>${d.mize.map(m => html`<button type="button" key=${m.id}
            class=${"cip" + (m.id === mizaId ? " izbran" : "")} disabled=${(m.available === false && m.id !== moja) || (moja != null && m.id !== moja) || posiljam} aria-pressed=${m.id === mizaId}
            onClick=${() => { if (!tece.current) setMizaId(m.id); }}>${m.label}</button>`)}</div>`}
      <${LegendaMiz} />
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      ${miza ? html`<div class="vip-kartica-mize">
        <div class="vip-miza-glava">
          <div class="kv-besedilo"><strong>${t("Table")} ${miza.label}</strong><span>${doOseb(miza.seats)}</span></div>
          <strong class="vip-cena">${denar(miza.price_cents, d.valuta)}</strong>
        </div>
        ${imaPakete ? html`<div class="vip-paketi" role="radiogroup" aria-label=${t("Choose your bottle")}>
          <h3 class="nastavitev-naslov">${t("Choose your bottle")}</h3>
          ${d.paketi.map(p => html`<label class=${"vip-paket" + (p.id === paketId ? " izbran" : "")} key=${p.id}>
            <input type="radio" name="vip-paket" checked=${p.id === paketId} disabled=${posiljam || moja != null} onChange=${() => { if (!tece.current && moja == null) setPaketId(p.id); }} />
            <span class="vip-radio" aria-hidden="true"></span>
            <span class="kv-besedilo"><strong>${p.name}</strong>${p.description ? html`<span>${p.description}</span>` : null}</span>
          </label>`)}
          <span class="opomba">${t("Included in the table price")}</span>
        </div>` : null}
      </div>` : html`<p class="opomba srednje">${t("Tap a free table to reserve it.")}</p>`}
      ${miza ? html`<div class="vip-pas-nakupa">
        <p class="opomba">${ddvBesedilo(d.prodajalec)}</p>
        <${BlokProdajalca} prodajalec=${d.prodajalec} />
        ${d.nacin === "unavailable" ? html`<p class="opomba" role="status">${t("Tickets aren't on sale in the app yet.")}</p>`
          : d.nacin === "test" && miza.price_cents !== 0 ? html`<p class="opomba">${t("Test mode — nothing is charged")}</p>` : null}
        ${moja != null ? html`<p class="opomba" role="status">${t("You have an unfinished payment for this table. Continue to payment to finish it.")}</p>` : null}
        <button type="button" class="gumb-glavni" onClick=${rezerviraj} disabled=${posiljam || zaklenjeno || (!d.onSale && moja == null) || d.nacin === "unavailable" || (imaPakete && !paket && moja == null)}>
          ${posiljam ? t("Processing...") : moja != null ? t("Continue to payment") : t("Reserve table") + " · " + denar(miza.price_cents, d.valuta)}</button>
        <${PogojiNakupa} />
        <${OpombaVracila} prodajalec=${d.prodajalec} vip=${true} />
      </div>` : null}` : null}
  <//>`;
}
