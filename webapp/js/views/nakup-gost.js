/* Nakup vstopnice BREZ racuna (Martin, 5. 10. 2026): kupec vpise samo e-naslov (brez kode iz maila, brez gesla).
   Samo navadne vstopnice - VIP mize ostanejo za prijavljene (views/vip-kupec.js). Backend: POST /guest/events/:id/orders
   (brez zetona, Idempotency-Key kot pri navadnem nakupu); odgovor { order, mode, checkout_url?, guest_token }.
   - test: narocilo je takoj placano -> shranimo guest_token in gremo na /app/guest/order;
   - stripe: preusmeritev na checkout_url, Stripe po placilu vrne na /app/guest/order?t=<guest_token>.
   Kartice NIKOLI ne vnasamo v nas vmesnik. Kljuc nakupa (api.js) je vezan na e-naslov: ponovni klik ali timeout = isto narocilo. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, useJezik } from "../i18n.js";
import { send, pocistiPredpomnilnik, kljucNakupa, pozabiKljucNakupa, oznaciIzidNakupa, zasejKljucNakupa } from "../api.js";
import {
  jeNakup503, jeNakupZaseden, nakupPocakajS, nakupZasedenoSporocilo, jeNakupVObdelavi, NAKUP_V_OBDELAVI_S,
  ApiError, izidNakupa, nakupBrezOdgovoraSporocilo, gostSporocilo
} from "../napake.js";
import { denar, jeRazprodan, preostanek, danInUra } from "../oblika.js";
import { List, useZaklep } from "../ui.js";
import { navigiraj } from "../usmerjanje.js";
import { odpriStripe } from "../stripe.js";
import { TERMS_VERSION, EMAIL_RE } from "../pogoji.js";
import { shraniGostZeton, jeGostZeton, shraniGostNakup, preberiGostNakup, pozabiGostNakup } from "../gost.js";

const danes = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function GostNakupList({ odprt, zapri, dogodek: e, imeKluba, kraj, prijava }) {
  const koda = useJezik();
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [kolicina, setKolicina] = useState(1);
  const [soglasje, setSoglasje] = useState(false);
  const [posiljam, setPosiljam] = useState(false);
  const [napaka, setNapaka] = useState("");
  const polje = nastavi => v => { setNapaka(""); nastavi(v); };   // napaka velja za zadnjo oddajo: ob spremembi polja izgine
  const tece = useRef(false);   // zascita pred dvojnim klikom v istem trenutku (stanje se posodobi prepozno)
  const [zaklenjeno, zakleni] = useZaklep();   // po 503 (semafor nakupov) je gumb nekaj sekund onemogocen
  const ziv = useRef(true);
  const odprtRef = useRef(odprt);
  odprtRef.current = odprt;
  useEffect(() => () => { ziv.current = false; }, []);
  // Nazaj iz Stripove strani (gumb Nazaj, bfcache): stran se obnovi s stanjem "Processing..." - gumb odklenemo.
  useEffect(() => {
    const ob = ev => { if (ev.persisted) { tece.current = false; setPosiljam(false); } };
    window.addEventListener("pageshow", ob);
    return () => window.removeEventListener("pageshow", ob);
  }, []);
  useEffect(() => {
    if (!odprt) return;
    const ostane = preostanek(e), najvec = Math.max(1, Math.min(10, ostane == null ? 10 : ostane));
    // Vrnitev s Stripove strani brez placila (cancel_url): e-naslov in kolicina ostaneta, ponovni nakup uporabi isti kljuc.
    const prej = preberiGostNakup(e.id);
    if (prej) { setEmail(prej.e); setKolicina(Math.max(1, Math.min(prej.q, najvec))); }
    else setKolicina(k => Math.min(k, najvec));
    setNapaka("");
  }, [odprt]);
  // Cena null = vstopnic ni na Outlyju; tak dogodek nima nakupa (in NI "Free").
  if (!odprt || e.ticket_price_cents == null) return null;

  const cenaEna = e.ticket_price_cents;
  const brezplacno = cenaEna === 0;
  const ostane = preostanek(e);
  const najvec = Math.max(1, Math.min(10, ostane == null ? 10 : ostane));
  const skupaj = cenaEna * kolicina;
  const razprodano = jeRazprodan(e) || ostane === 0;
  const potrebujeStarost = e.min_age > 0;
  const zasebnost = koda === "sl" ? "/privacy-app" : "/privacy";   // politika v jeziku obrazca (pravno 2.2: EN /privacy, SL /privacy-app)

  async function kupi(ev) {
    ev.preventDefault();
    if (tece.current) return;
    const m = email.trim().toLowerCase();
    if (!EMAIL_RE.test(m)) return setNapaka(t("Enter a valid email address."));
    if (potrebujeStarost) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob < "1900-01-01") return setNapaka(t("Enter a valid date of birth."));
      if (dob > danes()) return setNapaka(t("Date of birth cannot be in the future."));
    }
    if (!soglasje) return setNapaka(t("Please confirm you are at least 15 and accept the Terms of Use."));
    tece.current = true;
    setPosiljam(true); setNapaka("");
    // Isti e-naslov + dogodek + kolicina = isti kljuc (api.js, 24 h): backend vrne isto narocilo (201). Datum rojstva ni del
    // vsebine (backend primerja dogodek in kolicino) in se nikjer ne shranjuje.
    const vsebina = String(kolicina);
    const prej = preberiGostNakup(e.id);
    if (prej && prej.e === m && prej.q === kolicina) zasejKljucNakupa("gost", m, e.id, vsebina, prej.k);
    const kljuc = kljucNakupa("gost", m, e.id, vsebina, null);
    const telo = { email: m, quantity: kolicina, accept_terms: true, terms_version: TERMS_VERSION };
    if (potrebujeStarost) telo.date_of_birth = dob;
    try {
      const r = await send(`/guest/events/${e.id}/orders`, { method: "POST", body: telo, glave: { "Idempotency-Key": kljuc } });
      pocistiPredpomnilnik();   // zaloga (sold_count) na karticah naj bo sveza
      const zeton = r && r.guest_token;
      // Stripe: kljuca NE pozabimo - ce se kupec vrne brez placila, ponovni pritisk vrne ISTO narocilo in isti checkout_url.
      if (r && r.mode === "stripe" && r.checkout_url) {
        shraniGostZeton(zeton);
        shraniGostNakup({ e: m, d: e.id, q: kolicina, k: kljuc });
        if (odpriStripe(r.checkout_url)) return;   // stran se preusmerja; gumb ostane "Processing..."
        throw new ApiError(-1, "Could not open the payment page.");
      }
      if (!jeGostZeton(zeton)) throw new ApiError(500, "No guest token.");
      shraniGostZeton(zeton);
      pozabiGostNakup();
      pozabiKljucNakupa("gost", m, e.id, kljuc);   // uspeh: naslednji nakup dobi nov kljuc
      if (ziv.current && odprtRef.current) { navigiraj("/app/guest/order"); return; }
      // List se je medtem odmontiral: zeton je shranjen, kupec ga najde na /app/guest/order (in v mailu).
    } catch (err) {
      // Nakupa NE ponavljamo sami: uporabnik pritisne znova (isti kljuc, razen ob 422, 400 in 409 order_not_active).
      const izid = izidNakupa(err);
      if (izid === "zavrzen") { pozabiKljucNakupa("gost", m, e.id, kljuc); pozabiGostNakup(kljuc); }   // 409 order_not_active, 422, 400: nov kljuc ob naslednjem kliku
      else oznaciIzidNakupa("gost", m, e.id, kljuc, izid);
      if (jeNakup503(err)) zakleni(nakupPocakajS(err));
      else if (jeNakupVObdelavi(err)) zakleni(nakupPocakajS(err, NAKUP_V_OBDELAVI_S));
      if (ziv.current) {
        if (jeNakupZaseden(err)) setNapaka(nakupZasedenoSporocilo());
        else if (err instanceof ApiError && err.status === -1 && izid === "nerazresen") setNapaka(nakupBrezOdgovoraSporocilo());
        else setNapaka(gostSporocilo(err));
      }
    }
    tece.current = false;
    if (ziv.current) setPosiljam(false);
  }
  // Med letecim nakupom lista ni mogoce zapreti (odgovor bi se izgubil, uporabnik bi placal znova).
  const zapriVarno = () => { if (!tece.current) zapri(); };

  return html`<${List} odprt=${true} zapri=${zapriVarno} brezZapiranja=${posiljam} naslov=${t("Checkout")}>
    <div class="nakup-dogodek">
      <span class="nadnapis">${(imeKluba || "").toUpperCase()}</span>
      <strong>${e.title}</strong>
      <span class="utisano">${danInUra(e._zacetek)}</span>
      ${kraj && kraj !== "-" ? html`<span class="utisano">${kraj}</span>` : null}
      ${e.min_age > 0 ? html`<span class="utisano">${t("{n}+ · ID at the door", { n: e.min_age })}</span>` : null}
      ${imeKluba ? html`<span class="utisano">${t("Seller: {club}", { club: imeKluba })}</span>` : null}
    </div>

    <form class="obrazec" onSubmit=${kupi} novalidate>
      <label class="polje-oznaceno"><span>${t("Email")}</span>
        <input type="email" name="email" value=${email} placeholder="email@domain.com" onInput=${x => polje(setEmail)(x.target.value)}
          autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required />
      </label>
      <p class="opomba gost-opomba">${t("Your tickets will be sent to this email.")}${" "}
        ${t("We use your email to send your tickets and receipt. Details in the")} <a href=${zasebnost} target="_blank" rel="noopener">${t("Privacy Policy")}</a>.</p>

      ${potrebujeStarost ? html`<label class="polje-oznaceno"><span>${t("Date of birth")}</span>
        <input type="date" name="bday" value=${dob} max=${danes()} min="1900-01-01" onInput=${x => polje(setDob)(x.target.value)} autocomplete="bday" required />
      </label>
      <p class="opomba gost-opomba">${t("This event is {n}+. We need your date of birth to check your age.", { n: e.min_age })}</p>` : null}

      <div class="nakup-vrsta">
        <div><strong>${brezplacno ? t("Free") : denar(cenaEna, e.currency)}</strong><span class="utisano"> ${t("per ticket")}</span></div>
        <div class="stevec" role="group" aria-label=${t("Number of tickets")}>
          <button type="button" onClick=${() => { if (!tece.current) setNapaka(""); setKolicina(k => Math.max(1, k - 1)); }} disabled=${kolicina <= 1 || posiljam} aria-label=${t("Fewer")}>−</button>
          <output aria-live="polite">${kolicina}</output>
          <button type="button" onClick=${() => { if (!tece.current) setNapaka(""); setKolicina(k => Math.min(najvec, k + 1)); }} disabled=${kolicina >= najvec || posiljam} aria-label=${t("More")}>+</button>
        </div>
      </div>

      <div class="nakup-skupaj">
        <span>${t("Total")}<small class="utisano"> · ${t("Prices include VAT")}</small></span>
        <strong>${brezplacno ? t("Free") : denar(skupaj, e.currency)}</strong>
      </div>

      ${brezplacno ? null : html`<p class="opomba">${t("You pay by card on the next page. Your tickets are sent by email right after payment.")}</p>`}

      <p class="opomba">${t("Tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12). The seller is the club; Outly is the intermediary.")}</p>

      <label class="soglasje">
        <input type="checkbox" checked=${soglasje} onChange=${x => polje(setSoglasje)(x.target.checked)} />
        <span>${t("I am at least 15 years old and I accept the")} <a href="/terms" target="_blank" rel="noopener">${t("Terms of Use")}</a>.${" "}
          ${t("I have read the")} <a href=${zasebnost} target="_blank" rel="noopener">${t("Privacy Policy")}</a>.</span>
      </label>
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}

      <button type="submit" class="gumb-glavni" disabled=${posiljam || razprodano || zaklenjeno}>
        ${razprodano ? t("Sold out") : posiljam ? t("Processing...")
          : brezplacno ? (kolicina === 1 ? t("Get ticket") : t("Get tickets"))
          : t("Pay {amount}", { amount: denar(skupaj, e.currency) })}
      </button>
    </form>
    <button type="button" class="povezava-gumb" onClick=${prijava} disabled=${posiljam}>${t("Have an account? Sign in")}</button>
  <//>`;
}
