/* Stripe (backend issue #19): Checkout (placilo vstopnic/miz) in Connect Express (klub sprejema placila).
   Kartice NIKOLI ne vnasamo v nas vmesnik - kupec placa na Stripovi gostovani strani, na katero samo preusmerimo.
   Preusmerimo SAMO na https *.stripe.com (URL pride iz backenda, a varovalo ne skodi: odprta preusmeritev bi bila phishing). */
export function jeStripeUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com"));
  } catch { return false; }
}

/** Preusmeri na Stripovo stran. Vrne false, ce URL ni Stripov (klicatelj pokaze napako). */
export function odpriStripe(url) {
  if (!jeStripeUrl(url)) return false;
  window.location.assign(url);
  return true;
}

/* Izid odgovora nakupa (POST .../orders; backend #149, pogodba 10. 10. 2026):
   "preusmeri" = stripe + veljaven checkout_url (odpri Stripe); "poteklo" = Stripova seja je potekla ali je ni (pending brez
   povezave): Stripa NE odpiramo; "uspeh" = vse ostalo (testni nacin, 0 EUR pri klubu s Stripom: mode "stripe", paid, tickets polne,
   checkout_url null). Potekla povezava nikoli ne gre na Stripe, tudi ce bi jo star odjemalec dobil. */
export function izidStripeNakupa(r) {
  if (!r || r.mode !== "stripe") return "uspeh";
  const o = r.order || {};
  if (o.checkout_expired === true) return "poteklo";
  if (r.checkout_url) return "preusmeri";
  return o.status === "pending" ? "poteklo" : "uspeh";
}
