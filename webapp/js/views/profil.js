/* Profil (ProfileView.swift): osebni obraz - glava z My Account, meni (klubi, prijatelji, vstopnice ...).
   Lastnik kluba (vloga business) vidi klubski profil (OwnerProfileView -> views/posel.js), dokler v Settings
   ne preklopi na osebni racun; izbira je shranjena v tem brskalniku (kot iOS profilObraz). */
import { html, useEffect } from "../lib.js";
import { t } from "../i18n.js";
import { useSeja, odjava, naloziMe } from "../seja.js";
import { sporocilo } from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import { Avatar, Ikona, Nalaganje, Napaka } from "../ui.js";
import { MenijskaVrstica } from "./racun.js";
import { LastnikProfil } from "./posel.js";
import { useObraz } from "../posel.js";

export function Profil() {
  const { prijavljen, me, email, meNapaka } = useSeja(s => s);
  const obraz = useObraz();
  // Ob vsakem obisku sveze znacke (vabila, prosnje) - kot iOS onAppear.
  useEffect(() => { if (prijavljen) naloziMe(); }, [prijavljen]);
  if (!prijavljen) return html`<div class="zaslon">
    <h1 class="velik-naslov">${t("Profile")}</h1>
    <div class="prazno">
      <${Ikona} ime="user" velikost=${36} razred="modra" />
      <strong>${t("Sign in to Outly")}</strong>
      <span>${t("Your tickets, plans and friends - on the web and in the app, with one account.")}</span>
      <a class="gumb-glavni" href="/app/login?next=/app/profile">${t("Sign in")}</a>
      <a class="gumb-bel" href="/app/register?next=/app/profile">${t("Create an account")}</a>
    </div>
    <${MeniJezik} />
  </div>`;
  // Streznik ali Supabase ne odgovarja (npr. 503): seja ostane, pokazemo napako in "Try again" (I10).
  if (!me && meNapaka) return html`<div class="zaslon"><h1 class="velik-naslov">${t("Profile")}</h1>
    <${Napaka} besedilo=${sporocilo(meNapaka)} znova=${naloziMe} /></div>`;
  if (!me) return html`<div class="zaslon"><${Nalaganje} /></div>`;
  if (me.role === "business" && obraz === "club") return html`<${LastnikProfil} me=${me} />`;

  return html`<div class="zaslon profil">
    <div class="profil-vrsta">
      <${Avatar} url=${me.avatar_url} ime=${me.username} velikost=${60} />
      <div class="kv-besedilo"><strong class="profil-ime">${me.username}</strong>
        <a class="povezava-modra" href="/app/account">${t("My Account")}</a></div>
    </div>
    <div class="seznam-kartica">
      <${MenijskaVrstica} href="/app/my-clubs" ikona="building" naslov=${t("My Clubs")} znacka=${me.pending_invites || 0} />
      <${MenijskaVrstica} href="/app/friends" ikona="users" naslov=${t("My Friends")} znacka=${me.pending_friend_requests || 0} />
      <${MenijskaVrstica} href="/app/tickets" ikona="ticket" naslov=${t("Tickets")} />
      <${MenijskaVrstica} href="/app/interested" ikona="thumbs-up" naslov=${t("Interested events")} />
      <${MenijskaVrstica} href="/app/payment" ikona="credit-card" naslov=${t("Payment")} />
      <${MenijskaVrstica} href="/app/help" ikona="circle-question-mark" naslov=${t("Support")} />
      <${MenijskaVrstica} href="/app/about" ikona="info" naslov=${t("About")} />
    </div>
    <button type="button" class="povezava-gumb rdeca" onClick=${async () => { await odjava(); navigiraj("/app", { zamenjaj: true }); }}>${t("Log out")}</button>
  </div>`;
}

function MeniJezik() {
  return html`<div class="seznam-kartica">
    <a class="menijska-vrstica" href="/app/language"><${Ikona} ime="globe" /><span>${t("Language")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></a>
  </div>`;
}
