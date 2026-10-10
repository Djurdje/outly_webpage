/* Prijava zlorabe (Report) in blokiranje uporabnikov (backend #189; Apple App Review 1.2).
   - PrijavaList: list z razlogi + neobvezno besedilo -> POST /reports (klub, dogodek).
   - OsebaMeni: meni ob osebi (prijatelj, prosnja): Report / Block.
   - BlokiraniUporabniki: seznam blokiranih z Unblock (GET/DELETE /me/blocks).
   Vsi klici prek send(); napake prek zlorabaSporocilo(). Podatki gredo v DOM samo prek htm. */
import { html, useEffect, useState } from "../lib.js";
import { t } from "../i18n.js";
import { send } from "../api.js";
import { zlorabaSporocilo } from "../napake.js";
import { varenUrl } from "../oblika.js";
import { GlavaNazaj, Ikona, Avatar, List, Nalaganje, Napaka } from "../ui.js";

const RAZLOGI = [
  ["spam", "Spam or scam"],
  ["harassment", "Harassment or bullying"],
  ["inappropriate", "Inappropriate or offensive content"],
  ["impersonation", "Impersonation or fake account"],
  ["illegal", "Illegal activity"],
  ["other", "Something else"]
];
const NAJVEC_ZNAKOV = 1000;

/* ---------------- Obrazec prijave (vsebina lista) ---------------- */
function ObrazecPrijave({ tip, id, zapri }) {
  const [razlog, setRazlog] = useState("");
  const [podrobnosti, setPodrobnosti] = useState("");
  const [tece, setTece] = useState(false);
  const [napaka, setNapaka] = useState("");
  const [poslano, setPoslano] = useState(false);

  async function poslji() {
    if (!razlog || tece) return;
    setTece(true); setNapaka("");
    const body = { target_type: tip, target_id: Number(id), reason: razlog };
    const d = podrobnosti.trim();
    if (d) body.details = d;
    try { await send("/reports", { method: "POST", body, auth: true }); setPoslano(true); }
    catch (e) { setNapaka(zlorabaSporocilo(e)); }
    setTece(false);
  }

  if (poslano) return html`<div class="prazno prijava-uspeh">
    <${Ikona} ime="circle-check" velikost=${34} razred="modra" />
    <strong>${t("Thanks — we review reports within 24 hours.")}</strong>
    <button type="button" class="gumb-siv" onClick=${zapri}>${t("Done")}</button>
  </div>`;

  return html`<div class="obrazec-prijave">
    <p class="besedilo-opis">${t("What's the problem?")}</p>
    <div class="razlogi" role="radiogroup" aria-label=${t("What's the problem?")}>
      ${RAZLOGI.map(([k, napis]) => html`<label class=${"razlog" + (razlog === k ? " izbran" : "")} key=${k}>
        <input type="radio" name="razlog" value=${k} checked=${razlog === k} onChange=${() => setRazlog(k)} />
        <span>${t(napis)}</span>
        ${razlog === k ? html`<${Ikona} ime="check" velikost=${18} debelina=${2.6} />` : null}
      </label>`)}
    </div>
    <label class="polje-oznaceno">${t("Details (optional)")}
      <textarea rows="4" maxlength=${NAJVEC_ZNAKOV} value=${podrobnosti} onInput=${e => setPodrobnosti(e.target.value)}
        placeholder=${t("Tell us more")}></textarea>
      <span class="opomba brojilec">${podrobnosti.length}/${NAJVEC_ZNAKOV}</span>
    </label>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <button type="button" class="gumb-glavni" disabled=${!razlog || tece} onClick=${poslji}>${tece ? t("Sending...") : t("Send report")}</button>
  </div>`;
}

/** Report kluba ali dogodka: tip "club" | "event", id = id cilja. */
export function PrijavaList({ odprt, zapri, tip, id }) {
  return html`<${List} odprt=${odprt} zapri=${zapri} naslov=${t("Report")}>
    <${ObrazecPrijave} tip=${tip} id=${id} zapri=${zapri} />
  <//>`;
}

