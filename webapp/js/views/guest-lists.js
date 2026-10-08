/* Guest lista (pogodba 8. 10. 2026, razdelek 3). Admin nastavi listo (dogodek + gostitelj + stevilo mest); gostitelj povabi prijatelje
   z Outly (GET /me/friends), vsak povabljenec dobi SVOJO vstopnico (svoj QR v Tickets), gostitelj ima tudi svojo.
   API: GET /me/guest-lists (star backend -> 404: razdelek tiho skrijemo), POST /me/guest-lists/:id/invites { user_ids, age_confirmed? },
   DELETE /me/guest-lists/:id/invites/:userId. Vstopnice guest liste se ne prenasajo (vstopnice.js). Podatki gredo v DOM prek htm. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t, tn } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo, kodaNapake } from "../napake.js";
import { danInUra } from "../oblika.js";
import { GlavaNazaj, Ikona, Slika, Avatar, Nalaganje, Napaka, List } from "../ui.js";
import { KodaQR } from "../qr.js";
import { IzbiraPrijateljev, usePrijatelji } from "../izbira-prijateljev.js";

/** Odgovor streznika -> oblika z varnimi privzetimi vrednostmi (star ali okrnjen odgovor ne podre izrisa). */
export function normalizirajListo(g) {
  const e = (g && g.event) || {};
  return {
    id: g.id,
    event: {
      id: e.id, title: e.title || "", club_name: e.club_name || "", poster_url: e.poster_url || "",
      start: e.start_at ? new Date(e.start_at) : null, min_age: Number(e.min_age) > 0 ? Number(e.min_age) : 0, status: e.status || "published"
    },
    spots: Number(g.spots) || 0,
    remaining: Math.max(0, Number(g.remaining) || 0),
    can_invite: g.can_invite === true,
    my_ticket_id: g.my_ticket_id ?? null,
    note: typeof g.note === "string" ? g.note : "",
    invited: (Array.isArray(g.invited) ? g.invited : []).filter(x => x && x.user_id != null)
      .map(x => ({ user_id: x.user_id, username: x.username || "", avatar_url: x.avatar_url || "", status: x.status || "valid" }))
  };
}

/** GET /me/guest-lists; vrne seznam ali vrze napako (404 = backend se nima guest list). */
async function naloziListe() {
  const r = await send("/me/guest-lists", { auth: true });
  return (Array.isArray(r && r.guest_lists) ? r.guest_lists : []).filter(g => g && g.id != null).map(normalizirajListo);
}

const prostaMesta = g => (g.remaining === 0 ? t("No spots left") : t("{n} of {max} spots left", { n: g.remaining, max: g.spots }));

/* ---------------- razdelek "Guest lists" v Tickets ---------------- */
export function GuestListSekcija() {
  const [liste, setListe] = useState([]);
  useEffect(() => {
    let zivo = true;
    // Vsaka napaka (404 na starem backendu, omrezje) razdelek tiho skrije: Tickets morajo delati tudi brez njega.
    naloziListe().then(l => { if (zivo) setListe(l); }).catch(() => {});
    return () => { zivo = false; };
  }, []);
  if (!liste.length) return null;
  return html`<section class="blok-besedila gl-sekcija" aria-label=${t("Guest lists")}>
    <h2 class="podnaslov">${t("Guest lists")}</h2>
    ${liste.map(g => html`<a class="kartica-vrstica gl-kartica" href=${"/app/guest-lists/" + g.id} key=${g.id}>
      <span class="vd-slika"><${Slika} src=${g.event.poster_url} sirina=${150} alt="" /></span>
      <span class="kv-besedilo"><span class="nadnapis">${g.event.club_name.toUpperCase()}</span><strong>${g.event.title}</strong>
        <span>${danInUra(g.event.start)}</span>
        <span class="gl-mesta">${prostaMesta(g)}</span></span>
      <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
    </a>`)}
  </section>`;
}

