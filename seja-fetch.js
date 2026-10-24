/* Zaščita seje Supabase pred "napačnimi" odjavami (24. 10. 2026, Martin: aplikacija ga odjavi ob vsakem odprtju).
   Uporabljata ga oba odjemalca Supabase na outly.si (webapp/js/supabase.js in auth.js) kot `global.fetch`.

   Problem: supabase-js ob NEUSPELI osvežitvi žetona (POST /auth/v1/token?grant_type=refresh_token) sejo IZBRIŠE iz
   localStorage, razen če je napaka "ponovljiva" (omrežje, 500-504, 520-530). Vsak drug neuspeh - 429 (omejitev klicev),
   403/400 s HTML-jem ali brez kode (proxy, zasebni prenos, vgrajen brskalnik), nepričakovan 4xx - zato uporabnika odjavi,
   čeprav streznik seje sploh ni zavrnil.

   Rešitev: odgovor osvežitve, ki NI uspeh in NI dokončna zavrnitev seje, se spremeni v omrežno napako (TypeError, kot
   "Failed to fetch"). supabase-js jo obravnava kot AuthRetryableFetchError: ponovi, seje NE izbriše, uporabnik ostane
   prijavljen (invarianta I10: izpad ali zmeda Supabase ne odjavi uporabnikov).
   Dokončna zavrnitev = Supabase je sejo res ukinil (sprememba gesla, odjava drugje, preklic, izbrisan/blokiran uporabnik):
   400/401/403/404/422 z refresh_token_* / session_* / user_* / invalid_grant v telesu. To ostane odjava.
   Znana meja: pri 429 in drugih nedokončnih odgovorih supabase-js ponavlja do ~30 s (200 ms * 2^n), nato vrne napako in
   za isti žeton 60 s ne poskusi znova (lastRefreshFailure); do takrat poziv za žeton javi "ni odgovora", ne odjave.
   Seja, ki jo strežnik zavrača z neprepoznano obliko napake, ostane z "Try again" in gumbom Log out (profil, My Account).
   Žetoni ostanejo v localStorage kot doslej; skripta ničesar ne shranjuje in ne pošilja drugam. */
(function () {
  var OSVEZITEV = /\/auth\/v1\/token\?(?:[^#]*&)?grant_type=refresh_token(?:&|$)/;
  var DOKONCNO = /refresh.?token|session.?(?:not.?found|expired)|invalid.?grant|user.?(?:not.?found|banned)|banned/i;
  var STATUSI = { 400: 1, 401: 1, 403: 1, 404: 1, 422: 1 };

  window.outlyJeDokoncnaZavrnitev = function (status, telo) { return !!STATUSI[status] && DOKONCNO.test(String(telo || "")); };

  window.outlySejaFetch = function (vhod, opcije) {
    var url = typeof vhod === "string" ? vhod : (vhod && vhod.url) || String(vhod || "");
    var f = window.fetch.bind(window);
    if (!OSVEZITEV.test(url)) return f(vhod, opcije);
    return f(vhod, opcije).then(function (odg) {
      if (odg.ok) return odg;
      return odg.clone().text().then(function (telo) { return telo; }, function () { return ""; }).then(function (telo) {
        if (window.outlyJeDokoncnaZavrnitev(odg.status, telo)) return odg;
        throw new TypeError("Session refresh inconclusive (HTTP " + odg.status + ")");
      });
    });
  };
})();
