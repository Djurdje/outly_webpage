/* Varovalo zagona spletne aplikacije (navaden skript, tece PRED moduli).
   Zakaj: Cloudflare (nastavitev racuna "Browser Cache TTL") kodi /webapp/* doda max-age=14400 in povozi
   `no-cache` iz _headers. Brskalnik zato do 4 ure po objavi lahko pomesa stare in nove module: nov main.js,
   star home.js -> "does not provide an export named ..." in aplikacija obvisi na vrtavki (Martin, 29. 9. 2026).
   Ob taki napaki pred zagonom: module znova prenese mimo predpomnilnika brskalnika (cache: "reload"),
   in stran enkrat osvezi (predpomnilnika service workerja ne brise in vanj ne pise - uskladi ga SW sam).
   Stopnja 2 (Sentry OUTLY-WEBAPP-A, 6. 11. 2026): pri slabem signalu SW del modulov vrne iz shrambe (stara razlicica), del
   pride z omrezja (nova) - osvezitev da isto mesanico. Ce je SW kaksno datoteko vrnil iz shrambe (glava X-Outly-Shramba) ali
   osvezitev v 30 s ni pomagala, stran zazenemo IZ SHRAMBE SW (vsa nasa koda iz shrambe = skladna prejsnja razlicica).
   Ce tudi to ne pomaga (ali SW tega ne zna / shramba ni popolna), pokaze sporocilo z gumbom - nikoli zanka osvezitev.
   Brez innerHTML (CSP, XSS). */
