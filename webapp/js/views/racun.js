/* My Account in podzasloni (MyAccount/*.swift, PaymentView, HelpCenterView, AboutView).
   Vse spremembe profila gredo prek PATCH /me (streznik preveri pravila); geslo prek Supabase. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, useJezik, locale } from "../i18n.js";
import { send, naloziNaCloudinary, pomanjsajSliko } from "../api.js";
import { supabase } from "../supabase.js";
import { sporocilo, ApiError } from "../napake.js";
import { useSeja, nastaviMe, zdruzi, naloziMe, odjava } from "../seja.js";
import { navigiraj, usePot } from "../usmerjanje.js";
import * as P from "../podatki.js";
import { zanrIme, denar } from "../oblika.js";
import { useNastavitve, shraniNastavitve } from "../nastavitve.js";
import { GlavaNazaj, Ikona, Avatar, Nalaganje, Napaka, List } from "../ui.js";
import { Razpon } from "./filtri.js";
import { DRZAVE_SEZNAM } from "./onboarding.js";
import { CLANKI } from "../pomoc-clanki.js";

const Vrstica = ({ href, ikona, naslov, znacka, onClick, rdeca }) => {
  const vsebina = html`<${Ikona} ime=${ikona} /><span>${naslov}</span>
    ${znacka ? html`<span class="znacka-stevilo">${znacka}</span>` : null}
    ${onClick ? null : html`<${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />`}`;
  return href
    ? html`<a class=${"menijska-vrstica" + (rdeca ? " rdeca" : "")} href=${href}>${vsebina}</a>`
    : html`<button type="button" class=${"menijska-vrstica" + (rdeca ? " rdeca" : "")} onClick=${onClick}>${vsebina}</button>`;
};
export { Vrstica as MenijskaVrstica };

/* ---------------- My Account ---------------- */
export function MojRacun() {
  const me = useSeja(s => s.me);
  if (!me) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/profile" /><${Nalaganje} /></div>`;
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva="/app/profile" />
    <div class="profil-glava">
      <${Avatar} url=${me.avatar_url} ime=${me.username} velikost=${90} />
      <h1>${me.username}</h1>
    </div>
    <div class="seznam-kartica">
      <${Vrstica} href="/app/account/personal" ikona="user" naslov=${t("Personal info")} />
      <${Vrstica} href="/app/account/security" ikona="lock" naslov=${t("Password and security")} />
      <${Vrstica} href="/app/account/creator" ikona="trending-up" naslov=${t("Request for creator")} />
      <${Vrstica} href="/app/account/preferences" ikona="sliders-horizontal" naslov=${t("Preferences")} />
    </div>
    <div class="seznam-kartica">
      <${Vrstica} ikona="log-out" naslov=${t("Log out")} onClick=${async () => { await odjava(); navigiraj("/app", { zamenjaj: true }); }} />
      <${Vrstica} href="/app/account/delete" ikona="trash" naslov=${t("Delete account")} rdeca=${true} />
    </div>
  </div>`;
}

/* ---------------- Personal info ---------------- */
function KarticaPodatka({ ikona, naslov, vrednost, opis, uredi }) {
  return html`<div class="kartica-podatka">
    <div class="kp-vrh"><${Ikona} ime=${ikona} velikost=${18} /><strong>${naslov}</strong>
      ${uredi ? html`<button type="button" class="povezava-modra" onClick=${uredi} aria-label=${t("Edit") + " " + naslov}>${t("Edit")}</button>` : null}</div>
    <span class="kp-vrednost">${vrednost}</span>
    ${opis ? html`<span class="opomba">${opis}</span>` : null}
  </div>`;
}

export function OsebniPodatki() {
  const me = useSeja(s => s.me);
  useJezik();
  const [urejam, setUrejam] = useState(null);   // "username" | "phone" | "dob" | "country"
  const [vrednost, setVrednost] = useState("");
  const [napaka, setNapaka] = useState("");
  const [shranjujem, setShranjujem] = useState(false);
  const [nalagam, setNalagam] = useState(false);
  const [napakaSlike, setNapakaSlike] = useState("");
  const vnosSlike = useRef(null);
  useEffect(() => { naloziMe(); }, []);
  if (!me) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/account" /><${Nalaganje} /></div>`;

  const dob = me.date_of_birth ? String(me.date_of_birth).slice(0, 10) : "";
  const imeDrzave = k => { try { return new Intl.DisplayNames([locale()], { type: "region" }).of(k); } catch { return k; } };
  const odpri = polje => {
    setNapaka("");
    setVrednost(polje === "username" ? me.username : polje === "phone" ? (me.phone || "") : polje === "dob" ? dob : (me.country || "SI"));
    setUrejam(polje);
  };

  async function shrani() {
    setNapaka("");
    const body = {};
    if (urejam === "username") {
      const u = vrednost.trim();
      if (u.length < 3) return setNapaka(t("Username must be at least 3 characters."));
      if (u.length > 20) return setNapaka(t("Username can have at most 20 characters."));
      if (!/^[A-Za-z0-9_]+$/.test(u)) return setNapaka(t("Username can contain only letters, numbers and underscore."));
      body.username = u;
    } else if (urejam === "phone") {
      const tel = vrednost.replace(/[\s\-()]/g, "");
      if (!tel) body.phone = null;
      else if (!/^\+[1-9]\d{7,14}$/.test(tel)) return setNapaka(t("Enter the phone number with country code, e.g. +386 41 123 456."));
      else body.phone = tel;
    } else if (urejam === "dob") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vrednost)) return setNapaka(t("Enter a valid date of birth."));
      body.dateOfBirth = vrednost;
    } else body.country = vrednost;
    setShranjujem(true);
    try { nastaviMe(zdruzi(await send("/me", { method: "PATCH", body, auth: true }))); setUrejam(null); }
    catch (e) { setNapaka(sporocilo(e)); }
    setShranjujem(false);
  }

  async function izberiSliko(ev) {
    const d = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!d) return;
    if (!/^image\//.test(d.type)) return setNapakaSlike(t("Choose an image file."));
    setNalagam(true); setNapakaSlike("");
    try {
      const url = await naloziNaCloudinary(await pomanjsajSliko(d, 800));
      await send("/me/avatar", { method: "PATCH", body: { avatarUrl: url }, auth: true });
      await naloziMe();   // PATCH /me/avatar vrne okrnjen profil - kot iOS preberemo celega
    } catch (e) { setNapakaSlike(sporocilo(e)); }
    setNalagam(false);
  }

  const naslovi = { username: t("Username"), phone: t("Phone number"), dob: t("Date of birth"), country: t("Country") };
  const danes = new Date();
  const najvec = new Date(danes.getFullYear() - 15, danes.getMonth(), danes.getDate()).toISOString().slice(0, 10);
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Personal info")} rezerva="/app/account" />
    <div class="kartica-avatar">
      <button type="button" class="avatar-gumb" onClick=${() => vnosSlike.current && vnosSlike.current.click()} disabled=${nalagam} aria-label=${t("Change profile photo")}>
        <${Avatar} url=${me.avatar_url} ime=${me.username} velikost=${96} />
        <span class="avatar-plus"><${Ikona} ime="plus" velikost=${14} debelina=${3} /></span>
      </button>
      <input ref=${vnosSlike} type="file" accept="image/*" class="skrito" onChange=${izberiSliko} tabindex="-1" aria-hidden="true" />
      <span class="opomba srednje">${nalagam ? t("Uploading...") : t("Add a profile photo so friends can recognise you")}</span>
      ${napakaSlike ? html`<span class="napaka-besedilo">${napakaSlike}</span>` : null}
    </div>
    <${KarticaPodatka} ikona="user" naslov=${t("Username")} vrednost=${me.username}
      opis=${t("This is your display name shown on your profile and used when managing events or teams.")} uredi=${() => odpri("username")} />
    <${KarticaPodatka} ikona="phone" naslov=${t("Phone number")} vrednost=${me.phone || t("Not set")}
      opis=${t("Optional. Used for account recovery and important notifications. Include the country code, e.g. +386.")} uredi=${() => odpri("phone")} />
    <${KarticaPodatka} ikona="mail" naslov=${t("Email")} vrednost=${me.email}
      opis=${t("Your email is used for login and important notifications. To change it, contact luka@outly.si.")} />
    <${KarticaPodatka} ikona="calendar" naslov=${t("Date of birth")}
      vrednost=${dob ? new Intl.DateTimeFormat(locale(), { dateStyle: "long" }).format(new Date(dob + "T00:00:00")) : t("Not set")}
      opis=${t("Used to hide events you are too young for. This is not an age verification — that happens at the door.")} uredi=${() => odpri("dob")} />
    <${KarticaPodatka} ikona="globe" naslov=${t("Country")} vrednost=${me.country ? imeDrzave(me.country) : t("Not set")}
      opis=${t("Your home country.")} uredi=${() => odpri("country")} />

    <${List} odprt=${!!urejam} zapri=${() => setUrejam(null)} naslov=${urejam ? naslovi[urejam] : ""}>
      ${urejam === "username" ? html`<label class="polje"><span class="skrito">${t("Username")}</span>
          <input value=${vrednost} onInput=${e => setVrednost(e.target.value)} maxlength="20" autocapitalize="off" spellcheck="false" autocomplete="username" /></label>
          <span class="opomba">${t("3–20 characters: letters, numbers, underscore.")}</span>` : null}
      ${urejam === "phone" ? html`<label class="polje"><span class="skrito">${t("Phone number")}</span>
          <input type="tel" value=${vrednost} placeholder="+386 41 123 456" onInput=${e => setVrednost(e.target.value)} autocomplete="tel" /></label>
          <span class="opomba">${t("Leave empty to remove the number.")}</span>` : null}
      ${urejam === "dob" ? html`<label class="polje-oznaceno"><span class="skrito">${t("Date of birth")}</span>
          <input type="date" value=${vrednost} max=${najvec} min="1900-01-01" onInput=${e => setVrednost(e.target.value)} /></label>` : null}
      ${urejam === "country" ? html`<label class="polje-oznaceno"><span class="skrito">${t("Country")}</span>
          <select value=${vrednost} onChange=${e => setVrednost(e.target.value)}>${DRZAVE_SEZNAM().map(d => html`<option value=${d.k}>${d.ime}</option>`)}</select></label>` : null}
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button type="button" class="gumb-glavni" onClick=${shrani} disabled=${shranjujem}>${shranjujem ? t("Saving...") : t("Save")}</button>
    <//>
  </div>`;
}

/* ---------------- Password and security ---------------- */
export function GesloVarnost() {
  const me = useSeja(s => s.me);
  const [p, setP] = useState({ trenutno: "", novo: "", potrdi: "" });
  const [sporocilo_, setSporocilo] = useState({ besedilo: "", ok: false });
  const [tece, setTece] = useState(false);
  const [potrdiOdjavo, setPotrdiOdjavo] = useState(false);
  const nastavi = k => e => setP(s => ({ ...s, [k]: e.target.value }));

  async function spremeni(ev) {
    ev.preventDefault();
    if (p.novo.length < 8) return setSporocilo({ besedilo: t("Password must be at least 8 characters.") });
    if (p.novo !== p.potrdi) return setSporocilo({ besedilo: t("New passwords do not match.") });
    if (p.novo === p.trenutno) return setSporocilo({ besedilo: t("New password must be different from the current one.") });
    if (!me || !me.email || tece) return;
    setTece(true); setSporocilo({ besedilo: "" });
    try {
      // Kot iOS: najprej preveri trenutno geslo (ponovna prijava), nato zamenjaj.
      const prijava = await supabase.auth.signInWithPassword({ email: me.email, password: p.trenutno });
      if (prijava.error) return setSporocilo({ besedilo: prijava.error.code === "invalid_credentials" ? t("Current password is wrong.") : sporocilo(prijava.error) });
      const r = await supabase.auth.updateUser({ password: p.novo });
      if (r.error) return setSporocilo({ besedilo: sporocilo(r.error) });
      setP({ trenutno: "", novo: "", potrdi: "" });
      setSporocilo({ besedilo: t("Password changed."), ok: true });
    } catch (e) { setSporocilo({ besedilo: sporocilo(e) }); }
    finally { setTece(false); }
  }

  const [napakaOdjave, setNapakaOdjave] = useState("");
  async function odjaviPovsod() {
    setNapakaOdjave("");
    // Ce streznik odjave drugih naprav ne potrdi (omrezje), tega ne skrijemo - uporabnik poskusi znova.
    let r;
    try { r = await supabase.auth.signOut({ scope: "global" }); } catch (e) { r = { error: e }; }
    if (r && r.error) { setPotrdiOdjavo(false); setNapakaOdjave(sporocilo(r.error)); return; }
    await odjava();
    navigiraj("/app/login", { zamenjaj: true });
  }

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Password and security")} rezerva="/app/account" />
    <form class="obrazec" onSubmit=${spremeni} novalidate>
      <h2 class="podnaslov">${t("Change password")}</h2>
      <input type="email" class="skrito" autocomplete="username" value=${me ? me.email : ""} readonly tabindex="-1" aria-hidden="true" />
      <label class="polje"><span class="skrito">${t("Current password")}</span><input type="password" placeholder=${t("Current password")} value=${p.trenutno} onInput=${nastavi("trenutno")} autocomplete="current-password" /></label>
      <label class="polje"><span class="skrito">${t("new password")}</span><input type="password" placeholder=${t("new password")} value=${p.novo} onInput=${nastavi("novo")} autocomplete="new-password" /></label>
      <label class="polje"><span class="skrito">${t("confirm password")}</span><input type="password" placeholder=${t("confirm password")} value=${p.potrdi} onInput=${nastavi("potrdi")} autocomplete="new-password" /></label>
      ${sporocilo_.besedilo ? html`<p class=${sporocilo_.ok ? "uspeh-besedilo" : "napaka-besedilo"} role="status">${sporocilo_.besedilo}</p>` : null}
      <button type="submit" class="gumb-glavni" disabled=${tece || !p.trenutno || p.novo.length < 8 || !p.potrdi}>${tece ? t("Saving...") : t("Change password")}</button>
    </form>
    <div class="seznam-kartica">
      <${Vrstica} ikona="log-out" naslov=${t("Sign out everywhere")} onClick=${() => setPotrdiOdjavo(true)} rdeca=${true} />
    </div>
    ${napakaOdjave ? html`<p class="napaka-besedilo" role="alert">${napakaOdjave}</p>` : null}
    <${List} odprt=${potrdiOdjavo} zapri=${() => setPotrdiOdjavo(false)} naslov=${t("Sign out everywhere")}>
      <p class="besedilo-opis">${t("You will be signed out on this device too.")}</p>
      <button type="button" class="gumb-rdec" onClick=${odjaviPovsod}>${t("Sign out everywhere")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setPotrdiOdjavo(false)}>${t("Cancel")}</button>
    <//>
  </div>`;
}

