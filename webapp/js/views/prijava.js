/* Prijava, registracija, potrditev e-naslova s kodo, pozabljeno geslo (Auth/*.swift).
   Isti tok kot iOS: koda iz maila (6-10 stevk), ne povezava - zato spletna aplikacija ne rabi
   dodatnih preusmeritvenih URL-jev v Supabase. Povezava v mailu lahko vodi na /app/verify oz. /app/forgot
   s ?token_hash=...&type=... (predloga v Supabase): potrdi se sele ob kliku na gumb, ne ob odprtju strani.
   Registracija: kljukica 18+ in pogoji (kot outly.si). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { supabase } from "../supabase.js";
import { sporocilo } from "../napake.js";
import { seja, useSeja, naloziMe, KLJUC_CAKAJOCI_MAIL as KLJUC_MAIL, pozabiCakajociMail } from "../seja.js";
import { navigiraj, usePot } from "../usmerjanje.js";
import { lokalno } from "../store.js";
import { GlavaNazaj, Ikona } from "../ui.js";
import { JezikGumb } from "./jezik.js";
import { TERMS_VERSION, EMAIL_RE } from "../pogoji.js";   // verzija pogojev kot auth.js na outly.si (terms.html)

const USER_RE = /^[A-Za-z0-9_]{3,20}$/;   // enako kot backend PATCH /me

/* Geslo iz registracije (ali prijave z nepotrjenim naslovom) ostane SAMO v pomnilniku zavihka, nikoli v localStorage
   (XSS), dokler naslov ni potrjen - kot iOS CakajocaPotrditev. Zakaj: Gmail (Googlovi strezniki) sam odpre povezavo
   v potrditvenem mailu in s tem porabi enkratno potrditev; racun je potrjen, koda pa vrne otp_expired in nov mail se
   za potrjen racun ne poslje (Supabase dnevnik 23. 10. 2026). Tiha prijava s tem geslom uporabnika spusti naprej. */
let cakajoce = null;   // { email, geslo }
const pozabiGeslo = () => { cakajoce = null; };
const gesloZa = email => (cakajoce && cakajoce.email === email ? cakajoce.geslo : null);
let tihaPrijavaTece = null;   // obljuba: vzporedni klici (vrnitev v zavihek + gumb) pocakajo isto prijavo

/* Enkratni zeton iz povezave v mailu (?token_hash=...&type=...). Povezava naj vodi sem, ne na Supabase /verify:
   stran samo pokaze gumb in potrdi sele ob kliku, zato je Googlov pregled povezave ne porabi. */
function zetonPovezave(pot, tipi) {
  const zeton = pot.iskanje.get("token_hash") || "";
  const tip = pot.iskanje.get("type") || "";
  return zeton && tipi.includes(tip) ? { token_hash: zeton, type: tip } : null;
}

/* Kam po prijavi: ?next=/app/... (samo poti znotraj aplikacije). */
export function naslednja(pot) {
  const n = pot.iskanje.get("next") || "";
  return n.startsWith("/app") && !n.startsWith("//") ? n : "/app";
}
const zNaslednjo = (pot, osnova) => {
  const n = pot.iskanje.get("next");
  return n ? `${osnova}?next=${encodeURIComponent(n)}` : osnova;
};

function refKoda() {
  try { const r = (localStorage.getItem("outly_ref") || "").toUpperCase(); return /^[A-Z0-9]{4,12}$/.test(r) ? r : null; }
  catch { return null; }
}

function Okvir({ naslov, podnaslov, children }) {
  return html`<div class="zaslon avtentikacija">
    <div class="avt-vrh"><${GlavaNazaj} /><${JezikGumb} /></div>
    <img class="avt-logo" src="/assets/transperent-logo.png" alt="Outly" width="220" height="220" />
    <h1 class="avt-naslov">${naslov}</h1>
    ${podnaslov ? html`<p class="avt-podnaslov">${podnaslov}</p>` : null}
    ${children}
  </div>`;
}

function Pogoji() {
  return html`<p class="avt-pravno">${t("By clicking continue, you agree to our")}
    <a href="/terms" target="_blank" rel="noopener">${t("Terms of Service")}</a> ${t("and")}
    <a href="/privacy-app" target="_blank" rel="noopener">${t("Privacy Policy")}</a></p>`;
}

