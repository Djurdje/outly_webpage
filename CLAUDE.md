# outly.si — navodila za agente

Statična spletna stran (HTML/CSS/JS, brez ogrodja, brez builda). Odgovarjaj v slovenščini, kratko.
Skupni možgani projekta so v repozitoriju `outly-backend`: `docs/DECISIONS.md`, `docs/STATE.md`, `docs/ARCHITECTURE.md` —
preberi jih (ali zahtevaj njihovo vsebino), preden spreminjaš karkoli, kar se dotika računov, točk ali backenda.

## Produkcija

- Veja `main` = produkcija. **Cloudflare Pages objavi vsak merge v main v ~1 min** (projekt `outly-webpage`, brez builda,
  streže vse datoteke iz repozitorija; čisti URL-ji: `/Creator`, `/confirm`, `/terms`, `/privacy`, `/privacy-app`).
- Zato: nikoli ne potiskaj v `main` — veja + PR, pregled (`qa-reviewer`), nato **PR sam mergaj** (PR mergaj s squash (GitHub MCP orodje merge_pull_request; gh CLI v oblaku ni) in pobrisi vejo;
  odločeno 16. 9. 2026, človeka vmes ni). Po objavi (~1 min) preveri `https://outly.si` (200) in spremenjene strani v brskalniku;
  CDN cache do 10 min. Če je kaj narobe, takoj revert PR + merge.
- Izjema: pravni dokumenti (`terms.html`, `privacy*.html`) in Supabase SQL, ki briše podatke – to čaka Martinov DA.
- Ker se streže vse iz repa, **v repo ne sme nič internega ali občutljivega** (`_redirects` skriva `CLAUDE.md` in `.claude/`).

## Kaj je kje

```
index.html / styles.css / script.js   landing + waitlist + "How it works" (User/Creator preklop)
waitlist.js                           prijava na waitlist (Supabase RPC join_waitlist, ?ref=KODA -> localStorage outly_ref)
auth.js                               Supabase Auth (registracija, prijava, pozabljeno geslo, profil kot plosca), window.OUTLY_CLIENT
confirm.html / confirm.js             potrditev prijave (token iz maila)
Creator.html / creator.js / .css      prosnja ustvarjalca -> backend POST /creator-applications
terms.html / privacy.html / privacy-app.html / pravno.css   pravni dokumenti (spremembe samo po Martinovem DA)
supabase-config.js                    javni URL + publishable kljuc (javna, namenoma v kodi)
supabase-schema*.sql                  zgodovina SQL shem (2..13) - dokumentacija; SQL v Supabase pozene Martin
assets/                               slike, ikone, points-coin.png
assets/fonts/                         Inter (woff2, latin + latin-ext, SIL OFL) - gostimo sami, NE Google Fonts
vendor/supabase-2.115.0.js            supabase-js UMD (iz npm) - gostimo sami, NE jsDelivr; nadgradnja = nova datoteka + 4 <script>
vendor/preact-*, htm-*, qrcode-*, jsqr-*   knjiznice spletne aplikacije (ESM iz npm, licence *-LICENSE.txt); hooks: uvoz "preact" -> relativna pot
vendor/maplibre-*, protomaps-basemaps-*   zemljevid (faza 3); CSP gradnja MapLibre (delavec z nase domene)
karta/v<datum>/{slo,mesta}/           ploscice zemljevida (OSM prek Protomaps, gzip .pbf + seznam.json): slo = Slovenija z0-10,
                                      mesta = Ljubljana + Maribor z11-15. Izrez (.pmtiles) naredi workflow na veji `karta-izrez`,
                                      v ploscice ga razpakira `karta/razpakiraj.mjs`. karta/pisave/ = Noto (OFL)
CNAME, _redirects, _headers           domena, preusmeritve, glave (CSP za /app)

app/index.html                        SPLETNA APLIKACIJA (PWA, od 29. 9. 2026): lupina; _redirects streze vse /app/* z njo
webapp/app.css, webapp/js/            koda aplikacije (Preact + htm, ES moduli, brez builda) - NAMENOMA zunaj /app
  api.js                              EDINA pot do backenda (send, zeton, 401 -> osvezi 1x, 503 NE odjavi)
  seja.js, supabase.js                seja (Supabase, isti kljuc kot auth.js = ena prijava), GET /me, onboarding
  usmerjanje.js, main.js              URL-ji /app/... (History API), zavihki Home/Search/Map/Profile, varovala
  i18n.js, i18n-sl.js                 en (privzeto) | sl; kljuc = angleski niz (isti kot iOS Localizable.xcstrings)
  oblika.js, podatki.js, ui.js        datumi/denar/oznake (prevod APIEvent.swift), javni podatki, skupni gradniki
  views/*.js                          zasloni (en na datoteko, ime po iOS: home, event, club, search, prijava ...)
  posel.js, views/posel*.js           poslovni del (faza 4): /app/business/:klub/... - klub je v poti, vsak klic ga poslje
                                      v glavi X-Outly-Club; lastnik (vloga business) ima v Profilu klubski obraz
  views/posel-skener.js               QR skener vstopnic (kamera; vse vloge v klubu)
  pwa.js, views/namestitev.js         PWA (faza 5): registracija service workerja, "Add Outly to Home Screen"
webapp/sw.js, webapp/manifest.webmanifest   service worker (velja za /app/ prek glave Service-Worker-Allowed) in manifest
webapp/orodja/predhodno-nalaganje.mjs       generira <link rel="modulepreload"> v app/index.html (staticni uvozi main.js)
```

