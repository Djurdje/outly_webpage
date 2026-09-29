/* Prijatelji (MyFriendsView.swift) in nacrti prijateljev (FriendsPlansSection.swift).
   Prijateljstvo je simetricno; o tujem uporabniku se vidi samo id, uporabnisko ime in avatar (I11). */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { sporocilo } from "../napake.js";
import { naloziMe } from "../seja.js";
import { navigiraj } from "../usmerjanje.js";
import { normalizirajDogodek, seJeKoncal, danKratek, cena } from "../oblika.js";
import { GlavaNazaj, Ikona, Avatar, Slika, Nalaganje, Napaka, List, NaslovSekcije } from "../ui.js";

/* ---------------- My friends ---------------- */
export function MojiPrijatelji() {
  const [s, setS] = useState({ nalaga: true, napaka: null, friends: [], requests_in: [], requests_out: [] });
  const [dodajanje, setDodajanje] = useState(false);
  const [odstrani, setOdstrani] = useState(null);
  const [zaseden, setZaseden] = useState(null);
  const nalozi = async () => {
    try {
      const r = await send("/me/friends", { auth: true });
      setS({ nalaga: false, napaka: null, friends: r.friends || [], requests_in: r.requests_in || [], requests_out: r.requests_out || [] });
    } catch (e) { setS(x => ({ ...x, nalaga: false, napaka: sporocilo(e) })); }
  };
  useEffect(() => { nalozi(); }, []);

  async function dejanje(kljuc, pot, metoda = "POST") {
    setZaseden(kljuc);
    try { await send(pot, { method: metoda, auth: true }); await nalozi(); naloziMe(); }
    catch (e) { setS(x => ({ ...x, napaka: sporocilo(e) })); }
    setZaseden(null);
  }

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("My friends")} rezerva="/app/profile" />
    <button type="button" class="gumb-glavni" onClick=${() => setDodajanje(true)}><${Ikona} ime="user-plus" velikost=${18} /> ${t("Add friends")}</button>
    <p class="opomba">${t("Friends can see which events you're going to.")}</p>
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />

    ${s.requests_in.length ? html`<section class="blok-besedila">
      <h2 class="podnaslov">${t("Friend requests")}</h2>
      ${s.requests_in.map(r => html`<div class="vrstica-osebe" key=${"in" + r.id}>
        <${Avatar} url=${r.user.avatar_url} ime=${r.user.username} velikost=${44} />
        <span class="kv-besedilo"><strong>${r.user.username}</strong><span>${t("wants to be your friend")}</span></span>
        <button type="button" class="gumb-majhen modri" disabled=${zaseden === "in" + r.id}
          onClick=${() => dejanje("in" + r.id, `/me/friends/requests/${r.id}/accept`)}>${t("Accept")}</button>
        <button type="button" class="gumb-majhen" disabled=${zaseden === "in" + r.id}
          onClick=${() => dejanje("in" + r.id, `/me/friends/requests/${r.id}/decline`)}>${t("Decline")}</button>
      </div>`)}
    </section>` : null}

    ${s.friends.length ? html`<section class="blok-besedila">
      <h2 class="podnaslov">${t("Friends")} <span class="utisano">${s.friends.length}</span></h2>
      ${s.friends.map(f => html`<div class="vrstica-osebe" key=${"f" + f.id}>
        <${Avatar} url=${f.avatar_url} ime=${f.username} velikost=${44} />
        <span class="kv-besedilo"><strong>${f.username}</strong></span>
        <button type="button" class="krog-gumb majhen" onClick=${() => setOdstrani(f)} aria-label=${t("Remove friend") + " " + f.username}><${Ikona} ime="user-minus" velikost=${16} /></button>
      </div>`)}
    </section>` : !s.nalaga && !s.requests_in.length && !s.requests_out.length ? html`<div class="prazno">
      <${Ikona} ime="users" velikost=${34} razred="modra" />
      <strong>${t("No friends yet")}</strong><span>${t("Tap Add friends and search by username.")}</span></div>` : null}

    ${s.requests_out.length ? html`<section class="blok-besedila">
      <h2 class="podnaslov">${t("Sent requests")}</h2>
      ${s.requests_out.map(r => html`<div class="vrstica-osebe" key=${"out" + r.id}>
        <${Avatar} url=${r.user.avatar_url} ime=${r.user.username} velikost=${44} />
        <span class="kv-besedilo"><strong>${r.user.username}</strong><span>${t("Requested")}</span></span>
        <button type="button" class="gumb-majhen" disabled=${zaseden === "out" + r.id}
          onClick=${() => dejanje("out" + r.id, `/me/friends/requests/${r.id}`, "DELETE")}>${t("Cancel")}</button>
      </div>`)}
    </section>` : null}

    ${dodajanje ? html`<${DodajPrijatelje} odprt=${true} zapri=${() => { setDodajanje(false); nalozi(); }} />` : null}
    <${List} odprt=${!!odstrani} zapri=${() => setOdstrani(null)} naslov=${t("Remove friend")}>
      <p class="besedilo-opis">${t("You will no longer see each other's plans. You can add them again later.")}</p>
      <button type="button" class="gumb-rdec" onClick=${async () => { const f = odstrani; setOdstrani(null); await dejanje("f" + f.id, `/me/friends/${f.id}`, "DELETE"); }}>${t("Remove")}</button>
      <button type="button" class="gumb-siv" onClick=${() => setOdstrani(null)}>${t("Cancel")}</button>
    <//>
  </div>`;
}

/* Iskanje po uporabniskem imenu (GET /users/search, od 2 znakov) in poslji prosnjo. */
function DodajPrijatelje({ odprt, zapri }) {
  const [q, setQ] = useState("");
  const [rez, setRez] = useState(null);
  const [napaka, setNapaka] = useState("");
  const [poslano, setPoslano] = useState({});
  const st = useRef(0);   // stanje je sveze ob vsakem odprtju (list se izrise na novo)
  useEffect(() => {
    const iskano = q.trim();
    if (iskano.length < 2 || !/^[A-Za-z0-9_]+$/.test(iskano)) { setRez(null); return; }
    const moj = ++st.current;
    const cas = setTimeout(async () => {
      try { const r = await send("/users/search?q=" + encodeURIComponent(iskano), { auth: true }); if (moj === st.current) { setRez(r.users || []); setNapaka(""); } }
      catch (e) { if (moj === st.current) setNapaka(sporocilo(e)); }
    }, 300);
    return () => clearTimeout(cas);
  }, [q]);

  async function prosi(u) {
    setPoslano(p => ({ ...p, [u.id]: "tece" }));
    try {
      const r = await send("/me/friends/requests", { method: "POST", body: { user_id: u.id }, auth: true });
      setPoslano(p => ({ ...p, [u.id]: r && r.friend ? "friends" : "request_sent" }));
    } catch (e) { setPoslano(p => ({ ...p, [u.id]: undefined })); setNapaka(sporocilo(e)); }
  }
  const stanje = u => poslano[u.id] || u.relation;
  const napis = { friends: t("Friends"), request_sent: t("Requested"), request_received: t("Wants to be your friend") };

  return html`<${List} odprt=${odprt} zapri=${zapri} naslov=${t("Add friends")}>
    <div class="iskalno-polje"><${Ikona} ime="search" velikost=${18} razred="utisano" />
      <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder=${t("Search by username")}
        aria-label=${t("Search by username")} autocapitalize="off" spellcheck="false" autocomplete="off" /></div>
    ${q.trim().length < 2 ? html`<p class="opomba">${t("Type at least 2 letters of a username.")}</p>` : null}
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    ${rez && !rez.length ? html`<p class="utisano">${t("No one with that username.")}</p>` : null}
    ${(rez || []).map(u => html`<div class="vrstica-osebe" key=${u.id}>
      <${Avatar} url=${u.avatar_url} ime=${u.username} velikost=${40} />
      <span class="kv-besedilo"><strong>${u.username}</strong></span>
      ${stanje(u) === "none"
        ? html`<button type="button" class="gumb-majhen modri" onClick=${() => prosi(u)}><${Ikona} ime="user-plus" velikost=${14} /> ${t("Add")}</button>`
        : stanje(u) === "tece" ? html`<span class="utisano">…</span>`
        : html`<span class="cip-plan">${napis[stanje(u)] || ""}</span>`}
    </div>`)}
  <//>`;
}

