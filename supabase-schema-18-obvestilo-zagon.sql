-- =====================================================================
--  Outly — waitlist, 18. del: ENKRATNI MAIL »OUTLY IS LIVE« (Resend)
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
--  (Pred tem morajo biti pognani `supabase-schema.sql`, `-2-confirm.sql` (pg_net, app_secrets, confirmed)
--   in vsi vmesni deli, ki so že v produkciji.)
-- =====================================================================
--
--  ZAKAJ: ob prijavi na waitlist so obiskovalci dobili obljubo »povemo, ko Outly zaživi« (politika zasebnosti,
--  razdelek 3: Waitlist email — to tell you when Outly launches, privolitev). Outly zdaj dela v brskalniku
--  (outly.si). Ta datoteka pošlje ENEGA maila SAMO potrjenim prijavam (confirmed = true), angleško, prek RESEND
--  (plačljiv paket, domena outly.si potrjena, sledenje odpiranju in klikom izklopljeno). Ne Brevo.
--  Mail je potrdil Martin 23. 10. 2026 (seja Claude Code), besedilo je spodaj dobesedno.
--
--  KAJ DODA:
--    - stolpca waitlist_signups.launch_sent_at in launch_request_id (sled: kdo je že dobil mail in v katerem zahtevku),
--    - public.posli_obvestilo_zagon_test(naslov) pošlje isti mail na en naslov (preizkus, nič ne označi),
--    - public.posli_obvestilo_zagon(p_najvec)   pošlje do 100 neposlanih potrjenih prijav v ENEM zahtevku Resend batch,
--    - public.preveri_obvestilo_zagon()          po zahtevku: status Resend in število vrstic (brez e-naslovov),
--    - public.ponovi_obvestilo_zagon(p_zahtevek) neuspel zahtevek ponastavi, da gre znova.
--  Funkcije niso SECURITY DEFINER, iz brskalnika (anon, authenticated) niso dosegljive; teče jih samo Martin v
--  SQL Editorju (kot postgres).
--
-- ---------------------------------------------------------------------
--  NAVODILA ZA MARTINA (po vrstnem redu)
-- ---------------------------------------------------------------------
--  PRED VSEM: outly.si mora biti že spletna aplikacija (gumb »Open Outly« vodi na https://outly.si).
--
--  (a) Požene to datoteko (Run). Je idempotentna, lahko jo pogoniš še enkrat.
--
--  (b) V Resend naredi ključ: Resend → API Keys → Create API Key, pravica »Sending access«, domena outly.si.
--      Ključ vpiši v bazo (SAMO v SQL Editorju, nikamor drugam, nikomur ga ne pošiljaj):
--
--        insert into public.app_secrets (key, value) values ('resend_api_key', 're_TVOJ_KLJUC')
--        on conflict (key) do update set value = excluded.value;
--
--      (re_TVOJ_KLJUC zamenjaj s pravim ključem; v tej datoteki NIKOLI ne sme biti pravi ključ.)
--
--  (b2) Pošlji si TESTNI mail (isti mail kot pravi, en naslov, nobena vrstica se ne označi):
--
--        select public.posli_obvestilo_zagon_test('tvoj@naslov');
--
--      Vrne id zahtevka. Preveri predal (tudi nezaželeno pošto) in odgovor Resend:
--
--        select * from net._http_response where id = <id>;
--
--      Šele če je mail v predalu videti prav in je status_code 200, nadaljuj s (c).
--
--  (c) Pošlji prvih največ 100 prijav:
--
--        select public.posli_obvestilo_zagon(100);
--
--      Vrne število vrstic v zahtevku. Poganjaj znova, dokler ne vrne 0 (Resend batch dovoli 100 mailov na zahtevek;
--      med dvema zagonoma počakaj nekaj sekund). Že poslanim se mail ne pošlje še enkrat.
--
--  (d) Preveri izid (počakaj ~1 minuto):
--
--        select * from public.preveri_obvestilo_zagon();
--
--      Pričakovano: za vsak zahtevek status_code = 200. (pg_net hrani odgovore približno 6 ur — preveri še isti dan.
--      Podrobnosti napake: select id, status_code, content from net._http_response where id = <zahtevek>;)
--
--  (e) Če status ni 200 (ali odgovora ni): ponastavi ta zahtevek in ponovi (c):
--
--        select public.ponovi_obvestilo_zagon(<zahtevek iz preveri_obvestilo_zagon>);
--        select public.posli_obvestilo_zagon(100);
--
--      Funkcija ponovi zavrne zahtevek s statusom 200 in zahtevek, ki je mlajši od 5 minut brez odgovora
--      (verjetno še teče). Resend pri ponovljenem pošiljanju iste skupine v 24 urah prepozna isti
--      Idempotency-Key in ne pošlje dvojnika.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Sled o poslanem mailu
-- ---------------------------------------------------------------------
alter table public.waitlist_signups
  add column if not exists launch_sent_at    timestamptz,
  add column if not exists launch_request_id bigint;


-- ---------------------------------------------------------------------
-- 2) Vsebina maila: EN element za Resend batch. Skupna za pošiljanje vsem in za testni mail,
--    da je testni mail natanko isti kot pravi.
-- ---------------------------------------------------------------------
create or replace function public.obvestilo_zagon_element(p_naslov text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_html text;
  v_text text;
begin
  v_html := $wm$
<!doctype html>
<html><body style="margin:0;padding:0;background:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#171717;border:1px solid rgba(255,255,255,.10);border-radius:20px;">
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 22px;font:800 12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:#8f8f8f;">OUTLY&nbsp;&nbsp;&middot;&nbsp;&nbsp;LAUNCH</p>
          <h1 style="margin:0 0 14px;font:800 27px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ededed;letter-spacing:-.02em;">Outly is live.</h1>
          <p style="margin:0 0 26px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            You joined the <strong style="color:#ededed;">Outly</strong> waitlist &mdash; and the wait is over. Outly now works right in your browser: discover events and clubs near you, see what&rsquo;s on tonight and get your tickets in a few taps.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 8px;">
          <a href="https://outly.si" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">Open Outly</a>
        </td></tr>
        <tr><td style="padding:22px 28px 8px;">
          <p style="margin:0;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            New here? Create your account with the email you used for the waitlist. Already have one? Just sign in.
          </p>
        </td></tr>
        <tr><td style="padding:14px 28px 30px;">
          <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            You received this because you confirmed your spot on the Outly waitlist &mdash; this is the launch email we promised. Don&rsquo;t want emails from us? Reply to this email or write to <a href="mailto:luka@outly.si" style="color:#8f8f8f;">luka@outly.si</a>.
          </p>
          <p style="margin:10px 0 0;font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            Sender: NEXT DIMENSIONS, dru&#382;ba za marketing, d.o.o., Treb&#269;e 81, 3256 Bistrica ob Sotli, Slovenia.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
$wm$;

  v_text :=
    'Outly is live.' || E'\n\n' ||
    'You joined the Outly waitlist - and the wait is over. Outly now works right in your browser: discover events and clubs near you, see what''s on tonight and get your tickets in a few taps.' || E'\n\n' ||
    'Open Outly: https://outly.si' || E'\n\n' ||
    'New here? Create your account with the email you used for the waitlist. Already have one? Just sign in.' || E'\n\n' ||
    '--' || E'\n' ||
    'You received this because you confirmed your spot on the Outly waitlist - this is the launch email we promised. Don''t want emails from us? Reply to this email or write to luka@outly.si.' || E'\n' ||
    'Sender: NEXT DIMENSIONS, družba za marketing, d.o.o., Trebče 81, 3256 Bistrica ob Sotli, Slovenia.';

  return jsonb_build_object(
    'from',     'Outly <luka@outly.si>',
    'to',       jsonb_build_array(p_naslov),
    'reply_to', 'luka@outly.si',
    'subject',  'Outly is live',
    'html',     v_html,
    'text',     v_text,
    'headers',  jsonb_build_object('List-Unsubscribe', '<mailto:luka@outly.si?subject=unsubscribe>')
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 3) Pošiljanje (Resend batch, en zahtevek na klic, največ 100 naslovov)
--    Ključ: app_secrets.resend_api_key (glej korak (b) zgoraj). Brez ključa: izjema, nič se ne označi.
-- ---------------------------------------------------------------------
create or replace function public.posli_obvestilo_zagon(p_najvec int default 100)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_key     text;
  v_najvec  int := least(greatest(coalesce(p_najvec, 100), 1), 100);   -- Resend batch: največ 100
  v_ids     uuid[];
  v_poste   jsonb;
  v_req     bigint;
  v_n       int;
begin
  select value into v_key from public.app_secrets where key = 'resend_api_key';
  if v_key is null or v_key = '' or v_key = 're_TVOJ_KLJUC' then
    raise exception 'obvestilo zagon: v app_secrets manjka resend_api_key (glej navodila na vrhu datoteke, korak b)';
  end if;

  -- Izbira (1. korak, brez zaklepanja): samo potrjene, še neposlane, en naslov enkrat (lower(email)), nihče, ki je isti
  -- naslov že dobil, najstarejši potrjeni najprej, največ v_najvec.
  select array_agg(id order by confirmed_at nulls last, id)
    into v_ids
    from (
      select id, confirmed_at
        from (
          select distinct on (lower(s.email)) s.id, s.confirmed_at
            from public.waitlist_signups s
           where s.confirmed
             and s.launch_sent_at is null
             and not exists (select 1 from public.waitlist_signups d
                              where lower(d.email) = lower(s.email) and d.launch_sent_at is not null)
           order by lower(s.email), s.confirmed_at nulls last, s.id
        ) enolicni
       order by confirmed_at nulls last, id
       limit v_najvec
    ) omejeni;

  if v_ids is null then
    return 0;
  end if;

  -- 2. korak: zaklepanje samo izbranih vrstic (FOR UPDATE SKIP LOCKED), nato ponovni preizkus launch_sent_at:
  -- dva hkratna zagona ne dobita istih vrstic (drugi dobi manj ali nič, nikoli dvojnikov).
  select array_agg(z.id order by z.confirmed_at nulls last, z.id),
         jsonb_agg(public.obvestilo_zagon_element(z.email) order by z.confirmed_at nulls last, z.id)
    into v_ids, v_poste
    from (
      select s.id, s.email, s.confirmed_at
        from public.waitlist_signups s
       where s.id = any (v_ids)
         and s.launch_sent_at is null
       order by s.confirmed_at nulls last, s.id
         for update of s skip locked
    ) z;

  if v_ids is null then
    return 0;
  end if;
  v_n := array_length(v_ids, 1);

  -- Idempotency-Key iz množice naslovov: ponovni zahtevek za isto skupino (npr. po neuspelem odgovoru) Resend
  -- v 24 urah prepozna in ne pošlje dvojnika.
  v_req := net.http_post(
    url     := 'https://api.resend.com/emails/batch',
    headers := jsonb_build_object(
                 'Authorization',   'Bearer ' || v_key,
                 'Content-Type',    'application/json',
                 'Idempotency-Key', 'outly-launch-' || (select md5(string_agg(x::text, ',' order by x)) from unnest(v_ids) x)
               ),
    body    := v_poste,
    timeout_milliseconds := 30000
  );

  update public.waitlist_signups
     set launch_sent_at = now(), launch_request_id = v_req
   where id = any (v_ids);

  return v_n;
end;
$$;


-- ---------------------------------------------------------------------
-- 3b) TESTNI mail: natanko isti mail (isti element, ista pot /emails/batch, en element) na en podan naslov.
--     NE označi nobene vrstice in ne bere waitlist_signups. Vrne id zahtevka (odgovor: net._http_response).
-- ---------------------------------------------------------------------
create or replace function public.posli_obvestilo_zagon_test(p_naslov text)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_key text;
  v_req bigint;
