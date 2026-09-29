/* Varovalo zagona spletne aplikacije (navaden skript, tece PRED moduli).
   Zakaj: Cloudflare (nastavitev racuna "Browser Cache TTL") kodi /webapp/* doda max-age=14400 in povozi
   `no-cache` iz _headers. Brskalnik zato do 4 ure po objavi lahko pomesa stare in nove module: nov main.js,
   star home.js -> "does not provide an export named ..." in aplikacija obvisi na vrtavki (Martin, 29. 9. 2026).
   Ob taki napaki pred zagonom: pocisti predpomnilnik service workerja, module znova prenese mimo predpomnilnika
   brskalnika (cache: "reload") in stran enkrat osvezi. Ce ne pomaga (najvec 1x na 30 s), pokaze sporocilo z gumbom.
   Brez innerHTML (CSP, XSS). */
(function () {
  var KLJUC = "outly_obnova";
  var zagnano = false;
  var obnavljam = false;

  function jeSl() {
    try { var j = JSON.parse(localStorage.getItem("outly_jezik")); if (j === "sl" || j === "en") return j === "sl"; } catch (e) { /* brez */ }
    return /^sl/i.test(navigator.language || "");
  }

  function pokaziNapako() {
    if (zagnano) return;
    var koren = document.getElementById("aplikacija");
    if (!koren) return;
    var sl = jeSl();
    var okvir = document.createElement("div");
    okvir.className = "prazno";
    okvir.setAttribute("role", "alert");
    var naslov = document.createElement("strong");
    naslov.textContent = sl ? "Outly se ni zagnal." : "Outly could not start.";
    var opis = document.createElement("p");
    opis.className = "opomba";
    opis.textContent = sl ? "Verjetno je izšla nova različica. Osveži, da jo naložiš." : "A new version was probably just released. Reload to get it.";
    var gumb = document.createElement("button");
    gumb.type = "button";
    gumb.className = "gumb-siv";
    gumb.textContent = sl ? "Osveži" : "Reload";
    gumb.addEventListener("click", function () { obnovi(true); });
    okvir.appendChild(naslov); okvir.appendChild(opis); okvir.appendChild(gumb);
    koren.textContent = "";
    koren.appendChild(okvir);
  }

  function obnovi(rocno) {
    if (obnavljam) return;
    var zdaj = Date.now(), prej = 0;
    try { prej = Number(sessionStorage.getItem(KLJUC)) || 0; } catch (e) { /* brez */ }
    if (!rocno && zdaj - prej < 30000) { pokaziNapako(); return; }
    obnavljam = true;
    try { sessionStorage.setItem(KLJUC, String(zdaj)); } catch (e) { /* brez */ }
    var poti = { "/webapp/js/main.js": 1 };
    var povezave = document.querySelectorAll('link[rel="modulepreload"]');
    for (var i = 0; i < povezave.length; i++) poti[new URL(povezave[i].href, location.href).pathname] = 1;
    try {
      var viri = performance.getEntriesByType("resource");
      for (var j = 0; j < viri.length; j++) {
        var u = new URL(viri[j].name, location.href);
        if (u.origin === location.origin && u.pathname.indexOf("/webapp/") === 0) poti[u.pathname] = 1;
      }
    } catch (e) { /* brez */ }
    var brisanje = window.caches
      ? caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x.indexOf("outly-app-") === 0; }).map(function (x) { return caches.delete(x); })); })
      : Promise.resolve();
    brisanje.catch(function () {}).then(function () {
      return Promise.all(Object.keys(poti).map(function (p) {
        return fetch(p, { cache: "reload", credentials: "same-origin" }).catch(function () {});
      }));
    }).then(function () { location.reload(); });
  }

  /* Klice main.js, ko je aplikacija izrisana. */
  window.outlyZagnano = function () { zagnano = true; };
  /* Za leno nalozene zaslone (main.js leno()): isti postopek po objavi. */
  window.outlyObnovi = obnovi;

  // Napaka nase kode pred zagonom (povezovanje modulov, nalaganje skripta). Napake razsiritev brskalnika
  // (npr. MetaMask) prihajajo iz drugih datotek in jih ne stejemo.
  window.addEventListener("error", function (e) {
    if (zagnano) return;
    var t = e.target;
    var nasSkript = t && t.tagName === "SCRIPT" && /\/webapp\//.test(t.src || "");
    var nasaDatoteka = typeof e.filename === "string" && e.filename.indexOf(location.origin + "/webapp/") === 0;
    if (nasSkript || nasaDatoteka) obnovi(false);
  }, true);

  // Ce se aplikacija 20 s po nalozitvi strani ne izrise (in ni bilo napake), pokazemo gumb - brez samodejne osvezitve
  // (pocasno omrezje ni napaka).
  window.addEventListener("load", function () { setTimeout(function () { if (!zagnano && !obnavljam) pokaziNapako(); }, 20000); });
})();
