/* Ekipa kluba (TeamView + AddTeamMemberView): lastnik + managerji + vratarji (GET /business/team) in cakajoca vabila.
   Lastnik vabi in odstranjuje vse; manager samo vratarje (streznik to uveljavi, tu samo skrijemo gumbe).
   Dodajanje poslje VABILO: clan nastane, ko ga povabljeni sprejme (Profil -> My clubs -> Notifications). */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { sporocilo } from "../napake.js";
import { GlavaNazaj, Ikona, Avatar, Nalaganje, List } from "../ui.js";
import { idKluba, poslovno, imeVloge } from "../posel.js";
import { PoslovnaNapaka } from "./posel.js";

/* Napake vabila v ekipo: ista koda backenda pomeni tu drugo kot pri sprejemu vabila (napake.js). */
function napakaEkipe(e) {
  const s = String((e && e.raw) || "").toLowerCase();
  if (s.includes("no_account")) return t("No Outly account with this email. Ask them to sign up first.");
  if (s.includes("valid email is required")) return t("Enter a valid email address.");
  if (s.includes("already_invited")) return t("This person already has a pending invitation from your club.");
  if (s.includes("already_member")) return t("This person is already in your team.");
  if (s.includes("is_owner")) return t("This person owns a club and can't join a team.");
  if (s.includes("already in this team")) return t("You are already in this team.");
  if (s.includes("only the club owner can")) return t("Only the club owner can do that.");
  return sporocilo(e);
}

export function Ekipa({ klub }) {
  const id = idKluba(klub);
  const [s, setS] = useState({ nalaga: true, napaka: null, vloga: "", clani: [], vabila: [] });
  const [napaka, setNapaka] = useState("");
  const [zaseden, setZaseden] = useState(null);
  const [odstrani, setOdstrani] = useState(null);
  const [preklici, setPreklici] = useState(null);
  const [dodaj, setDodaj] = useState(false);
  const sprejmi = r => setS({ nalaga: false, napaka: null, vloga: r.my_role || "", clani: r.members || [], vabila: r.invites || [] });
  const nalozi = () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    poslovno(id, "/business/team").then(sprejmi).catch(e => setS(x => ({ ...x, nalaga: false, napaka: e })));
  };
  useEffect(() => { if (id) nalozi(); }, [id]);
  const lastnik = s.vloga === "owner" || s.vloga === "admin";
  const lahkoOdstrani = m => m.role !== "owner" && (lastnik || m.role === "doorman");
  const lahkoPreklice = v => lastnik || v.role === "doorman";
  const ime = x => x.username || x.email;

  async function izvedi(kljuc, pot) {
    setZaseden(kljuc); setNapaka("");
    try { sprejmi(await poslovno(id, pot, { method: "DELETE" })); }
    catch (e) { setNapaka(napakaEkipe(e)); }
    setZaseden(null);
  }

  const rezerva = `/app/business/${id}`;
  if (!id) return html`<div class="zaslon"><${GlavaNazaj} rezerva="/app/profile" /><${PoslovnaNapaka} napaka=${{ status: 404 }} /></div>`;
  return html`<div class="zaslon">
    <${GlavaNazaj} rezerva=${rezerva} />
    <h1 class="velik-naslov">${t("Team")}</h1>
    ${s.nalaga && !s.clani.length ? html`<${Nalaganje} />` : null}
    <${PoslovnaNapaka} napaka=${s.clani.length ? null : s.napaka} znova=${nalozi} rezerva=${rezerva} />
    ${s.clani.length ? html`
      <div class="seznam">${s.clani.map(m => html`<div class="vrstica-clana" key=${m.user_id}>
        <${Avatar} url=${m.avatar_url} ime=${ime(m)} velikost=${44} />
        <span class="kv-besedilo"><strong>${ime(m)}</strong>${m.email ? html`<span>${m.email}</span>` : null}</span>
        <span class=${"oznaka-vloge-cip" + (m.role === "owner" ? " lastnik" : "")}>${imeVloge(m.role)}</span>
        ${lahkoOdstrani(m) ? html`<button type="button" class="krog-gumb majhen" disabled=${zaseden !== null}
          aria-label=${t("Remove {name} from the team", { name: ime(m) })} onClick=${() => setOdstrani(m)}>
          ${zaseden === "c" + m.user_id ? html`<span class="vrtavka majhna"></span>` : html`<${Ikona} ime="x" velikost=${14} />`}</button>` : null}
      </div>`)}</div>
      ${s.vabila.length ? html`<h2 class="podnaslov-sekcije">${t("Waiting for reply")}</h2>
        <div class="seznam">${s.vabila.map(v => html`<div class="vrstica-clana vabilo" key=${v.id}>
          <span class="krog-ikona"><${Ikona} ime="mail" velikost=${16} /></span>
          <span class="kv-besedilo"><strong>${ime(v)}</strong><span>${t("Invited as {role} · waiting", { role: imeVloge(v.role).toLowerCase() })}</span></span>
          ${lahkoPreklice(v) ? html`<button type="button" class="krog-gumb majhen" disabled=${zaseden !== null}
            aria-label=${t("Cancel the invitation for {name}", { name: ime(v) })} onClick=${() => setPreklici(v)}>
            ${zaseden === "v" + v.id ? html`<span class="vrtavka majhna"></span>` : html`<${Ikona} ime="x" velikost=${14} />`}</button>` : null}
        </div>`)}</div>` : null}
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button type="button" class="gumb-glavni" onClick=${() => setDodaj(true)}><${Ikona} ime="user-plus" velikost=${18} /> ${t("Invite member")}</button>
      <div class="razlaga-vlog">
        <div><${Ikona} ime="id-card" velikost=${16} razred="modra" /><span class="kv-besedilo"><strong>${t("Manager")}</strong>
          <span>${t("Events, sales, club page and door staff. Can't add other managers.")}</span></span></div>
        <div><${Ikona} ime="scan-line" velikost=${16} razred="modra" /><span class="kv-besedilo"><strong>${t("Door staff")}</strong>
          <span>${t("Scans tickets at the door. Nothing else.")}</span></span></div>
      </div>` : null}

    <${List} odprt=${!!odstrani} zapri=${() => setOdstrani(null)} naslov=${odstrani ? t("Remove {name} from the team?", { name: ime(odstrani) }) : ""}>
      <p class="besedilo-opis">${t("They lose access to the club tools right away.")}</p>
      <button type="button" class="gumb-rdec" onClick=${() => { const m = odstrani; setOdstrani(null); izvedi("c" + m.user_id, `/business/team/${m.user_id}`); }}>${t("Remove")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setOdstrani(null)}>${t("Cancel")}</button>
    <//>
    <${List} odprt=${!!preklici} zapri=${() => setPreklici(null)} naslov=${preklici ? t("Cancel the invitation for {name}?", { name: ime(preklici) }) : ""}>
      <button type="button" class="gumb-rdec" onClick=${() => { const v = preklici; setPreklici(null); izvedi("v" + v.id, `/business/team/invites/${v.id}`); }}>${t("Cancel invitation")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setPreklici(null)}>${t("Keep it")}</button>
    <//>
    <${PovabiClana} odprt=${dodaj} zapri=${() => setDodaj(false)} klub=${id} lahkoManagerja=${lastnik} ob=${r => { sprejmi(r); setDodaj(false); }} />
  </div>`;
}

