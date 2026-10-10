/* Nakup vstopnic (BuyTicketsView.swift). Testni nacin: dokler Stripe ni vklopljen, je narocilo
   takoj placano in nic se ne zaracuna. Brez vprasanja pred placilom (Martin, 23. 9.).
   Kartice NIKOLI ne vnasamo v nas vmesnik (Stripe Checkout, ko pride). */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send, pocistiPredpomnilnik, kljucNakupa, pozabiKljucNakupa, nerazresenNakup, oznaciIzidNakupa } from "../api.js";
import { uidSeje } from "../seja.js";
import {
  jeNakup503, jeNakupZaseden, nakupPocakajS, nakupZasedenoSporocilo,
  jeNakupVObdelavi, NAKUP_V_OBDELAVI_S, sporocilo, ApiError, izidNakupa, nakupNapakaSporocilo, nakupBrezOdgovoraSporocilo, potekloPlacilo
} from "../napake.js";
import { denar, jeRazprodan, preostanek, danInUra, nacinPlacila } from "../oblika.js";
import { List, Ikona, useZaklep } from "../ui.js";
import { KodaQR } from "../qr.js";
import { odpriStripe, izidStripeNakupa } from "../stripe.js";
import { PogojiNakupa } from "../pogoji.js";

export function NakupList({ odprt, zapri, dogodek: e, imeKluba }) {
  const [kolicina, setKolicina] = useState(1);
  const [posiljam, setPosiljam] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [nakup, setNakup] = useState(null);
  const tece = useRef(false);   // zascita pred dvojnim klikom v istem trenutku (stanje se posodobi prepozno)
  const [zaklenjeno, zakleni] = useZaklep();   // po 503 (semafor nakupov) je gumb nekaj sekund onemogocen
  const ziv = useRef(true);   // komponenta je nameščena
  const odprtRef = useRef(odprt);
  odprtRef.current = odprt;
  useEffect(() => () => { ziv.current = false; }, []);
  useEffect(() => {
    if (!odprt) return;
    // Nerazresen nakup tega dogodka (timeout, brez odgovora ...): list se odpre z ISTO kolicino (isti kljuc) in z napotkom,
    // da je narocilo morda ze nastalo; sicer bi sprememba kolicine dala nov kljuc = drugo narocilo.
    const prej = nerazresenNakup("vstopnice", uidSeje(), e.id);
    const ostane = preostanek(e), najvec = Math.max(1, Math.min(10, ostane == null ? 10 : ostane));
    setKolicina(prej && prej.kolicina >= 1 ? Math.min(prej.kolicina, najvec) : 1);
    setNapaka(prej ? nakupBrezOdgovoraSporocilo() : ""); setNakup(null);
  }, [odprt]);
  // Cena null = vstopnic ni na Outlyju; tak dogodek nima nakupa (in NI "Free").
  if (!odprt || e.ticket_price_cents == null) return null;

  const cenaEna = e.ticket_price_cents;
  const brezplacno = cenaEna === 0;
  const ostane = preostanek(e);
  const najvec = Math.max(1, Math.min(10, ostane == null ? 10 : ostane));
  const skupaj = cenaEna * kolicina;
  const razprodano = jeRazprodan(e) || ostane === 0;
  const nacin = nacinPlacila(e);   // "test" | "stripe" | "unavailable" (backend #149)
  const neprodaja = nacin === "unavailable";

  async function kupi() {
    if (tece.current || neprodaja) return;
    // Uid seje se ni znan (pocasen zagon, seja se osvezuje): nakup ne dovolimo - kljuc pod "" bi po pridobitvi uid ostal sirota.
    const uid = uidSeje();
    if (!uid) return setNapaka(sporocilo(new ApiError(-1, "Could not refresh session.")));
    tece.current = true;
    setPosiljam(true); setNapaka("");
    // Ista vsebina nakupa (uporabnik + dogodek + kolicina) = isti kljuc (api.js, 24 h od zadnje uporabe), tudi po
    // timeoutu/503/409 in po zaprtju ter ponovnem odprtju lista: backend vrne isto narocilo (201).
    const kljuc = kljucNakupa("vstopnice", uid, e.id, String(kolicina), { dogodek: e.id, kolicina });
    try {
      const r = await send(`/events/${e.id}/orders`, { method: "POST", body: { quantity: kolicina }, auth: true, glave: { "Idempotency-Key": kljuc } });
      pocistiPredpomnilnik();
      // Stripe (backend #19): narocilo caka na placilo na Stripovi strani. Kljuca NE pozabimo: ce se kupec vrne brez
      // placila, ponovni pritisk vrne ISTO narocilo in isti checkout_url (ne rezervira se enkrat).
      // Potekla Stripova seja (checkout_expired ali pending brez povezave): Stripa ne odpiramo. Kljuc OSTANE: ce je kupec placal tik pred
      // rokom, ponovitev vrne placano narocilo; sicer 409 order_not_active (kljuc se zavrze) in naslednji pritisk je nov nakup.
      // 0 EUR pri klubu s Stripom: mode "stripe", paid, tickets polne, checkout_url null -> uspeh brez Stripa.
      const izidS = izidStripeNakupa(r);
      if (izidS === "preusmeri") {
        if (odpriStripe(r.checkout_url)) return;   // stran se preusmerja; gumb ostane "Processing..."
        throw new ApiError(-1, "Could not open the payment page.");
      }   // zaloga (sold_count) na karticah naj bo sveza
      if (izidS === "poteklo") { oznaciIzidNakupa("vstopnice", uid, e.id, kljuc, "dokoncen"); if (ziv.current) setNapaka(potekloPlacilo()); }
      else if (ziv.current && odprtRef.current) { pozabiKljucNakupa("vstopnice", uid, e.id, kljuc); setNakup(r); }   // uspeh: naslednji nakup dobi nov kljuc
      // Uspeh, ki ga uporabnik ni videl (list se je medtem odmontiral): kljuca NE pozabimo - ponovitev vrne isto narocilo (Idempotent-Replayed).
      else oznaciIzidNakupa("vstopnice", uid, e.id, kljuc, "nerazresen");
    } catch (err) {
      // Nakupa NE ponavljamo sami: uporabnik pritisne znova (isti kljuc, razen ob 422, 400 in 409 order_not_active).
      const izid = izidNakupa(err);
      if (izid === "zavrzen") pozabiKljucNakupa("vstopnice", uid, e.id, kljuc);   // nov nakup
      else oznaciIzidNakupa("vstopnice", uid, e.id, kljuc, izid);   // nerazresen: predizpolnitev in napotek ob ponovnem odprtju
      // Streznik je zaseden (503): kratek premor; sporocilo o navalu samo za znano telo (napake.js).
      if (jeNakup503(err)) zakleni(nakupPocakajS(err));   // gumb pri vsakem 503 na nakupu nekaj sekund onemogocen
      else if (jeNakupVObdelavi(err)) zakleni(nakupPocakajS(err, NAKUP_V_OBDELAVI_S));   // 409 request_in_progress: isti nakup se obdeluje
      if (jeNakupZaseden(err)) setNapaka(nakupZasedenoSporocilo());
      // Brez odgovora: narocilo je morda nastalo - ponovni pritisk z istim kljucem ga najde, ne ustvari drugega.
      // (Neuspela osvezitev seje to NI: zahtevek ni odsel; nakupNapakaSporocilo ju loci.)
      else setNapaka(nakupNapakaSporocilo(err));
    }
    tece.current = false;
    setPosiljam(false);
  }
  // Med letecim nakupom lista ni mogoce zapreti (odgovor bi se izgubil, uporabnik bi placal znova).
  const zapriVarno = () => { if (!tece.current) zapri(); };

  if (nakup) {
    const vst = (nakup.tickets || []).filter(v => v.qr);
    return html`<${List} odprt=${true} zapri=${zapriVarno} naslov=${t("Your tickets")}>
      <div class="uspeh">
        <span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("You're in!")}</strong>
        <span>${t("Order {ref}", { ref: nakup.order && nakup.order.public_ref })} · ${tn("1 ticket", "{n} tickets", (nakup.tickets || []).length)}</span>
        ${nakup.mode === "test" ? html`<span class="opomba">${t("Test purchase — nothing was charged")}</span>` : null}
      </div>
      <div class="vstopnice-seznam">
        ${vst.map((v, i) => html`<div class="vstopnica" key=${v.id}>
          <div class="vstopnica-glava"><span class="nadnapis">${imeKluba.toUpperCase()}</span><span class="nadnapis">${t("{i} OF {n}", { i: i + 1, n: vst.length })}</span></div>
          <strong>${e.title}</strong>
          <${KodaQR} vsebina=${v.qr} velikost=${200} oznaka=${t("Ticket QR code")} />
          <span class="utisano">${t("TICKET")} ${String(v.serial || "").slice(0, 8).toUpperCase()}</span>
        </div>`)}
      </div>
      <p class="opomba srednje">${t("Saved under Profile → Tickets. Show the QR code at the door.")}</p>
      <a class="gumb-glavni" href="/app/tickets">${t("Open my tickets")}</a>
    <//>`;
  }

  return html`<${List} odprt=${true} zapri=${zapriVarno} brezZapiranja=${posiljam} naslov=${t("Checkout")}>
    <div class="nakup-dogodek">
      <span class="nadnapis">${(imeKluba || "").toUpperCase()}</span>
      <strong>${e.title}</strong>
      <span class="utisano">${danInUra(e._zacetek)}</span>
      ${e.min_age > 0 ? html`<span class="utisano">${t("{n}+ · ID at the door", { n: e.min_age })}</span>` : null}
    </div>

    <div class="nakup-vrsta">
      <div><strong>${brezplacno ? t("Free") : denar(cenaEna, e.currency)}</strong><span class="utisano"> ${t("per ticket")}</span></div>
      <div class="stevec" role="group" aria-label=${t("Number of tickets")}>
        <button type="button" onClick=${() => { if (!tece.current) setKolicina(k => Math.max(1, k - 1)); }} disabled=${kolicina <= 1 || posiljam} aria-label=${t("Fewer")}>−</button>
        <output aria-live="polite">${kolicina}</output>
        <button type="button" onClick=${() => { if (!tece.current) setKolicina(k => Math.min(najvec, k + 1)); }} disabled=${kolicina >= najvec || posiljam} aria-label=${t("More")}>+</button>
      </div>
    </div>

    <div class="nakup-skupaj">
      <span>${t("Total")}<small class="utisano"> · ${t("Prices include VAT")}</small></span>
      <strong>${brezplacno ? t("Free") : denar(skupaj, e.currency)}</strong>
    </div>

    ${neprodaja ? html`<p class="opomba" role="status">${t("Tickets aren't on sale in the app yet.")}</p>`
      : nacin === "test" && !brezplacno ? html`<p class="opomba">${t("Test mode — nothing is charged")}</p>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}

    <button type="button" class="gumb-glavni" onClick=${kupi} disabled=${posiljam || razprodano || zaklenjeno || neprodaja}>
      ${razprodano ? t("Sold out") : posiljam ? t("Processing...")
        : brezplacno ? (kolicina === 1 ? t("Get ticket") : t("Get tickets"))
        : t("Pay {amount}", { amount: denar(skupaj, e.currency) })}
    </button>
    <${PogojiNakupa} />
    <p class="opomba">${t("Tickets for a dated event cannot be returned after purchase (ZVPot-1, 135/12). The seller is the club; Outly is the intermediary.")}</p>
  <//>`;
}