/* ---------------- Preferences (+ My preferences, lokalno) ---------------- */
export function Nastavitve() {
  const me = useSeja(s => s.me);
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const deli = me ? me.share_plans_with_friends !== false : true;
  async function preklopi() {
    setTece(true); setNapaka("");
    try { nastaviMe(zdruzi(await send("/me", { method: "PATCH", body: { share_plans_with_friends: !deli }, auth: true }))); }
    catch (e) { setNapaka(sporocilo(e)); }
    setTece(false);
  }
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Preferences")} rezerva="/app/account" />
    <h2 class="nastavitev-naslov">${t("Friends")}</h2>
    <label class="stikalo-vrstica">
      <span class="kv-besedilo"><strong>${t("Share my plans with friends")}</strong>
        <span class="vec-vrstic">${t("When on, your friends see which events you have a ticket for under “Your friends' plans”. Only friends, never anyone else.")}</span></span>
      <input type="checkbox" role="switch" class="stikalo" checked=${deli} disabled=${tece || !me} onChange=${preklopi} />
    </label>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <div class="seznam-kartica">
      <${Vrstica} href="/app/account/my-preferences" ikona="sliders-horizontal" naslov=${t("My preferences")} />
      <${Vrstica} href="/app/language" ikona="globe" naslov=${t("Language")} />
    </div>
    <p class="opomba">${t("My preferences are used by “Use my preferences” in Filters.")}</p>
  </div>`;
}

export function MojeNastavitve() {
  const n = useNastavitve();
  const [zanri, setZanri] = useState([]);
  useEffect(() => { P.zanri().then(setZanri).catch(() => {}); }, []);
  const preklopi = g => shraniNastavitve({ genres: n.genres.includes(g) ? n.genres.filter(x => x !== g) : [...n.genres, g] });
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("My preferences")} rezerva="/app/account/preferences" />
    <p class="opomba">${t("Saved on this device. Turn on “Use my preferences” in Filters to apply them.")}</p>
    <div class="nastavitev"><span class="nastavitev-naslov">${t("Music genres")}</span>
      <div class="mreza-cipov">${zanri.map(g => html`<button type="button" class=${"cip" + (n.genres.includes(g) ? " izbran" : "")}
        aria-pressed=${n.genres.includes(g)} onClick=${() => preklopi(g)}>${zanrIme(g)}</button>`)}</div></div>
    <div class="nastavitev"><span class="nastavitev-naslov">${t("Distance")}</span>
      <${Razpon} od=${0} do=${100} korak=${1} spodaj=${0} zgoraj=${n.maxKm} samoZgoraj=${true}
        napis=${v => `${v} km`} ob=${(a, b) => shraniNastavitve({ maxKm: b })} ime=${t("Distance")} /></div>
    <div class="nastavitev"><span class="nastavitev-naslov">${t("Age range")}</span>
      <${Razpon} od=${16} do=${60} korak=${1} spodaj=${n.ageMin} zgoraj=${n.ageMax}
        napis=${v => `${v}`} ob=${(a, b) => shraniNastavitve({ ageMin: a, ageMax: b })} ime=${t("Age range")} /></div>
    <div class="nastavitev"><span class="nastavitev-naslov">${t("Entry price")}</span>
      <${Razpon} od=${0} do=${100} korak=${1} spodaj=${n.priceMin / 100} zgoraj=${n.priceMax / 100}
        napis=${v => denar(v * 100)} ob=${(a, b) => shraniNastavitve({ priceMin: a * 100, priceMax: b * 100 })} ime=${t("Entry price")} /></div>
  </div>`;
}