function Polje({ tip = "text", ime, oznaka, vrednost, ob, samodejno, vec = {} }) {
  const [vidno, setVidno] = useState(false);
  const geslo = tip === "password";
  return html`<label class="polje">
    <span class="skrito">${oznaka}</span>
    <input type=${geslo && vidno ? "text" : tip} name=${ime} value=${vrednost} placeholder=${oznaka}
      onInput=${e => ob(e.target.value)} autocomplete=${samodejno} ...${vec} />
    ${geslo ? html`<button type="button" class="polje-oko" onClick=${() => setVidno(!vidno)} aria-label=${vidno ? t("Hide password") : t("Show password")}>
      <${Ikona} ime=${vidno ? "eye-off" : "eye"} velikost=${18} /></button>` : null}
  </label>`;
}

function Sporocilo({ besedilo, vrsta = "napaka" }) {
  if (!besedilo) return null;
  return html`<p class=${vrsta === "napaka" ? "napaka-besedilo" : "uspeh-besedilo"} role=${vrsta === "napaka" ? "alert" : "status"}>${besedilo}</p>`;
}

/* ---------------- Prijava ---------------- */
export function Prijava() {
  const pot = usePot();
  const obvestilo = useSeja(s => s.obvestilo);
  const [email, setEmail] = useState(lokalno.get(KLJUC_MAIL, "") || "");
  const [geslo, setGeslo] = useState("");
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);

  async function poslji(ev) {
    ev.preventDefault();
    const m = email.trim().toLowerCase();
    if (!EMAIL_RE.test(m)) { setNapaka(t("Enter a valid email address.")); return; }
    if (!geslo) { setNapaka(t("Enter your password.")); return; }
    setTece(true); setNapaka("");
    const { error } = await supabase.auth.signInWithPassword({ email: m, password: geslo });
    setTece(false);
    if (error) {
      if (error.code === "email_not_confirmed") {
        cakajoce = { email: m, geslo };   // geslo je pravilno (GoTrue ga preveri pred potrditvijo naslova)
        lokalno.set(KLJUC_MAIL, m); navigiraj(zNaslednjo(pot, "/app/verify")); return;
      }
      setNapaka(sporocilo(error)); return;
    }
    pozabiGeslo();
    seja.set({ obvestilo: "" });
    pozabiCakajociMail();   // uspesna prijava: e-naslov iz toka ponastavitve/potrditve ni vec potreben
    await naloziMe();
    navigiraj(naslednja(pot), { zamenjaj: true });
  }

  return html`<${Okvir} naslov=${t("Sign in")} podnaslov=${t("Sign in with your email and password")}>
    <form class="obrazec" onSubmit=${poslji} novalidate>
      ${obvestilo ? html`<${Sporocilo} besedilo=${t(obvestilo)} vrsta="info" />` : null}
      <${Polje} tip="email" ime="email" oznaka="email@domain.com" vrednost=${email} ob=${setEmail} samodejno="email" vec=${{ inputmode: "email" }} />
      <${Polje} tip="password" ime="password" oznaka=${t("password")} vrednost=${geslo} ob=${setGeslo} samodejno="current-password" />
      <a class="povezava-desno" href=${"/app/forgot"}>${t("Forgot password?")}</a>
      <${Sporocilo} besedilo=${napaka} />
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Continue...") : t("Continue")}</button>
      <a class="gumb-bel" href=${zNaslednjo(pot, "/app/register")}>${t("Create an account")}</a>
      <${Pogoji} />
    </form>
  <//>`;
}

