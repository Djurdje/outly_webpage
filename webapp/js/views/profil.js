/* Profil (ProfileView.swift) - faza 1: glava, vstopnice, "I'm in" dogodki, jezik, odjava.
   Ostalo (My Account, prijatelji, klubi, pomoc) pride v fazi 2; poslovni obraz v fazi 4. */
import { html } from "../lib.js";
import { t } from "../i18n.js";
import { useSeja, odjava, naloziMe } from "../seja.js";
import { sporocilo } from "../napake.js";
import { navigiraj } from "../usmerjanje.js";
import { Avatar, Ikona, Nalaganje, Napaka } from "../ui.js";

export function Profil() {
  const { prijavljen, me, email, meNapaka } = useSeja(s => s);
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

  return html`<div class="zaslon profil">
    <div class="profil-glava">
      <${Avatar} url=${me.avatar_url} ime=${me.username} velikost=${88} />
      <h1>${me.username}</h1>
      <span class="utisano">${me.email || email}</span>
    </div>
    <div class="seznam-kartica">
      <a class="menijska-vrstica" href="/app/tickets"><${Ikona} ime="ticket" /><span>${t("Tickets")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></a>
      <a class="menijska-vrstica" href="/app/interested"><${Ikona} ime="thumbs-up" /><span>${t("Interested events")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></a>
      <a class="menijska-vrstica" href="/app/language"><${Ikona} ime="globe" /><span>${t("Language")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></a>
    </div>
    <p class="opomba srednje">${t("More profile settings are coming to the web soon. Until then you can change them in the Outly app.")}</p>
    <div class="seznam-kartica">
      <button type="button" class="menijska-vrstica rdeca" onClick=${async () => { await odjava(); navigiraj("/app", { zamenjaj: true }); }}>
        <${Ikona} ime="log-out" /><span>${t("Log out")}</span>
      </button>
    </div>
  </div>`;
}

function MeniJezik() {
  return html`<div class="seznam-kartica">
    <a class="menijska-vrstica" href="/app/language"><${Ikona} ime="globe" /><span>${t("Language")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></a>
  </div>`;
}
