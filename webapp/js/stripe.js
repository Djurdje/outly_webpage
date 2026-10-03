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
