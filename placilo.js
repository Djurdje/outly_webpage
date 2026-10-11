/* Povratna stran Stripe Checkouta: /placilo?stanje=uspeh|preklic&app=ios&narocilo=OUT-XXXX
   iOS: preusmeri na outly://placilo (callback shema ASWebAuthenticationSession, outly-app #60).
   Splet: preusmeri v /app. Nic ne potrjuje - placilo potrdi backend (webhook). Vhod je iz URL-ja, zato samo besedilo (textContent).
   Jezik (ZVPot-1 7/1: nakupne informacije v slovenscini): izbira iz spletne aplikacije (localStorage outly_jezik, isti kljuc kot
   webapp/js/i18n.js), sicer prvi jezik brskalnika; slovenscina samo, ce je to ta jezik, sicer anglescina (kot /app in iOS). */
(function () {
  var q = new URLSearchParams(location.search);
  var preklic = q.get("stanje") === "preklic";
  var ref = String(q.get("narocilo") || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  var ios = q.get("app") === "ios";
  var cilj = ios
    ? "outly://placilo?stanje=" + (preklic ? "preklic" : "uspeh") + "&narocilo=" + encodeURIComponent(ref)
    : (preklic ? "/app/" : "/app/tickets?placilo=uspeh&narocilo=" + encodeURIComponent(ref));

  var jezik = "en";
  try {
    var shranjen = localStorage.getItem("outly_jezik");
    if (shranjen === "en" || shranjen === "sl") jezik = shranjen;
    else {
      var prvi = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
      if (String(prvi).toLowerCase().indexOf("sl") === 0) jezik = "sl";
    }
  } catch (e) { /* brez shrambe: anglescina */ }
  var BESEDILA = {
    en: { naslovUspeh: "Payment received", naslovPreklic: "Payment cancelled", vracamo: "Returning you to Outly\u2026",
      preklic: "Nothing was charged. Returning you to Outly\u2026", nazaj: "Back to Outly", odpri: "Open Outly", title: "Payment \u2013 Outly" },
    sl: { naslovUspeh: "Pla\u010dilo prejeto", naslovPreklic: "Pla\u010dilo preklicano", vracamo: "Vra\u010damo te v Outly \u2026",
      preklic: "Ni\u010d ti ni bilo zara\u010dunano. Vra\u010damo te v Outly \u2026", nazaj: "Nazaj v Outly", odpri: "Odpri Outly", title: "Pla\u010dilo \u2013 Outly" }
  }[jezik];
  document.documentElement.setAttribute("lang", jezik);
  document.title = BESEDILA.title;
  document.getElementById("naslov").textContent = preklic ? BESEDILA.naslovPreklic : BESEDILA.naslovUspeh;
  document.getElementById("besedilo").textContent = preklic ? BESEDILA.preklic : BESEDILA.vracamo;
  var gumb = document.getElementById("nazaj");
  gumb.setAttribute("href", cilj);
  gumb.textContent = ios ? BESEDILA.odpri : BESEDILA.nazaj;
  location.replace(cilj);
})();