(function () {
  var KLJUC = "outly_obnova";
  var KLJUC_SHRAMBA = "outly_obnova_shramba";
  var KLJUC_V_SHRAMBI = "outly_v_shrambi";   // ena sama navigacija: ta stran se je zagnala iz shrambe (stopnja 2)
  var zagnano = false;
  var obnavljam = false;
  var rocnoZagnano = false;   // obnovi(true) na ze zagnani aplikaciji, ki ga je sprozil uporabnik (gumb "Try again")
  var KLJUC_SAMODEJNO = "outly_obnova_samodejno";   // casi samodejnih obnov (najvec 3 v 5 min)
  var vShrambi = false;
  try { vShrambi = sessionStorage.getItem(KLJUC_V_SHRAMBI) === "1"; sessionStorage.removeItem(KLJUC_V_SHRAMBI); } catch (e) { /* brez */ }
  /* main.js leno(): stran iz shrambe se nikoli SAMA ne osvezi (zaslon pokaze "Try again"). Pregled PR #104, 2. krog: pri
     napakah omrezja, ki pridejo sele po >60 s, je bila to samodejna zanka osvezitev z vrtavko (leno je omejen na 1x/60 s). */
  window.outlyIzShrambe = vShrambi;

  /* Varovalo proti vsaki samodejni zanki (napaka pred zagonom IN samodejna obnova lenega zaslona v main.js; neodvisno od
     casov 30/60 s): najvec 3 samodejne obnove v 5 minutah. Ce sessionStorage ne dela (stevca ne moremo voditi): nobene. */
  function samodejnoDovoljeno() {
    var zdaj = Date.now(), casi;
    try {
      casi = JSON.parse(sessionStorage.getItem(KLJUC_SAMODEJNO) || "[]");
      if (!Array.isArray(casi)) casi = [];
      casi = casi.filter(function (c) { return typeof c === "number" && zdaj - c < 300000; });
      if (casi.length >= 3) return false;
      casi.push(zdaj);
      sessionStorage.setItem(KLJUC_SAMODEJNO, JSON.stringify(casi));
      return true;
    } catch (e) { return false; }
  }

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

  function beri(kljuc) {
    try { return Number(sessionStorage.getItem(kljuc)) || 0; } catch (e) { return 0; }
  }
  function pisi(kljuc, vrednost) {
    try { sessionStorage.setItem(kljuc, String(vrednost)); } catch (e) { /* brez */ }
  }
  /* Pri ze zagnani aplikaciji pokaziNapako() nic ne naredi (zaslon bi ostal na vrtavki, pregled PR #104 N-4): tam navadna
     osvezitev. Samo rocno (leno() najvec 1x na minuto ali uporabnik) - brez zanke. */
  function neuspeh() { obnavljam = false; if (rocnoZagnano) location.reload(); else pokaziNapako(); }

  /* Stopnja 2: SW prosimo, naj naslednjo navigacijo in vso naso kodo te strani streze iz shrambe (webapp/sw.js, "iz-shrambe").
     SW odgovori ok samo, ce ima v shrambi vso kodo za zagon. Star SW tega sporocila ne pozna (ni odgovora) -> po 2 s gumb. */
  function zagonIzShrambe() {
    var sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw || typeof MessageChannel === "undefined") { neuspeh(); return; }
    var kanal = new MessageChannel(), koncano = false;
    var t = setTimeout(function () { if (!koncano) { koncano = true; neuspeh(); } }, 2000);
    kanal.port1.onmessage = function (e) {
      if (koncano) return;
      koncano = true;
      clearTimeout(t);
      if (e.data && e.data.ok) { pisi(KLJUC_SHRAMBA, Date.now()); pisi(KLJUC_V_SHRAMBI, 1); location.reload(); } else neuspeh();
    };
    try { sw.postMessage({ tip: "iz-shrambe" }, [kanal.port2]); } catch (e) { koncano = true; clearTimeout(t); neuspeh(); }
  }

  /* rocno: gumb (ali samodejna obnova lenega zaslona, ki ima enako pot); samodejno: klic iz leno() v main.js brez dotika
     uporabnika - gre skozi varovalo 3/5 min in ob neuspehu strani NE osvezi (zaslon ze kaze "Try again"). */
  function obnovi(rocno, samodejno) {
    if (obnavljam) return;
    // Brez povezave prenos ne more uspeti - in ne smemo pobrisati shranjene lupine (delovanje brez povezave).
    // Gumb ("Reload", "Try again" na leno nalozenem zaslonu, npr. skener): stran osvezimo, SW jo da iz shrambe (skladna
    // razlicica; shrambe ne brisemo). Do 11/2026 tu gumb ni naredil nic. Samodejno (ne rocno) ne: brez zanke osvezitev.
    // Brez SW bi osvezitev brez povezave pokazala brskalnikovo stran z napako (in izgubila ze nalozene zaslone): tam nic.
    var sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    if (!navigator.onLine) { if (rocno && !samodejno && sw) location.reload(); else pokaziNapako(); return; }
    if (samodejno && !samodejnoDovoljeno()) return;
    rocnoZagnano = !!rocno && !samodejno && jeZagnano();
    // Aplikacija tece iz shrambe (stopnja 2), zaslon, ki ga v shrambi ni, pa je prisel z omrezja (nova razlicica) in se ni
    // povezal (pregled PR #104, S-1/S-2): navadna osvezitev s polnim krogom stopenj. Dobro omrezje -> nova razlicica;
    // se vedno slabo -> spet iz shrambe, zaslon pa pokaze "Try again" (leno najvec 1x na minuto) - nikoli celozaslonska napaka.
    if (rocnoZagnano && vShrambi) { pisi(KLJUC, 0); pisi(KLJUC_SHRAMBA, 0); location.reload(); return; }
    var zdaj = Date.now();
    // Zagon iz shrambe smo ze poskusili (pred manj kot 30 s) in se vedno ne gre: gumb (nikoli zanka osvezitev).
    if (!rocno && zdaj - beri(KLJUC_SHRAMBA) < 30000) { pokaziNapako(); return; }
    if (!rocno && !samodejnoDovoljeno()) { pokaziNapako(); return; }
    obnavljam = true;
    // Osvezitev smo ze poskusili (pred manj kot 30 s), stran pa je se vedno pomesana: omrezje ne da vsega -> iz shrambe.
    if (!rocno && zdaj - beri(KLJUC) < 30000) { zagonIzShrambe(); return; }
    pisi(KLJUC, zdaj);
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
    // 1) moduli na novo mimo predpomnilnika brskalnika (cache: "reload" osvezi HTTP predpomnilnik); 2) osvezitev strani.
    // Predpomnilnik SW po osvezitvi uskladi SW sam. 3) SW je kaksno datoteko vrnil iz shrambe (omrezje je ni dalo), prenos je
    // padel ali trajal vec kot 10 s: osvezitev bi dala isto mesanico -> zagon iz shrambe (brez SW: gumb, nikoli vecna vrtavka).
    zOmejitvijo(Promise.all(Object.keys(poti).map(function (p) {
      return fetch(p, { cache: "reload", credentials: "same-origin" }).then(function (o) {
        if (!o.ok) throw new Error(String(o.status));
        // Telo preberemo do konca: brez SW brskalnik datoteko zapise v HTTP predpomnilnik sele prebrano (sicer osvezitev
        // lahko spet dobi staro kopijo).
        var izShrambe = o.headers.get("X-Outly-Shramba") === "1";
        return o.arrayBuffer().then(function () { return izShrambe; });
      });
    })), 10000).then(function (izShrambe) {
      if (izShrambe.indexOf(true) === -1) location.reload(); else zagonIzShrambe();
    }, function () { zagonIzShrambe(); });
  }

  /* Predpomnilnika SW tu NE brisemo (do 10/2026 smo ga - v njem je JEDRO: skener, jsQR, slovenski prevodi, ki ga SW
     napolni ob namestitvi; brez njega vratar po "Osvezi" ob slabem signalu ne bi mogel odpreti skenerja) in vanj tudi
     NE pisemo: fetch strani gre skozi SW, ki ob izpadu mreze vrne staro kopijo s 200 - stran bi zapisala mesanico
     (pregled PR #76, S-2). Skladnost predpomnilnika SW ureja samo SW (osveziShrambo, vse ali nic), ki ga po osvezitvi
     sprozi sporocilo "shrani" (pwa.js). */

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
  // Viseca povezava (outly-backend#396: signal je, podatki ne tecejo): modul, ki ne pride nikoli, zadrzi "load" za vedno.
  // Zato varovalo tudi od zagona tega skripta: po 30 s brez izrisa (in brez napake) - s SW zagon IZ SHRAMBE (skladna
  // prejsnja razlicica, brez omrezja; steje varovalo 3/5 min), brez SW gumb. Ce se aplikacija vmes vseeno izrise, jo Preact
  // izrise cez sporocilo (render zamenja vsebino #aplikacija). SW tu namenoma NI spremenjen (casovna meja v SW je v testu
  // zadrzala aktivacijo novega SW). Znano (outly_webpage PR za #396): ko se omrezje vrne, lahko prva polna osvezitev ze odprte
  // strani obvisi (predaja starega SW novemu v Chromiumu); zapri + odpri aplikacijo dela.
  setTimeout(function () {
    if (jeZagnano() || obnavljam) return;
    var sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (sw && navigator.onLine && Date.now() - beri(KLJUC_SHRAMBA) >= 30000 && samodejnoDovoljeno()) { obnavljam = true; zagonIzShrambe(); }
    else pokaziNapako();
  }, 30000);
})();