begin
  if p_naslov is null or p_naslov !~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' then
    raise exception 'obvestilo zagon test: neveljaven naslov';
  end if;

  select value into v_key from public.app_secrets where key = 'resend_api_key';
  if v_key is null or v_key = '' or v_key = 're_TVOJ_KLJUC' then
    raise exception 'obvestilo zagon test: v app_secrets manjka resend_api_key (glej navodila na vrhu datoteke, korak b)';
  end if;

  v_req := net.http_post(
    url     := 'https://api.resend.com/emails/batch',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_key,
                 'Content-Type',  'application/json'
               ),
    body    := jsonb_build_array(public.obvestilo_zagon_element(p_naslov)),
    timeout_milliseconds := 30000
  );
  return v_req;
end;
$$;


-- ---------------------------------------------------------------------
-- 4) Preverjanje: po zahtevku status Resend in število vrstic (samo števila, nobenih e-naslovov)
--    status_code je NULL, če odgovora (še) ni (pg_net ga hrani ~6 ur).
-- ---------------------------------------------------------------------
create or replace function public.preveri_obvestilo_zagon()
returns table (zahtevek bigint, poslano_ob timestamptz, vrstic bigint, status_code int, odgovor_je boolean)
language sql
set search_path = public
as $$
  select s.launch_request_id,
         min(s.launch_sent_at),
         count(*),
         max(r.status_code),
         bool_or(r.id is not null)
    from public.waitlist_signups s
    left join net._http_response r on r.id = s.launch_request_id
   where s.launch_request_id is not null
   group by s.launch_request_id
   order by min(s.launch_sent_at), s.launch_request_id;
