/* Javni podatki (klubi, dogodki, zanri) - nalozeni in normalizirani enkrat, predpomnjeni za 60 s,
   da vrnitev na Home ne nalaga vsega znova. Osebni podatki gredo mimo tega (send z auth). */
import { javno, send } from "./api.js";
import { normalizirajDogodek, normalizirajKlub } from "./oblika.js";

const memo = new WeakMap();   // obljuba iz javno() -> normaliziran rezultat
function preslikaj(obljuba, fn) {
  if (!memo.has(obljuba)) memo.set(obljuba, obljuba.then(fn));
  return memo.get(obljuba);
}

export const klubi = (sveze = false) =>
  preslikaj(javno("/clubs", { sveze }), r => (Array.isArray(r) ? r : []).map(normalizirajKlub));

export const dogodki = ({ upcoming = true, clubId, sveze = false } = {}) => {
  const q = new URLSearchParams({ upcoming: String(upcoming) });
  if (clubId) q.set("clubId", String(clubId));
  return preslikaj(javno("/events?" + q, { sveze }), r => (Array.isArray(r) ? r : []).map(normalizirajDogodek));
};

export const popularniKluba = clubId =>
  preslikaj(javno(`/events?clubId=${clubId}&popular=true`), r => (Array.isArray(r) ? r : []).map(normalizirajDogodek));

export const zanri = () =>
  preslikaj(javno("/genres", { ttl: 3600e3 }), r => (r && Array.isArray(r.genres) ? r.genres : []));

export const poId = seznam => new Map(seznam.map(x => [x.id, x]));

/** Klub (zeton neobvezen -> is_following). Ni predpomnjen, ker vsebuje osebno stanje. */
export const klub = id => send(`/clubs/${id}`, { auth: "optional" }).then(normalizirajKlub);

/** Dogodek (zeton neobvezen -> my_plan, prijatelji). */
export const dogodek = id => send(`/events/${id}`, { auth: "optional" }).then(e => ({
  ...normalizirajDogodek(e),
  friends_going: Array.isArray(e.friends_going) ? e.friends_going : [],
  friends_interested: Array.isArray(e.friends_interested) ? e.friends_interested : []
}));
