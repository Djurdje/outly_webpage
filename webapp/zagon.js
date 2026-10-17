/* Varovalo zagona spletne aplikacije (navaden skript, tece PRED moduli).
   Zakaj: Cloudflare (nastavitev racuna "Browser Cache TTL") kodi /webapp/* doda max-age=14400 in povozi
   `no-cache` iz _headers. Brskalnik zato do 4 ure po objavi lahko pomesa stare in nove module: nov main.js,
   star home.js -> "does not provide an export named ..." in aplikacija obvisi na vrtavki (Martin, 29. 9. 2026).
   Ob taki napaki pred zagonom: module znova prenese mimo predpomnilnika brskalnika (cache: "reload"),
   kodo v predpomnilniku service workerja zamenja s svezo (ne brise je - skener brez povezave) in stran enkrat osvezi. Ce ne pomaga (najvec 1x na 30 s), pokaze sporocilo z gumbom.
   Brez innerHTML (CSP, XSS). */
(function () {
  var KLJUC = "outly_obnova";
  var zagnano = false;
  var obnavljam = false;

  function jeSl() {
    try { var j = JSON.parse(localStorage.getItem("outly_jezik")); if (j === "sl" || j === "en") return j === "sl"; } catch (e) { /* brez */ }
    return /^sl/i.test(navigator.language || "");
  }

  /* Zagnana = main.js je poklical outlyZagnano ALI zacetne vrtavke ni vec (star, a skladen main.js tega klica nima -
     brez te preverbe bi varovalo delujoco aplikacijo zamenjalo s sporocilom). */
  function jeZagnano() {
    if (zagnano) return true;
    var koren = document.getElementById("aplikacija");
    return !!koren && !koren.querySelector(".nalaganje-zacetno");
  }

  function pokaziNapako() {
    if (jeZagnano()) return;
    var koren = document.getElementById("aplikacija");
    if (!koren) return;
    var sl = jeSl();
    var okvir = document.createElement("div");
    okvir.className = "prazno nalaganje-zacetno";   // razred ostane: stran se se ni zagnala
    okvir.setAttribute("role", "alert");
    var naslov = document.createElement("strong");
    naslov.textContent = sl ? "Outly se ni zagnal." : "Outly could not start.";
    var opis = document.createElement("p");
    opis.className = "opomba";
    opis.textContent = !navigator.onLine
      ? (sl ? "Ni internetne povezave. Preveri omrežje in osveži." : "No internet connection. Check your network and reload.")
      : (sl ? "Verjetno je izšla nova različica. Osveži, da jo naložiš." : "A new version was probably just released. Reload to get it.");
    var gumb = document.createElement("button");
    gumb.type = "button";
    gumb.className = "gumb-siv";
    gumb.textContent = sl ? "Osveži" : "Reload";
    gumb.addEventListener("click", function () { obnovi(true); });
    okvir.appendChild(naslov); okvir.appendChild(opis); okvir.appendChild(gumb);
    koren.textContent = "";
    koren.appendChild(okvir);
  }

  function zOmejitvijo(obljuba, ms) {
    return new Promise(function (ok, napaka) {
      var t = setTimeout(function () { napaka(new Error("cas")); }, ms);
      obljuba.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); napaka(e); });
    });
  }

  function obnovi(rocno) {
    if (obnavljam) return;
    // Brez povezave obnova ne more uspeti - in ne smemo pobrisati shranjene lupine (delovanje brez povezave).
    if (!navigator.onLine) { pokaziNapako(); return; }
    var zdaj = Date.now(), prej = 0;
    try { prej = Number(sessionStorage.getItem(KLJUC)) || 0; } catch (e) { /* brez */ }
    if (!rocno && zdaj - prej < 30000) { pokaziNapako(); return; }
    obnavljam = true;
    try { sessionStorage.setItem(KLJUC, String(zdaj)); } catch (e) { /* brez */ }
    var poti = { "/webapp/js/main.js": 1 };
    try {
      var povezave = document.querySelectorAll('link[rel="modulepreload"]');
      for (var i = 0; i < povezave.length; i++) poti[new URL(povezave[i].href, location.href).pathname] = 1;
      var viri = performance.getEntriesByType("resource");
      for (var j = 0; j < viri.length; j++) {
        var u = new URL(viri[j].name, location.href);
        if (u.origin === location.origin && u.pathname.indexOf("/webapp/") === 0) poti[u.pathname] = 1;
      }
    } catch (e) { /* brez */ }
    // 1) moduli na novo mimo predpomnilnika brskalnika - ce kaj pade ali traja vec kot 10 s: gumb (nikoli vecna vrtavka);
    // 2) kodo v predpomnilniku SW osvezimo (najvec 8 s; ce ne uspe, vseeno naprej); 3) osvezitev. Vrtavka skupaj najvec ~18 s.
    zOmejitvijo(Promise.all(Object.keys(poti).map(function (p) {
      return fetch(p, { cache: "reload", credentials: "same-origin" }).then(function (o) { if (!o.ok) throw new Error(String(o.status)); });
    })), 10000).then(function () {
      var shramba = null;
      try { shramba = window.caches || null; } catch (e) { shramba = null; }
      if (!shramba) return;
      return zOmejitvijo(osveziPredpomnilnik(shramba), 8000).catch(function () { /* ni kriticno: ostane prejsnja kopija */ });
    }).then(function () { location.reload(); }, function () { obnavljam = false; pokaziNapako(); });
  }

  /* Predpomnilnika SW NE brisemo (do 10/2026 smo ga): v njem je JEDRO (skener, jsQR, slovenski prevodi), ki ga SW
     napolni ob namestitvi - brez njega vratar po "Osvezi" ob slabem signalu ne bi mogel odpreti skenerja.
     Namesto tega nasa koda brez razlicice v imenu (/webapp/*, /supabase-config.js, lupina /app/) dobi svezo kopijo
     pod istim kljucem. To NI strogo atomsko: fetch strani gre skozi SW, ki ob izpadu mreze vrne shranjeno kopijo (to
     zapisemo nazaj - mesanica starega in novega je mogoca, ce mreza pade sredi kroga). Skladnost celote po osvezitvi
     znova preveri SW (sporocilo "shrani" -> vse ali nic). */
  function osveziPredpomnilnik(shramba) {
    function nasaKoda(pot) { return pot.indexOf("/webapp/") === 0 || pot === "/supabase-config.js" || pot === "/app/"; }
    return shramba.keys().then(function (imena) {
      return Promise.all(imena.filter(function (x) { return x.indexOf("outly-app-") === 0; }).map(function (ime) {
        return shramba.open(ime).then(function (c) {
          return c.keys().then(function (zahteve) {
            var poti = zahteve.map(function (z) { return new URL(z.url).pathname; }).filter(nasaKoda);
            return Promise.all(poti.map(function (p) {
              return fetch(p, { cache: "reload", credentials: "same-origin" }).then(function (o) {
                var tip = (o.headers.get("content-type") || "").toLowerCase();
                // Cloudflare za neznano pot vrne index.html s 200 - HTML je pravi samo za lupino.
                if (!o.ok || (p === "/app/") !== (tip.indexOf("text/html") >= 0)) throw new Error(p);
                return [p, o];
              });
            })).then(function (sveze) {
              return Promise.all(sveze.map(function (s) { return c.put(s[0], s[1]); }));
            });
          });
        });
      }));
    });
  }

  /* Klice main.js, ko je aplikacija izrisana. */
  window.outlyZagnano = function () { zagnano = true; };
  /* Za leno nalozene zaslone (main.js leno()): isti postopek po objavi. */
  window.outlyObnovi = obnovi;

  // Napaka nase kode pred zagonom (povezovanje modulov, nalaganje skripta). Napake razsiritev brskalnika
  // (npr. MetaMask) prihajajo iz drugih datotek in jih ne stejemo.
  window.addEventListener("error", function (e) {
    if (jeZagnano()) return;
    var t = e.target;
    var nasSkript = t && t.tagName === "SCRIPT" && /\/webapp\//.test(t.src || "");
    var nasaDatoteka = typeof e.filename === "string" && e.filename.indexOf(location.origin + "/webapp/") === 0;
    if (nasSkript || nasaDatoteka) obnovi(false);
  }, true);

  // Ce se aplikacija 20 s po nalozitvi strani ne izrise (in ni bilo napake), pokazemo gumb - brez samodejne osvezitve
  // (pocasno omrezje ni napaka).
  window.addEventListener("load", function () { setTimeout(function () { if (!jeZagnano() && !obnavljam) pokaziNapako(); }, 20000); });
})();
