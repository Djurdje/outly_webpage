/* VIP razdelitev: kupec mize razdeli vstopnice prijateljem (pogodba 8. 10. 2026, razdelek 1). Prikaze se po uspesnem nakupu mize
   (views/vip-kupec.js) in iz skupine VIP vstopnic v Profile -> Tickets (po vrnitvi s Stripa).
   Ena vstopnica VEDNO ostane kupcu: pri N vstopnicah je izbranih najvec N-1 prijateljev. Posiljanje = za vsakega prijatelja
   obstojeci POST /tickets/:id/transfer { user_id, age_confirmed } na RAZLICNO vstopnico, ZAPOREDNO (ne vzporedno), od druge
   vstopnice naprej. Delni neuspeh: pokazemo, komu je slo in komu ne; neuspele vstopnice ostanejo kupcu.
   Backend je nespremenjen. Vsebina brez lastnega lista (List je v klicatelju). */
import { html, useRef, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo, kodaNapake, ApiError } from "../napake.js";
import { Ikona } from "../ui.js";
import { IzbiraPrijateljev, usePrijatelji, napisPosiljanja } from "../izbira-prijateljev.js";

/* Pred preusmeritvijo na Stripe kupec zapomni, da caka VIP nakup: po vrnitvi (/app/tickets?placilo=uspeh) Tickets ponudi razdelitev.
   Samo zastavica v sessionStorage (ni obcutljivo); velja 2 h in samo za istega uporabnika. */
const KLJUC_CAKAJOCE_VIP = "outly_vip_cakajoce";
export function zapomniCakajocVip(uid, narocilo) {
  try { sessionStorage.setItem(KLJUC_CAKAJOCE_VIP, JSON.stringify({ uid, narocilo: narocilo ?? null, cas: Date.now() })); } catch { /* brez */ }
}
/** Prebere zastavico in jo pobrise. Vrne { narocilo } ali null. */
export function vzemiCakajocVip(uid) {
  try {
    const z = JSON.parse(sessionStorage.getItem(KLJUC_CAKAJOCE_VIP) || "null");
    sessionStorage.removeItem(KLJUC_CAKAJOCE_VIP);
    if (z && z.uid === uid && Date.now() - Number(z.cas) < 2 * 3600e3) return { narocilo: z.narocilo ?? null };
  } catch { /* brez */ }
  return null;
}

/** Starostna meja prenosa VIP vstopnice: max(min_age, 18 pri paketu pijace) - ista logika kot PrenosList / iOS PrenosStarosti.meja. */
export function mejaStarostiVip(v, minAgeDogodka = 0, spaketom = false) {
  const a = Number(v && v.min_age) > 0 ? Number(v.min_age) : Number(minAgeDogodka) > 0 ? Number(minAgeDogodka) : 0;
  const paket = spaketom || !!(v && (v.package_id != null || v.package_name || v.package_description));
  return Math.max(a, paket ? 18 : 0);
}