function PovabiClana({ odprt, zapri, klub, lahkoManagerja, ob }) {
  const [email, setEmail] = useState("");
  const [vloga, setVloga] = useState("doorman");
  const [tece, setTece] = useState(false);
  const [napaka, setNapaka] = useState("");
  useEffect(() => { if (odprt) { setEmail(""); setVloga("doorman"); setNapaka(""); } }, [odprt]);
  const e = email.trim();
  const ok = e.includes("@") && e.includes(".") && e.length >= 6;
  async function poslji() {
    setTece(true); setNapaka("");
    try { ob(await poslovno(klub, "/business/team", { method: "POST", body: { email: e, role: vloga } })); }
    catch (err) { setNapaka(napakaEkipe(err)); }
    setTece(false);
  }
  const izbira = (v, ikona, naslov, opis) => html`<button type="button" class=${"izbira-vloge" + (vloga === v ? " izbrana" : "")} aria-pressed=${vloga === v} onClick=${() => setVloga(v)}>
    <${Ikona} ime=${ikona} velikost=${18} /><span class="kv-besedilo"><strong>${naslov}</strong><span>${opis}</span></span>
    <${Ikona} ime=${vloga === v ? "circle-check" : "circle"} velikost=${20} razred=${vloga === v ? "modra" : "utisano"} /></button>`;
  return html`<${List} odprt=${odprt} zapri=${zapri} naslov=${t("Invite to team")}>
    <label class="polje-oznaceno">${t("Their Outly email")}<input type="email" value=${email} placeholder="name@email.com" autocomplete="off" autocapitalize="off" spellcheck="false" onInput=${ev => setEmail(ev.target.value)} /></label>
    <span class="opomba">${t("They need an Outly account with this email. They get the invitation in the app (Profile → My clubs) and join once they accept.")}</span>
    <span class="oznaka-polja">${t("Role")}</span>
    ${izbira("doorman", "scan-line", t("Door staff"), t("Scans tickets at the door."))}
    ${lahkoManagerja ? izbira("manager", "id-card", t("Manager"), t("Events, sales, club page and door staff.")) : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-glavni" onClick=${poslji} disabled=${!ok || tece}>${tece ? t("Sending...") : t("Send invite")}</button>
  <//>`;
}
