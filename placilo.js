/* Povratna stran Stripe Checkouta: /placilo?stanje=uspeh|preklic&app=ios&narocilo=OUT-XXXX
   iOS: preusmeri na outly://placilo (callback shema ASWebAuthenticationSession, outly-app #60).
   Splet: preusmeri v /app. Nic ne potrjuje - placilo potrdi backend (webhook). Vhod je iz URL-ja, zato samo besedilo (textContent). */
(function () {
  var q = new URLSearchParams(location.search);
  var preklic = q.get("stanje") === "preklic";
  var ref = String(q.get("narocilo") || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  var ios = q.get("app") === "ios";
  var cilj = ios
    ? "outly://placilo?stanje=" + (preklic ? "preklic" : "uspeh") + "&narocilo=" + encodeURIComponent(ref)
    : (preklic ? "/app/" : "/app/tickets?placilo=uspeh&narocilo=" + encodeURIComponent(ref));
  if (preklic) {
    document.getElementById("naslov").textContent = "Payment cancelled";
    document.getElementById("besedilo").textContent = "Nothing was charged. Returning you to Outly…";
  }
  var gumb = document.getElementById("nazaj");
  gumb.setAttribute("href", cilj);
  if (ios) gumb.textContent = "Open Outly";
  location.replace(cilj);
})();