$$;


-- ---------------------------------------------------------------------
-- 5) Ponovitev neuspelega zahtevka: vrstice zahtevka se ponastavijo, da jih posli_obvestilo_zagon vzame znova.
--    Zavrne zahtevek s statusom 200 in zahtevek brez odgovora, mlajši od 5 minut (verjetno še teče).
-- ---------------------------------------------------------------------
create or replace function public.ponovi_obvestilo_zagon(p_zahtevek bigint)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_n int;
begin
  if exists (select 1 from net._http_response where id = p_zahtevek and status_code = 200) then
    raise exception 'zahtevek % je uspel (status 200), ponovitev bi poslala dvojnike', p_zahtevek;
  end if;

  if not exists (select 1 from net._http_response where id = p_zahtevek)
     and exists (select 1 from public.waitlist_signups
                  where launch_request_id = p_zahtevek and launch_sent_at > now() - interval '5 minutes') then
    raise exception 'zahtevek % je mlajši od 5 minut in še nima odgovora; počakaj in poskusi znova', p_zahtevek;
  end if;

  update public.waitlist_signups
     set launch_sent_at = null, launch_request_id = null
   where launch_request_id = p_zahtevek;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ---------------------------------------------------------------------
-- 6) Pravice: samo lastnik (SQL Editor kot postgres). Brez SECURITY DEFINER.
-- ---------------------------------------------------------------------
revoke all on function public.posli_obvestilo_zagon(int)       from public, anon, authenticated;
revoke all on function public.preveri_obvestilo_zagon()        from public, anon, authenticated;
revoke all on function public.ponovi_obvestilo_zagon(bigint)   from public, anon, authenticated;
revoke all on function public.posli_obvestilo_zagon_test(text) from public, anon, authenticated;
revoke all on function public.obvestilo_zagon_element(text)    from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.posli_obvestilo_zagon(int)     from service_role;
    revoke all on function public.preveri_obvestilo_zagon()      from service_role;
    revoke all on function public.ponovi_obvestilo_zagon(bigint) from service_role;
    revoke all on function public.posli_obvestilo_zagon_test(text) from service_role;
    revoke all on function public.obvestilo_zagon_element(text)  from service_role;
  end if;
end $$;