/* ---------------- detajl liste (/app/guest-lists/:id) ---------------- */
export function GuestListDetajl({ id }) {
  const [s, setS] = useState({ nalaga: true, napaka: "", g: null, vstopnica: null });
  const [povabi, setPovabi] = useState(false);
  const [odstrani, setOdstrani] = useState(null);   // { user_id, username }
  const nalozi = async (tiho = false) => {
    if (!tiho) setS(x => ({ ...x, nalaga: true, napaka: "" }));
    try {
      const [liste, vstopnice] = await Promise.all([naloziListe(), send("/me/tickets", { auth: true }).catch(() => null)]);
      const g = liste.find(x => String(x.id) === String(id)) || null;
      const v = g && Array.isArray(vstopnice) ? vstopnice.find(x => String(x.id) === String(g.my_ticket_id)) || null : null;
      setS({ nalaga: false, napaka: "", g, vstopnica: v });
    } catch (e) {
      setS(x => ({ ...x, nalaga: false, napaka: e && e.status === 404 ? "" : sporocilo(e), g: e && e.status === 404 ? null : x.g }));
    }
  };
  useEffect(() => { nalozi(); }, [id]);
  const g = s.g;
  const posodobi = nova => setS(x => ({ ...x, g: normalizirajListo(nova) }));

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Guest list")} rezerva="/app/tickets" />
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${() => nalozi()} />
    ${!s.nalaga && !s.napaka && !g ? html`<div class="prazno"><${Ikona} ime="ticket" velikost=${34} razred="modra" />
      <strong>${t("This guest list is not available")}</strong>
      <span>${t("It may have ended or been cancelled.")}</span>
      <a class="gumb-siv" href="/app/tickets">${t("Open my tickets")}</a></div>` : null}
    ${g ? html`
      <a class="kartica-vrstica gl-dogodek" href=${"/app/event/" + g.event.id}>
        <span class="vd-slika"><${Slika} src=${g.event.poster_url} sirina=${150} alt="" /></span>
        <span class="kv-besedilo"><span class="nadnapis">${g.event.club_name.toUpperCase()}</span><strong>${g.event.title}</strong>
          <span>${danInUra(g.event.start)}</span></span>
        <${Ikona} ime="chevron-right" velikost=${16} razred="utisano" />
      </a>
      ${g.note ? html`<p class="opomba-okvir"><${Ikona} ime="info" velikost=${18} />${g.note}</p>` : null}

      <section class="vstopnica gl-moja" aria-label=${t("Your QR code")}>
        <div class="gl-moja-glava"><b class="znacka-gl">${t("Guest list")}</b>
          ${s.vstopnica && s.vstopnica.status === "used" ? html`<span class="cip-plan">${t("Checked in")}</span>` : null}</div>
        ${s.vstopnica && s.vstopnica.qr && s.vstopnica.status === "valid"
          ? html`<div class="vstopnica-qr">
              <${KodaQR} vsebina=${s.vstopnica.qr} velikost=${220} oznaka=${t("Ticket QR code")} />
              <p class="opomba srednje">${t("Show this QR code at the door. Turn your screen brightness up.")}</p></div>`
          : s.vstopnica && s.vstopnica.status === "used"
            ? html`<p class="opomba srednje">${t("You are checked in.")}</p>`
            : html`<p class="opomba srednje">${t("Your QR code is in Tickets.")}</p>
              <a class="gumb-siv" href="/app/tickets">${t("Open my tickets")}</a>`}
      </section>

      <section class="blok-besedila">
        <h2 class="podnaslov">${t("Invited friends")} <span class="utisano">${g.invited.length}${g.spots ? " / " + g.spots : ""}</span></h2>
        <p class="opomba">${prostaMesta(g)}</p>
        ${g.invited.length ? g.invited.map(f => html`<div class="vrstica-osebe" key=${f.user_id}>
          <${Avatar} url=${f.avatar_url} ime=${f.username} velikost=${44} />
          <span class="kv-besedilo"><strong>${f.username}</strong></span>
          <span class="cip-plan">${f.status === "used" ? t("Checked in") : t("Invited")}</span>
          ${f.status === "used" ? null : html`<button type="button" class="krog-gumb majhen" onClick=${() => setOdstrani(f)}
            aria-label=${t("Remove {name}", { name: f.username })}><${Ikona} ime="user-minus" velikost=${16} /></button>`}
        </div>`) : html`<p class="utisano">${t("No one invited yet.")}</p>`}
      </section>

      ${g.can_invite && g.remaining > 0 ? html`<button type="button" class="gumb-glavni" onClick=${() => setPovabi(true)}>
        <${Ikona} ime="user-plus" velikost=${18} /> ${t("Invite friends")}</button>`
        : html`<p class="opomba srednje">${!g.can_invite ? t("This guest list is closed.") : t("All spots are taken. Remove a friend to free one up.")}</p>`}
    ` : null}

    ${povabi && g ? html`<${PovabiList} g=${g} zapri=${() => setPovabi(false)} posodobi=${posodobi} osvezi=${() => nalozi(true)} />` : null}
    ${odstrani && g ? html`<${OdstraniList} g=${g} f=${odstrani} zapri=${() => setOdstrani(null)} posodobi=${posodobi} osvezi=${() => nalozi(true)} />` : null}
  </div>`;
}

/* Povabi prijatelje: skupni multi-select (najvec `remaining`, ze povabljeni izkljuceni), kljukica starosti pri min_age > 0. */
function PovabiList({ g, zapri, posodobi, osvezi }) {
  const { prijatelji, napaka: napakaSeznama, znova } = usePrijatelji();
  const [izbrani, setIzbrani] = useState(() => new Set());
  const [starostOk, setStarostOk] = useState(false);
  const [mejaStreznika, setMejaStreznika] = useState(0);
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const teceRef = useRef(false);
  const [uspeh, setUspeh] = useState(null);   // imena povabljenih
  const meja = Math.max(g.event.min_age, mejaStreznika);
  const izkljuceni = new Set(g.invited.map(f => f.user_id));
  const najvec = uspeh ? 0 : g.remaining;

  async function poslji() {
    if (teceRef.current || !izbrani.size) return;
    teceRef.current = true; setTece(true); setNapaka("");
    const ids = [...izbrani];
    const imena = (prijatelji || []).filter(f => izbrani.has(f.id)).map(f => f.username);
    try {
      const telo = { user_ids: ids };
      if (meja > 0 && starostOk) telo.age_confirmed = true;
      const r = await send(`/me/guest-lists/${g.id}/invites`, { method: "POST", body: telo, auth: true });
      if (r && r.guest_list) posodobi(r.guest_list); else osvezi();
      setUspeh(imena); setIzbrani(new Set());
    } catch (e) {
      if (kodaNapake(e) === "age_confirmation_required") {
        try { const n = Number(JSON.parse(e.raw).min_age); if (n > 0) setMejaStreznika(n); } catch { /* brez */ }
      }
      setStarostOk(false);   // po neuspelem posiljanju potrditev ne velja vec
      setNapaka(sporocilo(e));
      if (e && (e.status === 409 || e.status === 404 || e.status === -1)) osvezi();   // stanje liste se je spremenilo (mesta, zaprta lista; brez odgovora so povabila morda nastala)
    }
    teceRef.current = false; setTece(false);
  }

  return html`<${List} odprt=${true} zapri=${zapri} brezZapiranja=${tece} naslov=${t("Invite friends")}>
    ${uspeh ? html`<div class="uspeh"><span class="uspeh-krog"><${Ikona} ime="check" velikost=${28} debelina=${3} /></span>
        <strong>${t("Invited {name}", { name: uspeh.join(", ") })}</strong>
        <span class="utisano">${t("Each friend gets their own QR code under Tickets.")}</span>
        <button type="button" class="gumb-glavni" onClick=${zapri}>${t("Done")}</button></div>`
    : html`
      <p class="opomba">${tn("You can invite 1 more friend.", "You can invite up to {n} more friends.", g.remaining)} ${t("Each friend gets their own ticket.")}</p>
      <${IzbiraPrijateljev} prijatelji=${prijatelji} napaka=${napakaSeznama} znova=${znova}
        izkljuceni=${izkljuceni} najvec=${najvec} izbrani=${izbrani} spremeni=${x => { setIzbrani(x); setNapaka(""); }} onemogoceno=${tece}
        meja=${meja} starostOk=${starostOk} spremeniStarost=${setStarostOk}
        prazno=${html`<div class="prazno"><${Ikona} ime="users" velikost=${34} razred="modra" />
          <strong>${t("No friends to invite")}</strong><span>${t("Only your Outly friends can be invited. Add friends first.")}</span>
          <a class="gumb-siv" href="/app/friends">${t("Add friends")}</a></div>`} />
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button type="button" class="gumb-glavni" onClick=${poslji} disabled=${tece || !izbrani.size || (meja > 0 && !starostOk)}>
        ${tece ? t("Sending...") : izbrani.size ? tn("Invite 1 friend", "Invite {n} friends", izbrani.size) : t("Invite friends")}</button>
      <button type="button" class="gumb-siv" onClick=${zapri} disabled=${tece}>${t("Cancel")}</button>`}
  <//>`;
}