/* ---------------- Registracija ---------------- */
export function Registracija() {
  const pot = usePot();
  const [p, setP] = useState({ username: "", email: "", geslo: "", geslo2: "", soglasje: false });
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const nastavi = k => v => setP(s => ({ ...s, [k]: v }));

  async function poslji(ev) {
    ev.preventDefault();
    const ime = p.username.trim(), m = p.email.trim().toLowerCase();
    if (ime.length < 3) return setNapaka(t("Username must be at least 3 characters."));
    if (ime.length > 20) return setNapaka(t("Username can have at most 20 characters."));
    if (!USER_RE.test(ime)) return setNapaka(t("Username can contain only letters, numbers and underscore."));
    if (!EMAIL_RE.test(m)) return setNapaka(t("Enter a valid email address."));
    if (p.geslo.length < 8) return setNapaka(t("Password must be at least 8 characters."));
    if (p.geslo !== p.geslo2) return setNapaka(t("Passwords do not match."));
    if (!p.soglasje) return setNapaka(t("Please confirm you are at least 18 and accept the Terms of Use."));
    setTece(true); setNapaka("");
    const { data, error } = await supabase.auth.signUp({
      email: m, password: p.geslo,
      options: {
        emailRedirectTo: location.origin + "/",
        // Dokaz privolitve (kot outly.si) + uporabnisko ime, ki ga backend vzame ob prvem GET /me.
        data: { username: ime, ref: refKoda(), terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() }
      }
    });
    setTece(false);
    if (error) return setNapaka(sporocilo(error));
    // Supabase pri obstojecem naslovu ne vrne napake, ampak uporabnika brez identitet.
    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return setNapaka(t("That email is already registered. Sign in instead."));
    }
    if (data && data.session) { pozabiCakajociMail(); await naloziMe(); navigiraj(naslednja(pot), { zamenjaj: true }); return; }
    cakajoce = { email: m, geslo: p.geslo };
    lokalno.set(KLJUC_MAIL, m);
    navigiraj(zNaslednjo(pot, "/app/verify"), { zamenjaj: true });
  }

  return html`<${Okvir} naslov=${t("Create an account")}>
    <form class="obrazec" onSubmit=${poslji} novalidate>
      <${Polje} ime="username" oznaka=${t("username")} vrednost=${p.username} ob=${nastavi("username")} samodejno="username" vec=${{ autocapitalize: "off", spellcheck: "false", maxlength: 20 }} />
      <${Polje} tip="email" ime="email" oznaka="email@domain.com" vrednost=${p.email} ob=${nastavi("email")} samodejno="email" vec=${{ inputmode: "email" }} />
      <${Polje} tip="password" ime="password" oznaka=${t("password")} vrednost=${p.geslo} ob=${nastavi("geslo")} samodejno="new-password" />
      <${Polje} tip="password" ime="password2" oznaka=${t("confirm password")} vrednost=${p.geslo2} ob=${nastavi("geslo2")} samodejno="new-password" />
      <label class="soglasje">
        <input type="checkbox" checked=${p.soglasje} onChange=${e => nastavi("soglasje")(e.target.checked)} />
        <span>${t("I am at least 18 and accept the")} <a href="/terms" target="_blank" rel="noopener">${t("Terms of Use")}</a> ${t("and")} <a href="/privacy-app" target="_blank" rel="noopener">${t("Privacy Policy")}</a>.</span>
      </label>
      <${Sporocilo} besedilo=${napaka} />
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Signing up...") : t("Sign up")}</button>
      <a class="gumb-bel" href=${zNaslednjo(pot, "/app/login")}>${t("Sign in")}</a>
    </form>
  <//>`;
}