/* ---------------- Nacrti prijateljev ---------------- */
export async function naloziNacrte() {
  const r = await send("/me/friends/plans", { auth: true });
  const videni = new Set();
  return ((r && r.events) || []).map(e => ({
    ...normalizirajDogodek(e),
    friends: Array.isArray(e.friends) ? e.friends : [],
    interested: Array.isArray(e.interested) ? e.interested : []
  })).filter(p => !seJeKoncal(p) && !videni.has(p.id) && videni.add(p.id));
}

async function deliPovabilo() {
  const url = "https://outly.si";
  const besedilo = t("Join me on Outly — see where we're going out.");
  if (navigator.share) { try { await navigator.share({ text: besedilo, url }); } catch { /* preklicano */ } return; }
  try { await navigator.clipboard.writeText(`${besedilo} ${url}`); alert(t("Link copied")); } catch { prompt(t("Copy this link"), url); }
}

/** Razdelek "Friends plans" na Home: krogi prijateljev (moder rob = gre, bel = zanima), Invite more, View. */
export function SekcijaNacrtov({ nacrti }) {
  const gredo = [], zanima = [], videni = new Set();
  for (const p of nacrti) for (const f of p.friends) if (!videni.has(f.id)) { videni.add(f.id); gredo.push(f); }
  for (const p of nacrti) for (const f of p.interested) if (!videni.has(f.id)) { videni.add(f.id); zanima.push(f); }
  const vsi = [...gredo.map(f => ({ f, gre: true })), ...zanima.map(f => ({ f, gre: false }))];
  const NAJVEC = 8;
  return html`<section class="sekcija">
    <${NaslovSekcije} naslov=${t("Friends plans")} desno=${html`<a class="vec modra" href="/app/friends-plans">${t("View")}</a>`} />
    <div class="vrsta-drsna prijatelji">
      ${vsi.slice(0, NAJVEC).map(({ f, gre }) => html`<a key=${f.id} href="/app/friends-plans" class=${"krog-prijatelja" + (gre ? " gre" : "")} aria-label=${f.username}>
        <${Avatar} url=${f.avatar_url} ime=${f.username} velikost=${49} /></a>`)}
      ${vsi.length > NAJVEC ? html`<a href="/app/friends-plans" class="krog-prijatelja vec-krog">+${vsi.length - NAJVEC}</a>` : null}
      ${!vsi.length ? html`<span class="opomba namig">${t("Add friends to see where they're going")}</span>` : null}
      <button type="button" class="povabi" onClick=${deliPovabilo}><span class="povabi-krog"><${Ikona} ime="plus" velikost=${12} /></span><span>${t("Invite more")}</span></button>
    </div>
  </section>`;
}