## Spletna aplikacija (/app) - posebna pravila

- Odlocitev (29. 9. 2026, Martin): **ista stran, isti repo, brez builda** (backend `docs/DECISIONS.md`). Isti backend, baza in
  prijava kot iOS - je samo nov odjemalec. Funkcije enake iOS, izgled prilagojen spletu (stolpec do 480 px).
- **XSS je kriticen** (seja je v localStorage): podatki gredo v DOM samo prek htm predloge (besedilo/atribut), nikoli
  `innerHTML`/`dangerouslySetInnerHTML`; povezave iz podatkov (splet, Instagram) samo `http(s)` (glej `views/club.js`).
- Vsi klici prek `webapp/js/api.js` `send()`; napake prek `napake.js` `sporocilo()` (prevod iOS APIErrorMessages).
- Prijava in ponastavitev gesla s **kodo iz maila** (kot iOS), ne s povezavo - Supabase Redirect URL-ji za /app niso potrebni.
- Slike: Cloudinary URL dobi `f_auto,q_auto,w_N` (`oblika.js` `slika()`), `loading="lazy"`, fiksno razmerje. Animacije samo
  `transform`/`opacity`; **brez `backdrop-filter`** (87bc106).
- Datoteke aplikacije ne smejo biti pod `/app/` (pravilo 200 v `_redirects` bi jih prekrilo).
- **Globoke povezave (`/app/event/12`) resuje `webapp/vstop.js`, ne `_redirects`**: Cloudflare pravila
  `/app/* /app/index.html 200` v produkciji ni uporabil (29. 9. 2026, Martinov posnetek: osvezitev `/app/map` = domaca stran).
  Brez `404.html` Cloudflare za neznano pot vrne korensko `index.html`; ta ima kot PRVI skript `vstop.js`, ki preusmeri na
  `/app/?pot=...`, `usmerjanje.js` pa pot obnovi. Zato: `index.html` naj ostane z absolutnimi potmi (`/styles.css`), `vstop.js`
  naj ostane prvi skript in **ne dodajaj `404.html`** (pokvaril bi globoke povezave).
- Zemljevid (`webapp/js/karta.js`): brez tujih streznikov ploscic. **Cloudflare Pages ne podpira HTTP Range** (preverjeno
  29. 9. 2026: vrne 200 s celo datoteko), zato NE `.pmtiles` na Pages - samo staticne ploscice. Klub zunaj LJ/MB ima ulice
  sele z novim izrezom mesta (ploscice v `mesta/` + vnos v `MESTA`); Pages dovoli 20.000 datotek na objavo.
  Nova razlicica podatkov: (1) izrez na veji `karta-izrez`, (2) `karta/razpakiraj.mjs` (navodila v glavi) v novo mapo
  `karta/v<datum>/` - slo iz slovenija 0-10, vsa mesta 11-15 v isto `mesta/`, (3) `PODATKI` v `webapp/js/karta.js`,
  (4) staro mapo pobrisi (meja 20.000 datotek). Predpomnilnik 1 dan. Pripis OpenStreetMap mora ostati viden (ODbL).