/* Odstrani povabljenca (s potrditvijo): njegova vstopnica preneha veljati, mesto se sprosti. 409 = ze vpisan. */
function OdstraniList({ g, f, zapri, posodobi, osvezi }) {
  const [napaka, setNapaka] = useState("");
  const [tece, setTece] = useState(false);
  const teceRef = useRef(false);
  async function odstrani() {
    if (teceRef.current) return;
    teceRef.current = true; setTece(true); setNapaka("");
    try {
      const r = await send(`/me/guest-lists/${g.id}/invites/${encodeURIComponent(f.user_id)}`, { method: "DELETE", auth: true });
      if (r && r.guest_list) posodobi(r.guest_list); else osvezi();
      zapri(); return;
    } catch (e) {
      setNapaka(sporocilo(e));
      if (e && (e.status === 409 || e.status === 404)) osvezi();
    }
    teceRef.current = false; setTece(false);
  }
  return html`<${List} odprt=${true} zapri=${zapri} brezZapiranja=${tece} naslov=${t("Remove {name}", { name: f.username })}>
    <p class="besedilo-opis">${t("Their ticket will stop working and the spot will be free again.")}</p>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-rdec" onClick=${odstrani} disabled=${tece}>${tece ? t("Removing...") : t("Remove")}</button>
    <button type="button" class="gumb-siv" onClick=${zapri} disabled=${tece}>${t("Cancel")}</button>
  <//>`;
}