/* ---------------- Delete account ---------------- */
export function IzbrisRacuna() {
  const [geslo, setGeslo] = useState("");
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const [potrdi, setPotrdi] = useState(false);
  async function izbrisi() {
    setPotrdi(false);
    if (!geslo) return setNapaka(t("Enter your password to continue."));
    setTece(true); setNapaka("");
    try {
      await send("/me", { method: "DELETE", body: { password: geslo }, auth: true });
      await odjava();
      navigiraj("/app", { zamenjaj: true });
    } catch (e) {
      // 401 tu pomeni napacno geslo (streznik: "Invalid credentials."), ne potekle seje.
      setNapaka(e instanceof ApiError && e.status === 401 && /credentials/i.test(e.raw) ? t("Wrong password.")
        : e instanceof ApiError && e.status === -1 ? t("No response from the server. Log in again to check whether the account still exists.")
        : sporocilo(e));
    }
    setTece(false);
  }
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Delete account")} rezerva="/app/account" />
    <p class="besedilo-opis">${t("This action is permanent. It will remove your account, liked events and personal data. Tickets you have already bought stay valid, but they will no longer be linked to you and cannot be recovered in the app.")}</p>
    <label class="polje"><span class="skrito">${t("password")}</span>
      <input type="password" placeholder=${t("Enter your password to confirm.")} value=${geslo} onInput=${e => setGeslo(e.target.value)} autocomplete="current-password" /></label>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-rdec" onClick=${() => setPotrdi(true)} disabled=${tece || !geslo}>${tece ? t("Deleting...") : t("Delete account")}</button>
    <${List} odprt=${potrdi} zapri=${() => setPotrdi(false)} naslov=${t("Delete account")}>
      <p class="besedilo-opis">${t("We're sorry to see you go! This is permanent: your account and personal data will be removed, and tickets you bought will no longer be linked to you.")}</p>
      <button type="button" class="gumb-rdec" onClick=${izbrisi}>${t("Delete Account")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setPotrdi(false)}>${t("Cancel")}</button>
    <//>
  </div>`;
}

/* ---------------- Request for creator (poslovni racun) ---------------- */
const PRAZEN_OBRAZEC = { businessName: "", businessType: "", businessAddress: "", city: "", licenceId: "", contactName: "", contactRole: "", phone: "", message: "" };
export function ProsnjaUstvarjalca() {
  const me = useSeja(s => s.me);
  const [prosnje, setProsnje] = useState(null);
  const [napaka, setNapaka] = useState("");
  const [o, setO] = useState(PRAZEN_OBRAZEC);
  const [tece, setTece] = useState(false);
  const [poslano, setPoslano] = useState(false);
  const nalozi = () => send("/creator-applications/me", { auth: true }).then(r => setProsnje(Array.isArray(r) ? r : [])).catch(e => { setProsnje([]); setNapaka(sporocilo(e)); });
  useEffect(() => { nalozi(); }, []);
  const nastavi = k => e => setO(s => ({ ...s, [k]: e.target.value }));

  async function poslji(ev) {
    ev.preventDefault();
    if (o.businessName.trim().length < 2) return setNapaka(t("Enter the business name (at least 2 characters)."));
    if (!o.contactName.trim()) return setNapaka(t("Enter the contact person's name."));
    setTece(true); setNapaka("");
    try {
      const body = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()]));
      await send("/creator-applications", { method: "POST", body, auth: true });
      setPoslano(true); setO(PRAZEN_OBRAZEC); nalozi();
    } catch (e) { setNapaka(sporocilo(e)); }
    setTece(false);
  }

  const cakajoca = prosnje && prosnje.find(p => p.status === "new");
  const odobrena = prosnje && prosnje.find(p => p.status === "approved");
  const zavrnjena = prosnje && prosnje.find(p => p.status === "rejected");
  const polje = (k, oznaka, vec = {}) => html`<label class="polje"><span class="skrito">${oznaka}</span>
    <input value=${o[k]} placeholder=${oznaka} onInput=${nastavi(k)} ...${vec} /></label>`;

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Request a Business Account")} rezerva="/app/account" />
    <h2 class="podnaslov">${t("Partner with Outly and reach more nightlife lovers")}</h2>
    <p class="besedilo-opis">${t("Join our platform and promote your club, bar, or event to thousands of tourists and locals. With a business account, you can publish events, sell tickets directly through the app, and connect with your audience in real time.")}</p>
    ${prosnje === null ? html`<${Nalaganje} />`
      : (me && me.role === "business") || odobrena ? html`<div class="kartica-info"><strong>${odobrena ? odobrena.business_name : t("Business account")}</strong>
          <span class="utisano">${t("Your application was approved. Log out and log in again to switch to your business account.")}</span></div>`
      : cakajoca ? html`<div class="kartica-info"><strong>${cakajoca.business_name}</strong>
          <span class="utisano">${t("We are reviewing your application. You will get an email when it is approved.")}</span></div>`
      : html`
        ${zavrnjena ? html`<p class="opomba">${zavrnjena.decision_note
          ? t("Your previous application for \"{name}\" was not approved: {note} You can apply again.", { name: zavrnjena.business_name, note: zavrnjena.decision_note })
          : t("Your previous application for \"{name}\" was not approved. You can apply again.", { name: zavrnjena.business_name })}</p>` : null}
        ${poslano ? html`<p class="uspeh-besedilo" role="status">${t("Thanks! We will review it and email you when it is approved.")}</p>` : null}
        <form class="obrazec" onSubmit=${poslji} novalidate>
          <h3 class="nastavitev-naslov">${t("Application form")}</h3>
          ${polje("businessName", t("Legal business name *"), { maxlength: 120 })}
          ${polje("businessType", t("Business type (club, bar, promoter…)"))}
          ${polje("businessAddress", t("Business address"))}
          ${polje("city", t("City"))}
          ${polje("licenceId", t("Business licence / registration ID"))}
          ${polje("contactName", t("Full name *"), { autocomplete: "name" })}
          ${polje("contactRole", t("Role / position"))}
          ${polje("phone", t("Phone number, e.g. +386 41 123 456"), { type: "tel", autocomplete: "tel" })}
          <label class="polje"><span class="skrito">${t("Message (optional)")}</span>
            <textarea rows="3" value=${o.message} placeholder=${t("Message (optional)")} onInput=${nastavi("message")} maxlength="2000"></textarea></label>
          ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
          <button type="submit" class="gumb-glavni" disabled=${tece}>${tece ? t("Sending...") : t("Send application")}</button>
          <p class="opomba">${t("We will reply to {email}.", { email: me ? me.email : "" })} ${t("By submitting you agree to our Terms and Privacy Policy. Your data is used only to review this application.")}</p>
        </form>`}
  </div>`;
}