/* ---------------- Potrditev e-naslova s kodo ---------------- */
export function Potrditev() {
  const pot = usePot();
  const email = lokalno.get(KLJUC_MAIL, "") || "";
  const povezava = zetonPovezave(pot, ["signup", "email"]);
  const [koda, setKoda] = useState("");
  const [napaka, setNapaka] = useState("");
  const [info, setInfo] = useState("");
  const [namig, setNamig] = useState("");
  const [tece, setTece] = useState(false);
  const [odstevanje, setOdstevanje] = useState(0);
  useEffect(() => {
    if (odstevanje <= 0) return;
    const id = setTimeout(() => setOdstevanje(odstevanje - 1), 1000);
    return () => clearTimeout(id);
  }, [odstevanje]);
  // Ob vrnitvi v zavihek (npr. po kliku na povezavo v mailu) tiho preveri, ali je racun ze potrjen; najvec na 10 s.
  useEffect(() => {
    if (povezava) return;
    let zadnja = 0;
    const ob = () => {
      if (document.visibilityState !== "visible" || Date.now() - zadnja < 10000) return;
      zadnja = Date.now();
      tihaPrijava();
    };
    document.addEventListener("visibilitychange", ob);
    return () => document.removeEventListener("visibilitychange", ob);
  }, [email, !!povezava]);

  async function vstopi() {
    pozabiGeslo();
    pozabiCakajociMail();
    await naloziMe();
    navigiraj(naslednja(pot), { zamenjaj: true });
  }
  /* Tiha prijava z geslom iz pomnilnika: uspe samo, ce je racun ze potrjen. Brez gesla ali ob kakrsnikoli napaki
     (tudi email_not_confirmed) ne naredi nic vidnega. Vrne true, ce je uporabnik prijavljen in preusmerjen. */
  function tihaPrijava() {
    const geslo = gesloZa(email);
    if (!email || !geslo) return Promise.resolve(false);
    if (!tihaPrijavaTece) {
      tihaPrijavaTece = (async () => {
        const { error } = await supabase.auth.signInWithPassword({ email, password: geslo });
        if (error) return false;
        await vstopi();
        return true;
      })().catch(() => false).finally(() => { tihaPrijavaTece = null; });
    }
    return tihaPrijavaTece;
  }

  async function poslji(ev) {
    ev.preventDefault();
    if (!email || koda.length < 6 || koda.length > 10) return setNapaka(t("Enter the code from the email."));
    setTece(true); setNapaka(""); setInfo(""); setNamig("");
    const { error } = await supabase.auth.verifyOtp({ email, token: koda, type: "signup" });
    if (error) {
      const porabljena = error.code === "otp_expired" || error.code === "otp_disabled";
      // Povezava v mailu (ali Googlov pregled povezave) je potrditev ze porabila -> ce je racun potrjen, nas tiha prijava spusti naprej.
      if (porabljena && await tihaPrijava()) return;
      setTece(false);
      // Brez gesla v pomnilniku (stran je bila vmes osvezena) ne vemo, ali je racun ze potrjen.
      return setNapaka(porabljena && !gesloZa(email)
        ? t("This code is wrong or no longer works. If you already confirmed your email with the link, tap “Already confirmed? Sign in” below.")
        : sporocilo(error));
    }
    setTece(false);
    await vstopi();
  }
  async function znova() {
    setNapaka(""); setInfo(""); setNamig("");
    setTece(true);
    // Za ze potrjen racun Supabase maila ne poslje (a vrne 200) -> najprej tiha prijava.
    if (await tihaPrijava()) return;
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setTece(false);
    if (error) return setNapaka(sporocilo(error));
    setInfo(t("We sent you a new code.")); setOdstevanje(60);
    if (!gesloZa(email)) setNamig(t("If your email is already confirmed, no new code is sent. Tap “Already confirmed? Sign in” below."));
  }
  async function potrdiPovezavo(ev) {
    ev.preventDefault();
    setTece(true); setNapaka("");
    const { error } = await supabase.auth.verifyOtp(povezava);
    if (error) {
      setTece(false);
      return setNapaka(error.code === "otp_expired" ? t("This link is no longer valid. If you already confirmed your email, sign in.") : sporocilo(error));
    }
    await vstopi();
  }

  if (povezava) return html`<${Okvir} naslov=${t("Verify your email")} podnaslov=${t("Tap the button to confirm your email.")}>
    <form class="obrazec" onSubmit=${potrdiPovezavo} novalidate>
      <${Sporocilo} besedilo=${napaka} />
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Verifying...") : t("Confirm email")}</button>
      <a class="povezava-gumb" href=${zNaslednjo(pot, "/app/login")}>${t("Already confirmed? Sign in")}</a>
    </form>
  <//>`;

  return html`<${Okvir} naslov=${t("Verify your email")} podnaslov=${t("We sent a verification code to:")}>
    <p class="avt-mail">${email || "—"}</p>
    <form class="obrazec" onSubmit=${poslji} novalidate>
      <${Polje} ime="code" oznaka=${t("code")} vrednost=${koda} ob=${v => setKoda(v.replace(/\D/g, "").slice(0, 10))}
        samodejno="one-time-code" vec=${{ inputmode: "numeric", maxlength: 10, class: "koda" }} />
      <${Sporocilo} besedilo=${napaka} />
      <${Sporocilo} besedilo=${info} vrsta="info" />
      <${Sporocilo} besedilo=${namig} vrsta="info" />
      <button class="gumb-glavni" type="submit" disabled=${tece || !email || koda.length < 6}>${tece ? t("Verifying...") : t("Verify")}</button>
      <button class="povezava-gumb" type="button" onClick=${znova} disabled=${tece || !email || odstevanje > 0}>
        ${odstevanje > 0 ? t("Resend code in {s} s", { s: odstevanje }) : t("Resend code")}</button>
      <a class="povezava-gumb" href=${zNaslednjo(pot, "/app/login")} onClick=${pozabiGeslo}>${t("Already confirmed? Sign in")}</a>
      <a class="povezava-gumb" href=${zNaslednjo(pot, "/app/register")} onClick=${pozabiGeslo}>${t("Change email")}</a>
    </form>
  <//>`;
}

