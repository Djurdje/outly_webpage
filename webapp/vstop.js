/* Globoke povezave spletne aplikacije (outly.si/app/event/12 ...). Cloudflare Pages pravila
   "/app/* /app/index.html 200" iz _redirects v praksi NE uporabi (29. 9. 2026: osvezitev /app/map je
   vrnila domaco stran) - za neznano pot vrne korensko index.html (nacin SPA, ker ni 404.html).
   Ta skript je prvi v index.html: ce se domaca stran nalozi na poti /app/..., takoj preusmeri v
   lupino aplikacije, ki pot prebere iz ?pot= (usmerjanje.js). Zunanja datoteka zaradi CSP. */
(function () {
  var p = location.pathname;
  if (p.indexOf("/app/") === 0 && p !== "/app/") {
    location.replace("/app/?pot=" + encodeURIComponent(p + location.search + location.hash));
  }
})();