/* ---------------- Payment, Help, About ---------------- */
export function Placila() {
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Payment")} rezerva="/app/profile" />
    <div class="kartica-info"><${Ikona} ime="lock" velikost=${22} razred="modra" /><strong>${t("Secure checkout")}</strong>
      <span class="utisano">${t("Tickets are paid at checkout. Payments are processed by Stripe; Outly never sees or stores your card details, and the app does not hold a balance.")}</span></div>
  </div>`;
}

const clanek = (a, sl) => ({ id: a.id, topic: (sl && a.sl.topic) || a.topic, title: (sl && a.sl.title) || a.title, body: (sl && a.sl.body) || a.body });

export function Pomoc() {
  const sl = useJezik() === "sl";
  const [q, setQ] = useState("");
  const vsi = CLANKI.map(a => clanek(a, sl));
  const iskano = q.trim().toLowerCase();
  const najdeni = iskano ? vsi.filter(a => (a.title + " " + a.topic + " " + a.body).toLowerCase().includes(iskano)) : vsi;
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Help Center")} rezerva="/app/profile" />
    <h2 class="podnaslov srednje">${t("Hi, how can we help?")}</h2>
    <div class="iskalno-polje"><${Ikona} ime="search" velikost=${18} razred="utisano" />
      <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder=${t("Search help")} aria-label=${t("Search help")} /></div>
    <h2 class="podnaslov">${iskano ? t("Results") : t("Popular articles")}</h2>
    ${!najdeni.length ? html`<p class="utisano">${t("Nothing found. Try another word or contact us below.")}</p>` : null}
    <div class="seznam-clankov">${najdeni.map(a => html`<a class="kartica-clanka" href=${"/app/help/" + a.id}><span class="opomba">${a.topic}</span><strong>${a.title}</strong></a>`)}</div>
    <h2 class="podnaslov">${t("Still need help?")}</h2>
    <a class="kartica-vrstica kontakt" href="mailto:luka@outly.si?subject=Outly%20support">
      <${Ikona} ime="mail" velikost=${20} razred="modra" />
      <span class="kv-besedilo"><strong>${t("Contact us")}</strong><span>${t("luka@outly.si — we usually reply within a day.")}</span></span>
    </a>
  </div>`;
}