/* ---------------- Pozabljeno geslo: mail -> koda -> novo geslo -> prijava ---------------- */
export function PozabljenoGeslo() {
  const pot = usePot();
  const povezava = zetonPovezave(pot, ["recovery"]);
  const [korak, setKorak] = useState(povezava ? "povezava" : "mail");
  const [izPovezave, setIzPovezave] = useState(false);   // seja iz povezave v mailu: kode ne rabimo
  const [email, setEmail] = useState(lokalno.get(KLJUC_MAIL, "") || "");
  const [koda, setKoda] = useState("");
  const [geslo, setGeslo] = useState("");
  const [geslo2, setGeslo2] = useState("");
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);

  async function zahtevaj(ev) {
    ev && ev.preventDefault();
    const m = email.trim().toLowerCase();
    if (!EMAIL_RE.test(m)) return setNapaka(t("Enter a valid email address."));
    setTece(true); setNapaka("");
    const { error } = await supabase.auth.resetPasswordForEmail(m, { redirectTo: location.origin + "/" });
    setTece(false);
    if (error) return setNapaka(sporocilo(error));
    setEmail(m); setKorak("koda");
  }
  /* Povezava v mailu (?token_hash=...&type=recovery): potrdi sele ob kliku (Googlov pregled povezave je ne porabi). */
  async function potrdiPovezavo(ev) {
    ev.preventDefault();
    setTece(true); setNapaka("");
    const { data, error } = await supabase.auth.verifyOtp(povezava);
    setTece(false);
    if (error) {
      setKorak("mail");
      return setNapaka(error.code === "otp_expired" ? t("This link is no longer valid. Request a new code below.") : sporocilo(error));
    }
    if (data && data.user && data.user.email) setEmail(data.user.email);
    setIzPovezave(true); setKorak("koda");
  }
  async function ponastavi(ev) {
    ev.preventDefault();
    if (!izPovezave && koda.length < 6) return setNapaka(t("Enter the code from the email."));
    if (geslo.length < 8) return setNapaka(t("Password must be at least 8 characters."));
    if (geslo !== geslo2) return setNapaka(t("Passwords do not match."));
    setTece(true); setNapaka("");
    if (!izPovezave) {
      const v = await supabase.auth.verifyOtp({ email, token: koda, type: "recovery" });
      if (v.error) { setTece(false); return setNapaka(sporocilo(v.error)); }
    }
    const u = await supabase.auth.updateUser({ password: geslo });
    if (u.error) { setTece(false); return setNapaka(sporocilo(u.error)); }
    // Kot iOS: nova prijava povsod (stare seje na drugih napravah se odjavijo).
    try { await supabase.auth.signOut({ scope: "global" }); } catch { /* lokalno je vseeno odjavljen */ }
    setTece(false);
    lokalno.set(KLJUC_MAIL, email);
    seja.set({ obvestilo: "Password changed. Sign in with your new password." });
    navigiraj("/app/login", { zamenjaj: true });
  }

  if (korak === "povezava") return html`<${Okvir} naslov=${t("Reset password")} podnaslov=${t("Tap the button to set a new password.")}>
    <form class="obrazec" onSubmit=${potrdiPovezavo} novalidate>
      <${Sporocilo} besedilo=${napaka} />
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Continue...") : t("Continue")}</button>
    </form>
  <//>`;

  if (korak === "mail") return html`<${Okvir} naslov=${t("Forgot password?")} podnaslov=${t("Enter your email and we will send you a code.")}>
    <form class="obrazec" onSubmit=${zahtevaj} novalidate>
      <${Polje} tip="email" ime="email" oznaka="email@domain.com" vrednost=${email} ob=${setEmail} samodejno="email" vec=${{ inputmode: "email" }} />
      <${Sporocilo} besedilo=${napaka} />
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Sending...") : t("Send code")}</button>
    </form>
  <//>`;

  return html`<${Okvir} naslov=${t("Reset password")} podnaslov=${izPovezave ? t("Choose a new password for:") : t("If that address has an account, we sent a code to:")}>
    <p class="avt-mail">${email}</p>
    <form class="obrazec" onSubmit=${ponastavi} novalidate>
      ${izPovezave ? null : html`<${Polje} ime="code" oznaka=${t("code")} vrednost=${koda} ob=${v => setKoda(v.replace(/\D/g, "").slice(0, 10))}
        samodejno="one-time-code" vec=${{ inputmode: "numeric", maxlength: 10, class: "koda" }} />`}
      <${Polje} tip="password" ime="password" oznaka=${t("new password")} vrednost=${geslo} ob=${setGeslo} samodejno="new-password" />
      <${Polje} tip="password" ime="password2" oznaka=${t("confirm password")} vrednost=${geslo2} ob=${setGeslo2} samodejno="new-password" />
      <${Sporocilo} besedilo=${napaka} />
      <button class="gumb-glavni" type="submit" disabled=${tece}>${tece ? t("Saving...") : t("Save new password")}</button>
      ${izPovezave ? null : html`<button class="povezava-gumb" type="button" onClick=${() => zahtevaj()} disabled=${tece}>${t("Resend code")}</button>`}
    </form>
  <//>`;
}