const povzetek = (gredo, zanima) => {
  const d = [];
  if (gredo.length === 1) d.push(t("{a} going", { a: gredo[0].username }));
  else if (gredo.length === 2) d.push(t("{a}, {b} going", { a: gredo[0].username, b: gredo[1].username }));
  else if (gredo.length > 2) d.push(t("{a}, {b} + {n} going", { a: gredo[0].username, b: gredo[1].username, n: gredo.length - 2 }));
  if (zanima.length) d.push(t("{n} interested", { n: zanima.length }));
  return d.join(" · ");
};

/** Zaslon "Friends plans" (FriendsPlansView): filter All / Going / Interested, kartice dogodkov. */
export function NacrtiPrijateljev() {
  const [s, setS] = useState({ nalaga: true, napaka: null, nacrti: [] });
  const [filter, setFilter] = useState("all");
  const nalozi = () => naloziNacrte().then(n => setS({ nalaga: false, napaka: null, nacrti: n })).catch(e => setS({ nalaga: false, napaka: sporocilo(e), nacrti: [] }));
  useEffect(() => { nalozi(); }, []);
  const prikazani = s.nacrti.filter(p => filter === "all" || (filter === "going" ? p.friends.length : p.interested.length));
  const FILTRI = [["all", t("All")], ["going", t("Going")], ["interested", t("Interested")]];
  return html`<div class="zaslon">
    <${GlavaNazaj} />
    <div class="srednje"><h1 class="velik-naslov">${t("Friends plans")}</h1><p class="utisano">${t("See where your friends are going.")}</p></div>
    <div class="vrsta-cipov" role="tablist">${FILTRI.map(([k, n]) => html`<button type="button" role="tab" aria-selected=${filter === k}
      class=${"cip-filtra" + (filter === k ? " izbran" : "")} onClick=${() => setFilter(k)}>${n}</button>`)}</div>
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${!s.nalaga && !prikazani.length && !s.napaka ? html`<div class="prazno"><${Ikona} ime="users" velikost=${34} razred="modra" />
      <strong>${t("No plans yet")}</strong><span>${t("When a friend gets a ticket, the event shows up here.")}</span></div>` : null}
    ${prikazani.map(p => html`<div class="kartica-nacrta" key=${p.id}>
      <a class="kn-vrh" href=${"/app/event/" + p.id}>
        <span class="vd-slika"><${Slika} src=${p.poster_url} sirina=${150} alt="" /></span>
        <span class="kv-besedilo"><strong>${p.title}</strong><span>${[p.club_name, danKratek(p._zacetek)].filter(Boolean).join(" · ")}</span></span>
      </a>
      <div class="prijatelji-vrsta">
        <span class="avatarji">${[...p.friends, ...p.interested].slice(0, 4).map(f => html`<${Avatar} key=${f.id} url=${f.avatar_url} ime=${f.username} velikost=${28} />`)}</span>
        <span>${povzetek(p.friends, p.interested)}</span>
      </div>
      <div class="kn-gumba">
        ${p.ticket_price_cents != null && p.my_plan !== "going"
          ? html`<a class="gumb-glavni majhen" href=${`/app/event/${p.id}?buy=1`}>${t("Join them")}${cena(p) ? " · " + cena(p) : ""}</a>` : null}
        <a class="gumb-siv majhen" href=${"/app/event/" + p.id}>${t("View event")}</a>
      </div>
    </div>`)}
  </div>`;
}