export function ClanekPomoci({ id }) {
  const sl = useJezik() === "sl";
  const a = CLANKI.find(x => x.id === id);
  if (!a) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/help" /><p class="utisano">${t("Not found.")}</p></div>`;
  const c = clanek(a, sl);
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva="/app/help" />
    <span class="opomba">${c.topic}</span>
    <h1 class="velik-naslov">${c.title}</h1>
    ${c.body.split(/\n\n+/).map((p, i) => html`<p key=${i} class="besedilo-opis">${p}</p>`)}
  </div>`;
}

export function OAplikaciji() {
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("About")} rezerva="/app/profile" />
    <img class="avt-logo" src="/assets/transperent-logo.png" alt="Outly" width="220" height="220" />
    <p class="besedilo-opis srednje">${t("Outly helps you find where to go tonight: clubs, events and tickets.")}</p>
    <div class="seznam-kartica">
      <a class="menijska-vrstica" href="/terms" target="_blank" rel="noopener"><${Ikona} ime="link" /><span>${t("Terms of Service")}</span></a>
      <a class="menijska-vrstica" href="/privacy-app" target="_blank" rel="noopener"><${Ikona} ime="lock" /><span>${t("Privacy Policy")}</span></a>
      <a class="menijska-vrstica" href="mailto:luka@outly.si"><${Ikona} ime="mail" /><span>${t("Contact us")}</span></a>
    </div>
    <p class="opomba srednje vec-vrstic">${t("NEXT DIMENSIONS, družba za marketing, d.o.o.\nTrebče 81, 3256 Bistrica ob Sotli, Slovenia")}</p>
  </div>`;
}