export function VipRazdeli({ vstopnice, meja: mejaZacetna = 0, zapri, obZaposlen = () => {}, povezavaVstopnice = true }) {
  const { prijatelji, napaka: napakaSeznama, znova } = usePrijatelji();
  // Vstopnice, ki so se vedno kupceve (po uspesnem prenosu odpadejo). Prva ostane kupcu.
  const [ostale, setOstale] = useState(() => (Array.isArray(vstopnice) ? vstopnice : []).filter(x => x && x.status !== "used" && x.status !== "void" && x.transferable !== false));
  const [poslani, setPoslani] = useState([]);   // [{ id, username }]
  const [izbrani, setIzbrani] = useState(() => new Set());
  const [faza, setFaza] = useState("izbira");   // izbira | rezultat
  const [neposlani, setNeposlani] = useState([]);   // [{ id, username, napaka }] (napaka "" = ni bilo poskusa)
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const teceRef = useRef(false);   // dva sinhrona klika: ref zapre vrata takoj (prenos je dokoncen, en zahtevek naenkrat)
  const [starostOk, setStarostOk] = useState(false);
  const [mejaStreznika, setMejaStreznika] = useState(0);   // min_age iz 400 age_confirmation_required
  const meja = Math.max(mejaZacetna, mejaStreznika);
  const najvec = Math.max(0, ostale.length - 1);

  async function poslji() {
    if (teceRef.current || !prijatelji || !izbrani.size) return;
    teceRef.current = true; setTece(true); obZaposlen(true); setNapaka("");
    const kandidati = prijatelji.filter(f => izbrani.has(f.id)).slice(0, najvec);
    const pool = ostale.slice(1);   // prva vstopnica ostane kupcu
    const potrjeno = meja > 0 && starostOk;
    const uspeli = [], neuspeli = [];
    const oddane = new Set();
    let ustavi = false, mejaNova = 0;
    for (const f of kandidati) {
      if (ustavi) { neuspeli.push({ id: f.id, username: f.username, napaka: "" }); continue; }
      const vst = pool.shift();
      if (!vst) { neuspeli.push({ id: f.id, username: f.username, napaka: t("No ticket left to send.") }); continue; }
      try {
        await send(`/tickets/${vst.id}/transfer`, { method: "POST", body: { user_id: f.id, age_confirmed: potrjeno }, auth: true });
        uspeli.push({ id: f.id, username: f.username }); oddane.add(vst.id);
      } catch (e) {
        pool.push(vst);   // vstopnica je se kupceva: naslednji prijatelj lahko dobi to ali drugo
        if (kodaNapake(e) === "age_confirmation_required") {
          try { const n = Number(JSON.parse(e.raw).min_age); if (n > 0) mejaNova = n; } catch { /* brez */ }
          neuspeli.push({ id: f.id, username: f.username, napaka: sporocilo(e) });
          ustavi = true;   // brez potrditve starosti tudi ostali ne bodo uspeli: pustimo ponoviti
        } else if (e instanceof ApiError && e.status === -1) {
          // Brez odgovora: prenos je morda dokoncan. Ne ponavljamo - kupec naj pogleda Tickets.
          neuspeli.push({ id: f.id, username: f.username, napaka: t("No response from the server. Check Profile → Tickets before you try again.") });
          ustavi = true;
        } else neuspeli.push({ id: f.id, username: f.username, napaka: sporocilo(e) });
      }
    }
    if (oddane.size) { setOstale(o => o.filter(x => !oddane.has(x.id))); setPoslani(p => [...p, ...uspeli]); }
    if (mejaNova) setMejaStreznika(mejaNova);
    setStarostOk(false);   // po neuspelem posiljanju potrditev ne velja vec
    setNeposlani(neuspeli);
    setIzbrani(new Set());
    setFaza(neuspeli.length || uspeli.length ? "rezultat" : "izbira");
    teceRef.current = false; setTece(false); obZaposlen(false);
  }

  const koncaj = () => zapri(poslani.length > 0);
  const povezava = povezavaVstopnice ? html`<a class="gumb-siv" href="/app/tickets">${t("Open my tickets")}</a>` : null;
  const poslaniIds = new Set(poslani.map(f => f.id));
  const imena = poslani.map(f => f.username).join(", ");

  /* ---- ni vec vstopnic za razdelitev ---- */
  if (faza === "izbira" && najvec < 1) {
    return html`<div class="vip-razdeli">
      ${poslani.length ? html`<p class="opomba srednje">${t("All your spare tickets are sent.")}</p>` : null}
      <button type="button" class="gumb-glavni" onClick=${koncaj}>${t("Done")}</button>
      ${povezava}
    </div>`;
  }

  /* ---- rezultat ---- */
  if (faza === "rezultat") {
    const vsiOk = !neposlani.length;
    const lahkoNaprej = neposlani.length > 0 && najvec > 0;
    return html`<div class="vip-razdeli">
      ${vsiOk ? html`<div class="uspeh"><span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("Sent to {name}", { name: imena })}</strong>
        <span class="utisano">${t("It will show up under Tickets in their app.")}</span></div>`
      : html`<h3 class="nastavitev-naslov">${t("Not everything was sent")}</h3>
        ${poslani.length ? html`<p class="opomba-okvir" role="status"><${Ikona} ime="check" velikost=${18} />${t("Sent to {name}", { name: imena })}</p>` : null}
        <div class="vip-neposlani" role="alert">
          ${neposlani.map(f => html`<div class="vrstica-napake" key=${f.id}>
            <strong>${f.username}</strong><span>${f.napaka || t("Not sent")}</span></div>`)}
        </div>
        <p class="opomba srednje">${t("Tickets that were not sent stay in your Tickets.")}</p>`}
      ${lahkoNaprej ? html`<button type="button" class="gumb-glavni" onClick=${() => { setIzbrani(new Set(neposlani.map(f => f.id).filter(id => !poslaniIds.has(id)).slice(0, najvec))); setNapaka(""); setFaza("izbira"); }}>${t("Try again")}</button>` : null}
      <button type="button" class=${lahkoNaprej ? "gumb-siv" : "gumb-glavni"} onClick=${koncaj}>${t("Done")}</button>
      ${povezava}
    </div>`;
  }

  /* ---- izbira ---- */
  const brezPrijateljev = Array.isArray(prijatelji) && !prijatelji.filter(f => !poslaniIds.has(f.id)).length;
  const prazno = html`<div class="prazno"><${Ikona} ime="users" velikost=${34} razred="modra" />
    <strong>${t("No friends yet")}</strong><span>${t("Add friends on Outly to send them tickets. Your tickets are in Tickets.")}</span>
    <a class="gumb-siv" href="/app/friends">${t("Add friends")}</a></div>`;
  const starostManjka = meja > 0 && !starostOk;
  return html`<div class="vip-razdeli">
    <h3 class="nastavitev-naslov">${t("Send tickets to friends")}</h3>
    <p class="opomba">${tn("Choose 1 friend to send a ticket to. You keep one ticket.", "Choose up to {n} friends. You keep one ticket.", najvec)}</p>
    <${IzbiraPrijateljev} prijatelji=${prijatelji} napaka=${napakaSeznama} znova=${znova}
      izkljuceni=${poslaniIds} najvec=${najvec} izbrani=${izbrani} spremeni=${s => { setIzbrani(s); setNapaka(""); }} onemogoceno=${tece}
      meja=${meja} starostOk=${starostOk} spremeniStarost=${setStarostOk} prazno=${prazno} />
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${brezPrijateljev ? html`<button type="button" class="gumb-glavni" onClick=${koncaj}>${t("Done")}</button>
      ${povezava}`
    : html`<button type="button" class="gumb-glavni" onClick=${poslji} disabled=${tece || !izbrani.size || starostManjka || !prijatelji}>
        ${tece ? t("Sending...") : napisPosiljanja(izbrani.size)}</button>
      <button type="button" class="gumb-siv" onClick=${koncaj} disabled=${tece}>${poslani.length ? t("Done") : t("Skip")}</button>
      ${povezava}`}
  </div>`;
}
