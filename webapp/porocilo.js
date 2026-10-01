/* Porocanje napak spletne aplikacije v Sentry (projekt outly-webapp, EU streznik de.sentry.io).
   Navaden skript PRED moduli (kot zagon.js), da ujame tudi napake nalaganja modulov.
   Brez Sentry SDK (~25 kB): dogodek posljemo sami na /envelope/ - koda ni minificirana, sledi sklada so berljive.
   Zasebnost: brez uporabnika, e-naslova, zetona, piskotkov, IP-ja (Sentry: Prevent Storing of IP Addresses),
   brez poizvedbe in # v URL-ju, stevilke v poti -> :id; e-naslovi, dolgi nizi (zetoni) in kode (6-10 stevk)
   v sporocilu se zakrijejo; pri napakah API se telo odgovora streznika ne poslje (samo "API <status>").
   Samo na outly.si, najvec 5 dogodkov na nalaganje strani, isto sporocilo samo enkrat.
   DSN je javen po zasnovi (odjemalec ga mora poznati) - ni skrivnost. */
(function () {
  var DSN_KLJUC = "5115a2f6ab4381ad962f8bb0ed79b7f4";
  var STREZNIK = "https://o4512176179773440.ingest.de.sentry.io";
  var PROJEKT = "4512176195764305";
  var NAJVEC = 5;
  var RAZLICICA = "outly-app-5";   // uskladi z RAZLICICA v webapp/sw.js

  if (location.hostname !== "outly.si") return;   // lokalni razvoj, predogledi: nic
  var poslano = 0;
  var videno = {};

  function zakrij(s) {
    // Najprej skrajsaj: regex nad dolgim nizom brez presledkov bi bil pocasen.
    return String(s == null ? "" : s).slice(0, 1000)
      .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi, "[email]")
      .replace(/[A-Za-z0-9_\-.]{32,}/g, "[skrito]")
      .replace(/\b\d{6,10}\b/g, "[koda]");
  }
  function brezPoizvedbe(u) { return String(u || "").split(/[?#]/)[0]; }
  function pot() { return location.pathname.replace(/\/\d+(?=\/|$)/g, "/:id"); }
  function id() {
    var h = "";
    for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h;
  }

  /* Chrome: "    at fn (https://outly.si/webapp/js/x.js:10:5)" | Firefox/Safari: "fn@https://outly.si/webapp/js/x.js:10:5" */
  function okvirji(sklad) {
    var izhod = [];
    String(sklad || "").slice(0, 8000).split("\n").forEach(function (v) {
      var m = v.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/) || v.match(/^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/);
      if (!m) return;
      var datoteka = brezPoizvedbe(m[2]);
      izhod.push({
        "function": m[1] || "?",
        filename: datoteka,
        abs_path: datoteka,
        lineno: +m[3],
        colno: +m[4],
        in_app: datoteka.indexOf(location.origin + "/webapp/") === 0
      });
    });
    return izhod.reverse();   // Sentry: najstarejsi okvir prvi
  }

  function poslji(tip, sporocilo, sklad, datoteka) {
    if (poslano >= NAJVEC) return;
    try { sestaviInPoslji(tip, sporocilo, sklad, datoteka); } catch (e) { /* porocanje ne sme nikoli podreti aplikacije */ }
  }

  function sestaviInPoslji(tip, sporocilo, sklad, datoteka) {
    // Samo nasa koda: napake razsiritev brskalnika in tujih skript ("Script error.") ne zanimajo.
    if (datoteka && brezPoizvedbe(datoteka).indexOf(location.origin + "/") !== 0) return;
    sporocilo = String(sporocilo == null ? "" : sporocilo);
    // ApiError (webapp/js/napake.js): "API 409: <telo odgovora>" - telo lahko vsebuje podatke uporabnika.
    var api = sporocilo.match(/^API (-?\d+):/);
    if (api) sporocilo = "API " + api[1];
    if (/^Script error\.?$/.test(sporocilo) || /ResizeObserver loop/.test(sporocilo)) return;
    var kljuc = tip + ":" + sporocilo;
    if (videno[kljuc]) return;
    videno[kljuc] = 1;
    poslano++;

    var zdaj = new Date().toISOString();
    var dogodek = {
      event_id: id(),
      timestamp: zdaj,
      platform: "javascript",
      level: "error",
      environment: "production",
      release: RAZLICICA,
      request: { url: location.origin + pot(), headers: { "User-Agent": navigator.userAgent } },
      exception: { values: [{ type: zakrij(tip), value: zakrij(sporocilo), stacktrace: { frames: okvirji(sklad) } }] }
    };
    var ovojnica = JSON.stringify({ event_id: dogodek.event_id, sent_at: zdaj }) + "\n" +
      JSON.stringify({ type: "event" }) + "\n" + JSON.stringify(dogodek);
    // text/plain: brez CORS preflighta; keepalive: dogodek pride tudi ob zapiranju strani.
    fetch(STREZNIK + "/api/" + PROJEKT + "/envelope/?sentry_version=7&sentry_key=" + DSN_KLJUC, {
      method: "POST", body: ovojnica, keepalive: true, credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=UTF-8" }
    }).catch(function () { /* porocanje ne sme nikoli podreti aplikacije */ });
  }

  window.addEventListener("error", function (e) {
    var n = e.error;
    poslji(n && n.name || "Error", n && n.message || e.message, n && n.stack, e.filename);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    if (r instanceof Error) poslji(r.name || "Error", r.message, r.stack);
    else poslji("UnhandledRejection", typeof r === "string" ? r : "Neobravnavana obljuba (ni Error)");
  });
  // Za rocno porocanje iz kode (npr. ujeta napaka, ki je ne bi smelo biti).
  window.outlyPorociloNapake = function (napaka) {
    if (napaka instanceof Error) poslji(napaka.name || "Error", napaka.message, napaka.stack);
  };
})();
