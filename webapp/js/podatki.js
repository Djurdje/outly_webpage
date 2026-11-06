/* Javni podatki (klubi, dogodki, zanri) - nalozeni in normalizirani enkrat, predpomnjeni za 60 s,
   da vrnitev na Home ne nalaga vsega znova. Osebni podatki gredo mimo tega (send z auth).
   Seznami dogodkov prosijo za lite=true (backend #114/#120: brez `description`, ki je vecina teze odgovora).
   Zato objekt iz seznama NIKOLI ne gre naravnost na zaslon dogodka: ta vedno nalozi poln GET /events/:id
   (dogodek() spodaj). Star backend parametra ne pozna in vrne poln odgovor - brez razlike za odjemalca. */
import { javno, send } from "./api.js";
import { normalizirajDogodek, normalizirajKlub, normalizirajKmalu } from "./oblika.js";

const memo = new WeakMap();   // obljuba iz javno() -> normaliziran rezultat
function preslikaj(obljuba, fn) {
  if (!memo.has(obljuba)) memo.set(obljuba, obljuba.then(fn));
  return memo.get(obljuba);
}

export const klubi = (sveze = false) =>
  preslikaj(javno("/clubs", { sveze }), r => (Array.isArray(r) ? r : []).map(normalizirajKlub));

export const dogodki = ({ upcoming = true, clubId, sveze = false } = {}) => {
  const q = new URLSearchParams({ upcoming: String(upcoming), lite: "true" });
  if (clubId) q.set("clubId", String(clubId));
  return preslikaj(javno("/events?" + q, { sveze }), r => (Array.isArray(r) ? r : []).map(normalizirajDogodek));
};

export const popularniKluba = clubId =>
  preslikaj(javno(`/events?clubId=${clubId}&popular=true&lite=true`), r => (Array.isArray(r) ? r : []).map(normalizirajDogodek));

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

/* Klubi "Coming soon" (backend GET /coming-soon, javno). Napaka, 404 (star backend) ali prazno = prazen seznam: razdelek se tiho
   skrije. Neuspeh se predpomni enako dolgo kot uspeh (5 min, kot Cache-Control strezniske poti), da Home ne ponavlja klica. */
let kmaluVpis = null;
export function kmalu(sveze = false) {
  const zdaj = Date.now();
  if (!sveze && kmaluVpis && zdaj - kmaluVpis.cas < 300e3) return kmaluVpis.obljuba;
  const obljuba = send("/coming-soon").then(normalizirajKmalu).catch(() => []);
  kmaluVpis = { cas: zdaj, obljuba };
  return obljuba;
}
/** Za Home: pocakamo najvec 2 s (sicer bi pocasen odgovor zadrzal cel zaslon); pozni odgovor se pokaze ob naslednjem obisku. */
export const kmaluHitro = (sveze = false) => Promise.race([kmalu(sveze), new Promise(r => setTimeout(() => r([]), 2000))]);
