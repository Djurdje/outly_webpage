/* Zvonec na domacem zaslonu (NotificationsMenuView.swift): vabila v ekipo, prosnje za prijateljstvo,
   prejete vstopnice, dodajanja na guest listo, novi dogodki klubov, ki jim uporabnik sledi. Dotik obvestilo oznaci kot prebrano. */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { useSeja, naloziMe } from "../seja.js";
import { navigiraj } from "../usmerjanje.js";
import { Ikona, Avatar, Slika, List } from "../ui.js";
import { danKratek } from "../oblika.js";

/** Stevilo na zvoncu: 0 = nic, 1 = "1", 2+ = "1+" (kot iOS). */
export function steviloObvestil(me) {
  if (!me) return 0;
  return (me.pending_invites || 0) + (me.pending_friend_requests || 0) + (me.pending_received_tickets || 0) + (me.pending_club_events || 0)
    + (me.pending_guest_list_invites || 0);
}

export function Zvonec({ odpri }) {
  const me = useSeja(s => s.me);
  const n = steviloObvestil(me);
  return html`<button type="button" class="krog-gumb zvonec" onClick=${odpri} aria-label=${n ? t("Notifications") + ` (${n})` : t("Notifications")}>
    <${Ikona} ime="bell" velikost=${18} />
    ${n ? html`<span class="znacka-zvonca">${n >= 2 ? "1+" : "1"}</span>` : null}
  </button>`;
}

/** "Naslov · Klub · Pet 31. okt" (manjkajoca polja izpustimo). */
function opisDogodka(e) {
  if (!e) return "";
  const d = e.start_at ? new Date(e.start_at) : null;
  return [e.title, e.club_name, d && !Number.isNaN(d.getTime()) ? danKratek(d) : ""].filter(Boolean).join(" · ");
}

export function MeniObvestil({ odprt, zapri }) {
  const [s, setS] = useState({ nalaga: true, vabila: [], prosnje: [], vstopnice: [], gl: [], klubi: [] });
  useEffect(() => {
    if (!odprt) return;
    setS(x => ({ ...x, nalaga: true }));
    // Vsak vir posebej: star backend brez poti ali napaka pusti samo ta seznam prazen (kot iOS).
    const varno = p => p.catch(() => null);
    Promise.all([
      varno(send("/me/invites", { auth: true })), varno(send("/me/friends", { auth: true })),
      varno(send("/me/tickets/received", { auth: true })), varno(send("/me/club-events", { auth: true })),
      varno(send("/me/guest-list-invites/received", { auth: true }))   // 404 (star backend) = brez vrstic
    ]).then(([v, f, r, k, g]) => setS({
      nalaga: false,
      vabila: (v && v.invites) || [], prosnje: (f && f.requests_in) || [],
      vstopnice: (r && r.received) || [], gl: (g && g.invites) || [], klubi: (k && k.notifications) || []
    }));
    naloziMe();
  }, [odprt]);

  const pojdi = async (pot, oznaci) => {
    zapri();
    if (oznaci) { try { await send(oznaci, { method: "POST", auth: true }); } catch { /* ob naslednjem nalaganju se vrne */ } naloziMe(); }
    navigiraj(pot);
  };
  const prazno = !s.nalaga && !s.vabila.length && !s.prosnje.length && !s.vstopnice.length && !s.gl.length && !s.klubi.length;

  return html`<${List} odprt=${odprt} zapri=${zapri} naslov=${t("Notifications")}>
    ${s.nalaga ? html`<div class="nalaganje"><span class="vrtavka"></span></div>` : null}
    ${prazno ? html`<p class="utisano srednje">${t("No new notifications")}</p>` : null}
    ${s.vabila.map(v => html`<button type="button" class="vrstica-obvestila" key=${"v" + v.id} onClick=${() => pojdi("/app/invites")}>
      <span class="okrogla-slika">${v.club_logo_url ? html`<${Slika} src=${v.club_logo_url} sirina=${130} alt="" />` : html`<${Ikona} ime="building" velikost=${18} />`}</span>
      <span class="kv-besedilo"><strong>${t("{club} invited you to work as {role}", { club: v.club_name, role: v.role === "manager" ? t("Manager") : t("Door staff") })}</strong>
        <span>${t("Open to accept or reject")}</span></span></button>`)}
    ${s.prosnje.map(r => html`<button type="button" class="vrstica-obvestila" key=${"p" + r.id} onClick=${() => pojdi("/app/friends")}>
      <${Avatar} url=${r.user.avatar_url} ime=${r.user.username} velikost=${44} />
      <span class="kv-besedilo"><strong>${t("{name} wants to be your friend", { name: r.user.username })}</strong>
        <span>${t("Open My friends to accept")}</span></span></button>`)}
    ${s.vstopnice.map(v => html`<button type="button" class="vrstica-obvestila" key=${"t" + v.id} onClick=${() => pojdi("/app/tickets", `/me/tickets/received/${v.id}/seen`)}>
      <span class="okrogla-slika"><${Ikona} ime="ticket" velikost=${18} /></span>
      <span class="kv-besedilo"><strong>${v.from ? t("{name} sent you a ticket for {event}", { name: v.from.username, event: v.event_title }) : t("You received a ticket for {event}", { event: v.event_title })}</strong>
        <span>${t("It's in your Tickets")}</span></span></button>`)}
    ${s.gl.map(g => html`<button type="button" class="vrstica-obvestila" key=${"g" + g.id} onClick=${() => pojdi("/app/tickets", `/me/guest-list-invites/received/${g.id}/seen`)}>
      <${Avatar} url=${g.host_avatar_url} ime=${g.host_username} velikost=${44} />
      <span class="kv-besedilo"><strong>${t("{name} added you to their guest list", { name: g.host_username })}</strong>
        <span>${opisDogodka(g.event)}</span></span></button>`)}
    ${s.klubi.map(n => html`<button type="button" class="vrstica-obvestila" key=${"k" + n.id} onClick=${() => pojdi("/app/event/" + n.event_id, `/me/club-events/${n.id}/seen`)}>
      <span class="okrogla-slika">${n.club_logo_url ? html`<${Slika} src=${n.club_logo_url} sirina=${130} alt="" />` : html`<${Ikona} ime="building" velikost=${18} />`}</span>
      <span class="kv-besedilo"><strong>${t("{club} posted a new event: {event}", { club: n.club_name, event: n.event_title })}</strong>
        <span>${t("Open the event")}</span></span></button>`)}
  <//>`;
}
