/* Dokoncanje racuna (CompleteAccountView + SelectGenresView): datum rojstva (15+), drzava, telefon
   (neobvezen), nato zanri. Streznik nastavi onboarded_at, ko ima datum rojstva in vsaj en zanr. */
import { html, useEffect, useState } from "../lib.js";
import { t, locale } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo, ApiError } from "../napake.js";
import { useSeja, nastaviMe, zdruzi, odjava, potrebujeOnboarding } from "../seja.js";
import { navigiraj, usePot } from "../usmerjanje.js";
import * as P from "../podatki.js";
import { zanrIme } from "../oblika.js";
import { naslednja } from "./prijava.js";

const DRZAVE = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD " +
  "GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM " +
  "KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA " +
  "NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ " +
  "SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU " +
  "WF WS XK YE YT ZA ZM ZW").split(" ");

export function seznamDrzav() {
  let imena;
  try { imena = new Intl.DisplayNames([locale()], { type: "region" }); } catch { imena = null; }
  return DRZAVE.map(k => ({ k, ime: (imena && imena.of(k)) || k })).sort((a, b) => a.ime.localeCompare(b.ime, locale()));
}

function starost(iso) {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const z = new Date();
  let l = z.getFullYear() - d.getFullYear();
  if (z.getMonth() < d.getMonth() || (z.getMonth() === d.getMonth() && z.getDate() < d.getDate())) l -= 1;
  return l;
}

async function shrani(body) {
  try { return await send("/me", { method: "PATCH", body, auth: true }); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401) { await odjava("Your session has expired. Please log in again."); navigiraj("/app/login", { zamenjaj: true }); return null; }
    throw e;
  }
}

export function Onboarding() {
  const me = useSeja(s => s.me);
  const pot = usePot();
  const [korak, setKorak] = useState(me && me.date_of_birth ? "zanri" : "racun");
  useEffect(() => {
    // Ko je onboarding koncan (streznik je nastavil onboarded_at), naprej na zeleni zaslon.
    if (me && !potrebujeOnboarding(me)) navigiraj(naslednja(pot), { zamenjaj: true });
  }, [me]);
  return korak === "racun" ? html`<${Racun} naprej=${() => setKorak("zanri")} />` : html`<${Zanri} nazaj=${() => setKorak("racun")} />`;
}

function Racun({ naprej }) {
  const me = useSeja(s => s.me);
  const [dob, setDob] = useState((me && me.date_of_birth ? String(me.date_of_birth).slice(0, 10) : ""));
  const [drzava, setDrzava] = useState((me && me.country) || "SI");
  const [tel, setTel] = useState((me && me.phone) || "");
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const danes = new Date();
  const najvec = new Date(danes.getFullYear() - 15, danes.getMonth(), danes.getDate()).toISOString().slice(0, 10);

  async function poslji(ev) {
    ev.preventDefault();
    const l = dob ? starost(dob) : null;
    if (l == null) return setNapaka(t("Enter a valid date of birth."));
    if (l < 15) return setNapaka(t("You must be at least 15 years old to use Outly."));
    if (l > 120) return setNapaka(t("That date of birth does not look right."));
    const telefon = tel.replace(/[\s\-()]/g, "");
    if (telefon && !/^\+[1-9]\d{7,14}$/.test(telefon)) return setNapaka(t("Enter the phone number with country code, e.g. +386 41 123 456."));
    setTece(true); setNapaka("");
    try {
      const body = { dateOfBirth: dob, country: drzava };
      if (telefon) body.phone = telefon;
      const novi = await shrani(body);
      if (novi) { nastaviMe(zdruzi(novi)); naprej(); }
    } catch (e) { setNapaka(sporocilo(e)); }
    setTece(false);
  }

  return html`<div class="zaslon avtentikacija">
    <form class="kartica-obrazec" onSubmit=${poslji} novalidate>
      <h1 class="avt-naslov levo">${t("Complete your account")}</h1>
      <p class="utisano">${t("We need a few details to show you the right events.")}</p>
      <label class="polje-oznaceno"><span>${t("Date of birth")}</span>
        <input type="date" value=${dob} max=${najvec} min="1900-01-01" onInput=${e => setDob(e.target.value)} required autocomplete="bday" />
      </label>
      <label class="polje-oznaceno"><span>${t("Country")}</span>
        <select value=${drzava} onChange=${e => setDrzava(e.target.value)} autocomplete="country">
          ${seznamDrzav().map(d => html`<option value=${d.k}>${d.ime}</option>`)}
        </select>
      </label>
      <label class="polje-oznaceno"><span>${t("Phone (optional)")}</span>
        <input type="tel" value=${tel} placeholder="+386 41 123 456" onInput=${e => setTel(e.target.value)} autocomplete="tel" inputmode="tel" />
      </label>
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Saving...") : t("Continue")}</button>
      <button class="povezava-gumb" type="button" onClick=${() => odjava()}>${t("Log out")}</button>
    </form>
  </div>`;
}

function Zanri({ nazaj }) {
  const me = useSeja(s => s.me);
  const [vsi, setVsi] = useState([]);
  const [izbrani, setIzbrani] = useState(new Set((me && me.genres) || []));
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const nalozi = () => P.zanri().then(setVsi).catch(e => setNapaka(sporocilo(e)));
  useEffect(() => { nalozi(); }, []);
  const preklopi = g => setIzbrani(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });

  async function koncaj() {
    if (!izbrani.size) return setNapaka(t("Select at least one genre."));
    setTece(true); setNapaka("");
    try {
      const novi = await shrani({ genres: vsi.filter(g => izbrani.has(g)) });   // vrstni red streznika
      if (novi) {
        nastaviMe(zdruzi(novi));
        if (!novi.onboarded_at) setNapaka(t("Please fill in your date of birth on the previous step."));
      }
    } catch (e) { setNapaka(sporocilo(e)); }
    setTece(false);
  }

  return html`<div class="zaslon avtentikacija">
    <div class="kartica-obrazec">
      <h1 class="avt-naslov levo">${t("Select your genre")}</h1>
      ${!vsi.length && napaka ? html`<button class="povezava-gumb" type="button" onClick=${nalozi}>${t("Try again")}</button>` : null}
      <div class="mreza-cipov tri">
        ${vsi.map(g => html`<button type="button" class=${"cip" + (izbrani.has(g) ? " izbran" : "")} aria-pressed=${izbrani.has(g)} onClick=${() => preklopi(g)}>${zanrIme(g)}</button>`)}
      </div>
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button class="gumb-glavni" type="button" onClick=${koncaj} disabled=${tece || !izbrani.size}>${tece ? t("Saving...") : t("Complete")}</button>
      <button class="povezava-gumb" type="button" onClick=${nazaj}>${t("Back")}</button>
    </div>
  </div>`;
}

export const DRZAVE_SEZNAM = seznamDrzav;
