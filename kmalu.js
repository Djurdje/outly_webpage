/* "Coming soon to Outly" na /about: logotipi in imena klubov, ki prihajajo. Isti vir kot spletna aplikacija in iOS:
   javni GET /coming-soon na backendu (brez prijave, brez piskotkov). Ob kateri koli napaki (omrezje, 404 pri starem backendu,
   5xx, prazen seznam) ostane razdelek skrit - nic se ne javi obiskovalcu.
   Podatki gredo v DOM samo prek createElement/textContent/setAttribute (brez innerHTML); slike samo https, povezava samo
   na lastno pot /app/soon/<slug> (slug a-z, 0-9, -). */
(function () {
  "use strict";
  var API = "https://outly-backend-roy3.onrender.com";
  var sekcija = document.getElementById("kmalu");
  var seznam = document.getElementById("kmaluSeznam");
  if (!sekcija || !seznam || !window.fetch) return;

  var str = function (v) { return typeof v === "string" ? v.trim() : ""; };
  var https = function (v) {
    var s = str(v);
    if (!/^https:\/\//i.test(s)) return "";
    try { var u = new URL(s); return u.protocol === "https:" ? u.href : ""; } catch (_) { return ""; }
  };

  function vnos(k) {
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.className = "kmalu__vnos";
    a.href = "/app/soon/" + k.slug;
    var logo = document.createElement("span");
    logo.className = "kmalu__logo";
    if (k.logo) {
      var img = document.createElement("img");
      img.src = k.logo; img.alt = ""; img.width = 72; img.height = 72;
      img.loading = "lazy"; img.decoding = "async";
      logo.appendChild(img);
    }
    var ime = document.createElement("span");
    ime.className = "kmalu__ime";
    ime.textContent = k.name;
    a.appendChild(logo); a.appendChild(ime);
    if (k.city) {
      var mesto = document.createElement("span");
      mesto.className = "kmalu__mesto";
      mesto.textContent = k.city;
      a.appendChild(mesto);
    }
    li.appendChild(a);
    return li;
  }

  var krmilnik = window.AbortController ? new AbortController() : null;
  var casovnik = krmilnik ? setTimeout(function () { krmilnik.abort(); }, 8000) : null;
  fetch(API + "/coming-soon", krmilnik ? { signal: krmilnik.signal } : undefined)
    .then(function (odg) { if (!odg.ok) throw new Error("status"); return odg.json(); })
    .then(function (r) {
      var videni = {}, klubi = [];
      (r && Array.isArray(r.clubs) ? r.clubs : []).forEach(function (k) {
        if (!k || typeof k !== "object") return;
        var slug = str(k.slug), ime = str(k.name);
        if (!/^[a-z0-9-]{1,60}$/.test(slug) || !ime || videni[slug]) return;
        videni[slug] = true;
        klubi.push({ slug: slug, name: ime, city: str(k.city), logo: https(k.logo_url) });
      });
      if (!klubi.length) return;
      klubi.slice(0, 20).forEach(function (k) { seznam.appendChild(vnos(k)); });
      sekcija.hidden = false;
    })
    .catch(function () { /* razdelek ostane skrit */ })
    .then(function () { if (casovnik) clearTimeout(casovnik); });
})();