- Poslovni del: **QR skener je tudi na spletu** (`views/posel-skener.js`, `/app/business/:klub/scan`; Martin 29. 9. 2026:
  vratar z Androidom nima aplikacije) - za vse vloge v klubu, tudi vratarja. Kamera prek getUserMedia, dekodiranje
  BarcodeDetector (Chrome Android) ali leno nalozen `vendor/jsqr-1.4.0.mjs` (Safari, Firefox); slike ostanejo na napravi,
  streznik dobi samo vsebino kode. Pri vstopnicah dogodka je rocni "Check in" (kot iOS). Kamera zahteva HTTPS in
  `Permissions-Policy: camera=(self)` v `_headers`. Lokacijo kluba lastnik oznaci s klikom na zemljevid (geokoderja na
  spletu ni). Vloge uveljavlja streznik (403); splet samo skrije gumbe.
- Hitrost (faza 5): zasloni izven Home/Search/dogodek/klub/zemljevid se nalozijo leno (`leno()` v `main.js`), prav tako
  slovenski prevodi, knjiznica QR in supabase-js (gost brez seje ga ob zagonu ne rabi). **Po vsakem novem staticnem
  uvozu pozeni `node webapp/orodja/predhodno-nalaganje.mjs`** (sicer brskalnik module odkriva v valovih).
  Elementi `position:fixed` naj bodo ZUNAJ animiranega `.okvir` (animacija s transform jih med prehodom premakne -> CLS).
- Service worker (`webapp/sw.js`): navigacija pod /app/ vedno dobi lupino /app/, koda /webapp/* omrezje najprej,
  vendor/pisave iz predpomnilnika. **API odgovorov, vstopnic in ploscic NE predpomni.** Ob spremembi seznama JEDRO
  ali strategije dvigni `RAZLICICA`.
- Preverjanje: headless Chromium s stubom backenda in Supabase (`page.route`), lokalni streznik, ki posnema `_redirects`
  in `_headers`; sirine 393, 360, 1280; neprijavljen + prijavljen; konzola brez napak (tudi CSP).

## Trda pravila

1. **Brez skrivnosti v repu.** Samo javni Supabase URL/publishable ključ. Nič `service_role`, nič SMTP, nič gesel.
2. Baza in Auth sta v Supabase (projekt `zbewqcxnvrwebxonvebx`, skupen z aplikacijo). Spremembe sheme = nova oštevilčena datoteka
   `supabase-schema-N-ime.sql`, ki jo v Supabase SQL Editorju požene Martin. Vrstni red objave: najprej SQL, potem JS, ki ga uporablja
   (obratno = prijave ne delajo, PGRST202).
3. En profil z aplikacijo: `auth.js` kliče backend `GET /me` / `PATCH /me` s Supabasovim žetonom. Uporabniško ime 3–20 znakov
   (črke, števke, podčrtaj). Ne podvajaj logike, ki jo ima backend.
4. Točke in vabila: 1 točka na vabilo, šteje šele ob potrditvi maila povabljenega; invite link samo za registrirane (glej DECISIONS.md).
5. Prijave na waitlisti se javno kažejo z maskiranim e-naslovom oz. delno zakritim imenom + »created a profile«.
6. Politika zasebnosti in pogoji so pravni dokumenti — besedila ne spreminjaj brez Martina.
7. Slog: temna tema, modra `#4C76FF` samo za glavni gumb, brez vijoličnih prelivov, brez emojijev kot ikon.
8. Preverjanje pred PR-jem: odpri strani v headless Chromiumu s stubom Supabase (vzorec: `recovery_test.js` iz prejšnjih sej),
   preveri konzolo brez napak, mobilno širino (iPhone 14 Pro, 393 px) in Safari-specifične pasti (backdrop-filter + Web Share
   je podrl stran — glej commit 87bc106).

## Sporočila commitov

Slovenščina, brez šumnikov, prva vrstica kaj, nato »Preverjeno: …«.
