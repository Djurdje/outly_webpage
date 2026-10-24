/* www.outly.si -> outly.si (enak path, ?query in #hash). Zakaj: localStorage je ločen po izvoru, seja Supabase (sb-...-auth-token)
   pa je v njem. Kdor se prijavi na outly.si in potem odpre www.outly.si (povezava iz Instagrama/Googla, samodopolnitev v
   Safariju), vidi odjavljeno aplikacijo - v resnici je to drug izvor z drugo (prazno) shrambo. 24. 10. 2026 sta oba izvora
   vrnila 200 brez preusmeritve. Cloudflare Pages _redirects domen ne loči (dokumentacija: "domain-level redirects" niso
   podprti), zato je to varovalo v skriptu; prava rešitev je Bulk Redirect v Cloudflare (www -> apex, 301), glej STATE/poročilo.
   OPOZORILO: Bulk Redirect preusmeri TUDI PWA, ki je bila na začetni zaslon dodana z www.outly.si (njen izvor je www): vsi taki
   uporabniki bi izgubili sejo (shramba je po izvoru) in bi se morali prijaviti znova, nato pa aplikacijo na outly.si dodati na
   začetni zaslon na novo. Skript v standalone načinu zato ne preusmerja; Bulk Redirect tega razlikovanja nima.
   MORA biti prvi skript na vsaki strani, ki bere shrambo (preden karkoli prebere localStorage). Zunanja datoteka zaradi CSP. */
(function () {
  if (location.hostname !== "www.outly.si") return;
  // Namescena aplikacija (PWA, dodana z www) ima SVOJO shrambo na izvoru www.outly.si: preusmeritev bi jo ob vsakem zagonu
  // odpeljala na outly.si z drugo (prazno) shrambo. Tu ostane; prijava je v tej shrambi.
  try { if ((window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true) return; } catch (e) { /* brez */ }
  document.documentElement.hidden = true;   // stran naj ne blisne pred preusmeritvijo
  location.replace("https://outly.si" + location.pathname + location.search + location.hash);
})();
