/* Koren outly.si ("/"): vhod v spletno aplikacijo. Od 23. 10. 2026 je domaca stran aplikacija (/app/), dosedanja
   domaca stran (landing, waitlist, tocke, Creator) je na /about (Martin, 23. 10. 2026). Zunanja datoteka zaradi CSP.
   - ?ref=KODA ali katerikoli #hash -> /about (stara vabila outly.si/?ref=KODA, povezave z index.html#waitlist,
     povratek iz potrditvenega maila Supabase #access_token=... / #type=recovery, ki ga obdela auth.js na /about);
   - sicer -> /app/ z ohranjenim ?query (npr. utm_*).
   Ista logika velja za neznano pot: Cloudflare ji vrne korensko index.html (glej vstop.js), globoke povezave /app/...
   je ze prestregel vstop.js (prvi skript). replace(): koren ne ostane v zgodovini, gumb Nazaj ne zanka. */
(function () {
  var p = location.pathname;
  if (p.indexOf("/app/") === 0 && p !== "/app/") return;      // vstop.js je ze preusmeril
  var q = new URLSearchParams(location.search);
  var landing = location.hash.length > 1 || q.has("ref");     // "#" brez imena ni povezava na razdelek
  if (landing) location.replace("/about" + location.search + location.hash);
  else location.replace("/app/" + location.search);
})();