/* ---------------- Meni ob osebi: Report / Block ---------------- */
/** oseba = { id, username }; obBlokiran() po uspesnem bloku (zaslon osvezi seznam). */
export function OsebaMeni({ oseba, zapri, obBlokiran }) {
  const [korak, setKorak] = useState("meni");   // "meni" | "prijava" | "blok"
  const [tece, setTece] = useState(false);
  const [napaka, setNapaka] = useState("");

  async function blokiraj() {
    if (tece) return;
    setTece(true); setNapaka("");
    try {
      await send(`/me/blocks/${encodeURIComponent(oseba.id)}`, { method: "POST", auth: true });
      zapri();
      obBlokiran && obBlokiran();
      return;
    } catch (e) { setNapaka(zlorabaSporocilo(e)); }
    setTece(false);
  }

  const naslov = korak === "prijava" ? t("Report") : korak === "blok" ? t("Block {name}?", { name: oseba.username }) : oseba.username;
  return html`<${List} odprt=${true} zapri=${zapri} naslov=${naslov} brezZapiranja=${tece}>
    ${korak === "meni" ? html`<div class="seznam-kartica">
      <button type="button" class="menijska-vrstica" onClick=${() => setKorak("prijava")}>
        <${Ikona} ime="flag" /><span>${t("Report")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></button>
      <button type="button" class="menijska-vrstica rdeca" onClick=${() => setKorak("blok")}>
        <${Ikona} ime="ban" /><span>${t("Block")}</span><${Ikona} ime="chevron-right" velikost=${16} razred="utisano" /></button>
    </div>` : null}
    ${korak === "prijava" ? html`<${ObrazecPrijave} tip="user" id=${oseba.id} zapri=${zapri} />` : null}
    ${korak === "blok" ? html`<div class="obrazec-prijave">
      <p class="besedilo-opis">${t("They won't be able to find you or send you requests. They won't be notified.")}</p>
      ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
      <button type="button" class="gumb-rdec" disabled=${tece} onClick=${blokiraj}>${tece ? t("Sending...") : t("Block")}</button>
      <button type="button" class="gumb-siv" disabled=${tece} onClick=${() => { setNapaka(""); setKorak("meni"); }}>${t("Cancel")}</button>
    </div>` : null}
  <//>`;
}

/* ---------------- Blokirani uporabniki ---------------- */
export function BlokiraniUporabniki() {
  const [s, setS] = useState({ nalaga: true, napaka: null, seznam: [] });
  const [zasedeni, setZasedeni] = useState(new Set());
  const [napakaVrstice, setNapakaVrstice] = useState("");
  const nalozi = async () => {
    setS(x => ({ ...x, nalaga: true, napaka: null }));
    try {
      const r = await send("/me/blocks", { auth: true });
      setS({ nalaga: false, napaka: null, seznam: Array.isArray(r && r.blocks) ? r.blocks : [] });
    } catch (e) { setS({ nalaga: false, napaka: zlorabaSporocilo(e), seznam: [] }); }
  };
  useEffect(() => { nalozi(); }, []);

  async function odblokiraj(b) {
    if (zasedeni.has(b.user_id)) return;
    setZasedeni(z => new Set(z).add(b.user_id)); setNapakaVrstice("");
    try {
      await send(`/me/blocks/${encodeURIComponent(b.user_id)}`, { method: "DELETE", auth: true });
      setS(x => ({ ...x, seznam: x.seznam.filter(y => y.user_id !== b.user_id) }));
    } catch (e) { setNapakaVrstice(zlorabaSporocilo(e)); }
    setZasedeni(z => { const n = new Set(z); n.delete(b.user_id); return n; });
  }

  return html`<div class="zaslon">
    <${GlavaNazaj} naslov=${t("Blocked users")} rezerva="/app/account/preferences" />
    <p class="opomba">${t("Blocked people can't find you or send you requests. They aren't notified.")}</p>
    ${s.nalaga ? html`<${Nalaganje} />` : null}
    <${Napaka} besedilo=${s.napaka} znova=${nalozi} />
    ${napakaVrstice ? html`<p class="napaka-besedilo" role="alert">${napakaVrstice}</p>` : null}
    ${!s.nalaga && !s.napaka && !s.seznam.length ? html`<div class="prazno">
      <${Ikona} ime="ban" velikost=${34} razred="modra" />
      <strong>${t("You haven't blocked anyone.")}</strong></div>` : null}
    ${s.seznam.map(b => html`<div class="vrstica-osebe" key=${b.user_id}>
      <${Avatar} url=${varenUrl(b.avatar_url) || ""} ime=${String(b.username || "")} velikost=${44} />
      <span class="kv-besedilo"><strong>${b.username}</strong></span>
      <button type="button" class="gumb-majhen" disabled=${zasedeni.has(b.user_id)} onClick=${() => odblokiraj(b)}
        aria-label=${t("Unblock") + " " + b.username}>${t("Unblock")}</button>
    </div>`)}
  </div>`;
}
