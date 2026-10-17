/* Stripe (backend issue #19): Checkout (placilo vstopnic/miz) in Connect Express (klub sprejema placila).
   Kartice NIKOLI ne vnasamo v nas vmesnik - kupec placa na Stripovi gostovani strani, na katero samo preusmerimo.
   Preusmerimo SAMO na Stripova gostitelja, ki ju backend res vraca (URL pride iz backenda, a varovalo ne skodi: odprta
   preusmeritev bi bila phishing; npr. buy.stripe.com je Payment Link, ki ga lahko ustvari kdorkoli s Stripovim racunom):
   - checkout.stripe.com: Checkout seja (checkout_url pri nakupu vstopnic, miz, gosta);
   - connect.stripe.com: Connect Express - onboarding (accountLinks) in nadzorna plosca kluba (createLoginLink).
   Samo https, brez uporabnika/gesla v URL-ju in brez tujih vrat. */
const STRIPE_GOSTITELJI = new Set(["checkout.stripe.com", "connect.stripe.com"]);
export function jeStripeUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" && STRIPE_GOSTITELJI.has(u.hostname) && u.port === "" && u.username === "" && u.password === "";
  } catch { return false; }
}

/** Preusmeri na Stripovo stran. Vrne false, ce URL ni Stripov (klicatelj pokaze napako). */
export function odpriStripe(url) {
  if (!jeStripeUrl(url)) return false;
  window.location.assign(url);
  return true;
}

/* Izid odgovora nakupa (POST .../orders; backend #149, pogodba 10. 10. 2026, 2 in 2b):
   "preusmeri" = stripe + veljaven checkout_url (odpri Stripe);
   "obdelava"  = payment_processing (odlozeno placilo: kupec je placal, banka se ni potrdila) - NI potekla seja, povezave ni;
   "poteklo"   = checkout_expired: Stripa NE odpiramo;
   "nepripravljeno" = pending brez povezave, brez poteka in brez obdelave (seja se ustvarja);
   "uspeh"     = vse ostalo (testni nacin, 0 EUR pri klubu s Stripom: mode "stripe", paid, tickets polne, checkout_url null).
   Potekla povezava nikoli ne gre na Stripe, tudi ce bi jo star odjemalec dobil. */
export function izidStripeNakupa(r) {
  if (!r || r.mode !== "stripe") return "uspeh";
  const o = r.order || {};
  if (o.status === "pending" && o.payment_processing === true) return "obdelava";
  if (o.checkout_expired === true) return "poteklo";
  if (r.checkout_url) return "preusmeri";
  return o.status === "pending" ? "nepripravljeno" : "uspeh";
}
