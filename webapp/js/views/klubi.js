/* My Clubs (MyClubsView.swift) in vabila v ekipo kluba (ClubInvitesView.swift).
   Ena oseba je lahko v ekipi vec klubov (backend 018); vlogo po klubu odloca streznik.
   "View" odpre klub, v katerem delam (views/posel.js SredisceKluba). QR skener je samo v aplikaciji Outly. */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { useSeja, naloziMe } from "../seja.js";
import { GlavaNazaj, Ikona, Slika, Nalaganje, Napaka, List } from "../ui.js";
import { imeVloge } from "../posel.js";

const opisVloge = v => (v === "manager" ? t("event management, sales and ticket scanning")
  : v === "bartender" ? t("serving VIP tables") : t("ticket scanning at the door"));

export function MojiKlubi() {
  const me = useSeja(s => s.me);
  const [vabila, setVabila] = useState([]);
  const [napaka, setNapaka] = useState(null);
  const [zapusti, setZapusti] = useState(null);
  const [tece, setTece] = useState(false);
  useEffect(() => {
    naloziMe();
    send("/me/invites", { auth: true }).then(r => setVabila((r && r.invites) || [])).catch(() => {});
  }, []);
  if (!me) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/profile" /><${Nalaganje} /></div>`;
  const klubi = Array.isArray(me.clubs) ? me.clubs : [];

  async function zapustiEkipo() {
    const k = zapusti; setZapusti(null); setTece(true); setNapaka(null);
    try { await send("/business/team/me", { method: "DELETE", auth: true, klub: k.club_id }); await naloziMe(); }
    catch (e) { setNapaka(sporocilo(e)); }
    setTece(false);
  }

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("My clubs")} rezerva="/app/profile" />
    <a class="kartica-vrstica" href="/app/invites">
      <${Ikona} ime="bell" velikost=${20} />
      <span class="kv-besedilo"><strong>${t("Notifications")}</strong><span>${vabila.length ? t("{n} invitations", { n: vabila.length }) : t("No new notifications")}</span></span>
      ${vabila.length ? html`<span class="znacka-stevilo">${vabila.length}</span>` : null}
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>
    <${Napaka} besedilo=${napaka} />
    ${!klubi.length ? html`<div class="prazno"><${Ikona} ime="building" velikost=${34} razred="modra" />
      <strong>${t("You are currently not working for any club")}</strong>
      <span>${t("Invitations from clubs to join their team will show up here.")}</span></div>` : null}
    ${klubi.map(k => html`<div class="kartica-kluba-clan" key=${k.club_id}>
      <span class="okrogla-slika velika">${k.club_logo_url ? html`<${Slika} src=${k.club_logo_url} sirina=${190} alt="" />` : html`<${Ikona} ime="building" velikost=${24} />`}</span>
      <span class="kv-besedilo"><strong>${k.club_name}</strong><span>${imeVloge(k.role)}</span></span>
      <div class="kk-gumba">
        <a class="gumb-siv majhen" href=${"/app/business/" + k.club_id}>${t("View")}</a>
        ${k.role !== "owner" ? html`<button type="button" class="gumb-majhen" disabled=${tece} onClick=${() => setZapusti(k)}>${t("Leave the team")}</button>` : null}
      </div>
    </div>`)}
    <${List} odprt=${!!zapusti} zapri=${() => setZapusti(null)} naslov=${t("Leave the team")}>
      <p class="besedilo-opis">${t("You lose access to the club tools. The club can invite you again.")}</p>
      <button type="button" class="gumb-rdec" onClick=${zapustiEkipo}>${t("Leave team")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setZapusti(null)}>${t("Cancel")}</button>
    <//>
  </div>`;
}

export function VabilaKlubov() {
  const [s, setS] = useState({ nalaga: true, napaka: null, vabila: [] });
  const [zaseden, setZaseden] = useState(null);
  const [sprejeto, setSprejeto] = useState("");
  const nalozi = () => send("/me/invites", { auth: true })
    .then(r => setS({ nalaga: false, napaka: null, vabila: (r && r.invites) || [] }))
    .catch(e => setS({ nalaga: false, napaka: sporocilo(e), vabila: [] }));
  useEffect(() => { nalozi(); }, []);
  async function odgovori(v, sprejmi) {
    setZaseden(v.id);
    try {
      await send(`/me/invites/${v.id}/${sprejmi ? "accept" : "decline"}`, { method: "POST", auth: true });
      if (sprejmi) setSprejeto(v.club_name);
      await nalozi(); naloziMe();
    } catch (e) { setS(x => ({ ...x, napaka: sporocilo(e) })); }
    setZaseden(null);
  }
  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Notifications")} rezerva="/app/my-clubs" />
    ${sprejeto ? html`<p class="uspeh-besedilo" role="status">${t("Congratulations, you have become a {club} employee.", { club: sprejeto })}</p>` : null}
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !s.vabila.length ? html`<div class="prazno"><${Ikona} ime="bell" velikost=${34} razred="modra" />
      <strong>${t("No new notifications")}</strong><span>${t("Invitations from clubs to join their team will show up here.")}</span></div>` : null}
    ${s.vabila.map(v => html`<div class="kartica-vabila" key=${v.id}>
      <div class="kv-vrsta-glava">
        <span class="okrogla-slika">${v.club_logo_url ? html`<${Slika} src=${v.club_logo_url} sirina=${130} alt="" />` : html`<${Ikona} ime="building" velikost=${20} />`}</span>
        <span class="kv-besedilo"><strong>${v.club_name}</strong>${v.invited_by_username ? html`<span>${t("Invited by {who}", { who: v.invited_by_username })}</span>` : null}</span>
      </div>
      <p class="besedilo-opis">${t("{club} has sent you an invitation to work as a {role}. With this role you will get access to {access}.", { club: v.club_name, role: imeVloge(v.role), access: opisVloge(v.role) })}</p>
      <div class="kn-gumba">
        <button type="button" class="gumb-glavni majhen" disabled=${zaseden === v.id} onClick=${() => odgovori(v, true)}>${t("Accept")}</button>
        <button type="button" class="gumb-siv majhen" disabled=${zaseden === v.id} onClick=${() => odgovori(v, false)}>${t("Reject")}</button>
      </div>
    </div>`)}
  </div>`;
}
