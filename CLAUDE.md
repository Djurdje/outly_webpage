# outly.si — navodila za agente

Statična spletna stran (HTML/CSS/JS, brez ogrodja, brez builda). Odgovarjaj v slovenščini, kratko.
Skupni možgani projekta so v repozitoriju `outly-backend`: `docs/DECISIONS.md`, `docs/STATE.md`, `docs/ARCHITECTURE.md` —
preberi jih (ali zahtevaj njihovo vsebino), preden spreminjaš karkoli, kar se dotika računov, točk ali backenda.

## Produkcija

- Veja `main` = produkcija. **Cloudflare Pages objavi vsak merge v main v ~1 min** (projekt `outly-webpage`, brez builda,
  streže vse datoteke iz repozitorija; čisti URL-ji: `/Creator`, `/confirm`, `/terms`, `/privacy`, `/privacy-app`).
- Zato: nikoli ne potiskaj v `main` — veja + PR, pregled (`qa-reviewer`), nato **PR sam mergaj** (`gh pr merge --squash --delete-branch`;
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
CNAME, _redirects                     domena, preusmeritve
```

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
