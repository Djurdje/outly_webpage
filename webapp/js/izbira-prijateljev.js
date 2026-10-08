/* Skupni gradnik: izbira vec prijateljev (GET /me/friends) z mejo, izkljucenimi id-ji in kljukico starosti.
   Uporabljata ga VIP razdelitev po nakupu mize (views/vip-razdeli.js) in guest lista (views/guest-lists.js).
   Gradnik samo izbira; posiljanje (prenosi, povabila) je v klicatelju. Podatki gredo v DOM samo prek htm predloge. */
import { html, useEffect, useState } from "./lib.js";
import { t, tn } from "./i18n.js";
import { send } from "./api.js";
import { sporocilo } from "./napake.js";
import { Avatar, Ikona, Nalaganje, Napaka } from "./ui.js";

/** Prijatelji prijavljenega uporabnika: { prijatelji: null (nalaga) | [], napaka, znova }. */
export function usePrijatelji() {
  const [s, setS] = useState({ prijatelji: null, napaka: "" });
  const nalozi = () => {
    setS({ prijatelji: null, napaka: "" });
    send("/me/friends", { auth: true })
      .then(r => setS({ prijatelji: Array.isArray(r && r.friends) ? r.friends : [], napaka: "" }))
      .catch(e => setS({ prijatelji: null, napaka: sporocilo(e) }));
  };
  useEffect(() => { nalozi(); }, []);
  return { ...s, znova: nalozi };
}

/** Besedilo kljukice starosti (vedno ni vnaprej oznacena). */
export const besediloStarosti = n => t("I confirm all selected friends are at least {n} years old. They must show a valid photo ID at the door; if they are younger, the club will refuse entry.", { n });

/** Kljukica starosti: pokazi samo, ce je meja > 0. */
export function KljukicaStarosti({ meja, ok, spremeni, onemogoceno = false }) {
  if (!(meja > 0)) return null;
  return html`<label class="soglasje">
    <input type="checkbox" checked=${ok} disabled=${onemogoceno} onChange=${e => spremeni(e.target.checked)} />
    <span>${besediloStarosti(meja)}</span>
  </label>`;
}

/**
 * Seznam prijateljev z multi-selectom.
 *  prijatelji: null (nalaga) ali seznam { id, username, avatar_url }
 *  izkljuceni: Set id-jev, ki se ne ponudijo (ze povabljeni / ze poslano)
 *  najvec: koliko jih je mogoce izbrati; izbrani: Set id-jev; spremeni(novSet)
 *  meja + starostOk + spremeniStarost: kljukica starosti (meja 0 = brez)
 *  prazno: vsebina, ce prijateljev ni (privzeto kratko besedilo)
 */
export function IzbiraPrijateljev({ prijatelji, napaka, znova, izkljuceni = new Set(), najvec, izbrani, spremeni, onemogoceno = false,
  meja = 0, starostOk = false, spremeniStarost = () => {}, prazno = null }) {
  if (napaka) return html`<${Napaka} besedilo=${napaka} znova=${znova} />`;
  if (prijatelji === null) return html`<${Nalaganje} />`;
  const seznam = prijatelji.filter(f => !izkljuceni.has(f.id));
  if (!seznam.length) {
    return prazno || html`<div class="prazno"><${Ikona} ime="users" velikost=${34} razred="modra" />
      <strong>${t("No friends yet")}</strong><span>${t("Tap Add friends and search by username.")}</span></div>`;
  }
  const poln = izbrani.size >= najvec;
  const preklopi = f => {
    if (onemogoceno) return;
    const n = new Set(izbrani);
    if (n.has(f.id)) n.delete(f.id); else if (!poln) n.add(f.id);
    spremeni(n);
  };
  return html`<div class="izbira-prijateljev">
    <p class="opomba izbira-stevec" role="status">${t("{n} of {max} selected", { n: izbrani.size, max: najvec })}</p>
    <div class="izbira-seznam" role="group" aria-label=${t("Choose friends")}>
      ${seznam.map(f => {
        const izbran = izbrani.has(f.id);
        const zaklenjen = onemogoceno || (!izbran && poln);
        return html`<label class=${"izbira-vrstica" + (izbran ? " izbrana" : "") + (zaklenjen ? " zaklenjena" : "")} key=${f.id}>
          <input type="checkbox" checked=${izbran} disabled=${zaklenjen} onChange=${() => preklopi(f)} />
          <${Avatar} url=${f.avatar_url} ime=${f.username} velikost=${40} />
          <span class="kv-besedilo"><strong>${f.username}</strong></span>
          <span class="izbira-kljukica" aria-hidden="true">${izbran ? html`<${Ikona} ime="check" velikost=${16} debelina=${3} />` : null}</span>
        </label>`;
      })}
    </div>
    <${KljukicaStarosti} meja=${meja} ok=${starostOk} spremeni=${spremeniStarost} onemogoceno=${onemogoceno} />
  </div>`;
}

export const napisPosiljanja = n => (n > 0 ? tn("Send to 1 friend", "Send to {n} friends", n) : t("Send to friends"));
