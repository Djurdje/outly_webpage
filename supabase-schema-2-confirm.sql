-- =====================================================================
--  Outly — waitlist, 2. del: POTRDITEV EMAILA (double opt-in)
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
--  (Pred tem mora biti že pognan `supabase-schema.sql`.)
-- =====================================================================
--
--  ZAKAJ: preverjanje domene ugotovi samo, ali obstaja "gmail.com".
--  Ali obstaja točno "asdf123@gmail.com", se da dokazati SAMO tako,
--  da na ta naslov pošlješ mail in zahtevaš klik. Kdor ne klikne,
--  ne pride na seznam in se ne šteje v števec.
--
--  POTEK:
--    1. Obiskovalec vpiše mail  →  funkcija join_waitlist()
--    2. Vrstica se shrani z confirmed = false + naključnim žetonom
--    3. pg_net pošlje mail preko Brevo API-ja (gumb "Confirm my spot")
--    4. Klik odpre confirm.html?token=…  →  funkcija confirm_waitlist()
--    5. Šele zdaj confirmed = true in šele zdaj se pojavi na seznamu
--
--  Brskalnik po tej migraciji NE more več pisati direktno v tabelo —
--  lahko samo kliče ti dve funkciji. To mimogrede odpravi možnost,
--  da bi kdo z javnim ključem na roko polnil seznam.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Razširitev za pošiljanje HTTP zahtev iz baze
--    (Dashboard → Database → Extensions → pg_net; ta vrstica jo vklopi)
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;


-- ---------------------------------------------------------------------
-- 2) Zasebna tabela z nastavitvami (API ključ ipd.)
--    Nihče iz brskalnika je ne more brati — ni SELECT pravice in ni
--    politike. Berejo jo samo funkcije, ki tečejo kot lastnik baze.
-- ---------------------------------------------------------------------
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null
);

alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

--  ⚠️  TE TRI VRSTICE MORAŠ IZPOLNITI SAM (glej navodila na koncu):
--
--  insert into public.app_secrets (key, value) values
--    ('brevo_api_key', 'xkeysib-...'),                       -- ključ iz Brevo
--    ('mail_from',     'outly.team@gmail.com'),              -- potrjen pošiljatelj
--    ('site_url',      'https://djurdje.github.io/outly_webpage')
--  on conflict (key) do update set value = excluded.value;


-- ---------------------------------------------------------------------
-- 3) Novi stolpci na prijavah
-- ---------------------------------------------------------------------
alter table public.waitlist_signups
  add column if not exists confirmed     boolean not null default false,
  add column if not exists confirm_token uuid    not null default gen_random_uuid(),
  add column if not exists confirmed_at  timestamptz,
  add column if not exists last_sent_at  timestamptz;

create unique index if not exists waitlist_signups_token_key
  on public.waitlist_signups (confirm_token);

-- Obstoječe prijave (iz časa pred potrjevanjem) štejemo za potrjene,
-- da ne izginejo s seznama.
update public.waitlist_signups
   set confirmed    = true,
       confirmed_at = coalesce(confirmed_at, created_at)
 where confirmed = false;


-- ---------------------------------------------------------------------
-- 4) Na javni seznam se vrstica prepiše šele ob POTRDITVI
--    (prej se je ob vpisu — zato trigger predelamo)
-- ---------------------------------------------------------------------
drop trigger if exists waitlist_publish_trg on public.waitlist_signups;

create or replace function public.waitlist_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nepotrjena prijava na javni seznam ne gre.
  if not new.confirmed then
    return new;
  end if;

  -- Pri UPDATE objavimo samo prehod false → true, ne vsakega popravka.
  -- (Pogoja NE združujemo v en OR: pri INSERT zapis OLD ne obstaja in
  --  bi sklicevanje nanj vrglo "record old is not assigned yet".)
  if tg_op = 'UPDATE' and old.confirmed then
    return new;
  end if;

  insert into public.waitlist_public (id, masked_email, is_creator, created_at)
  values (new.id,
          public.mask_email(new.email),
          new.is_creator,
          coalesce(new.confirmed_at, now()))
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger waitlist_publish_trg
  after insert or update of confirmed on public.waitlist_signups
  for each row execute function public.waitlist_publish();


-- ---------------------------------------------------------------------
-- 5) Pošiljanje potrditvenega maila (Brevo)
--    Funkcija je namenoma nedosegljiva iz brskalnika.
-- ---------------------------------------------------------------------
create or replace function public.waitlist_send_confirmation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_token uuid;
  v_key   text;
  v_from  text;
  v_site  text;
  v_url   text;
  v_html  text;
  v_text  text;
begin
  select email, confirm_token into v_email, v_token
    from public.waitlist_signups where id = p_id;
  if v_email is null then return; end if;

  select value into v_key  from public.app_secrets where key = 'brevo_api_key';
  select value into v_from from public.app_secrets where key = 'mail_from';
  select value into v_site from public.app_secrets where key = 'site_url';

  if v_key is null or v_from is null or v_site is null then
    raise warning 'waitlist: v app_secrets manjkajo brevo_api_key / mail_from / site_url';
    return;
  end if;

  v_url := rtrim(v_site, '/') || '/confirm.html?token=' || v_token::text;

  v_html := $html$
<!doctype html>
<html><body style="margin:0;padding:0;background:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#171717;border:1px solid rgba(255,255,255,.10);border-radius:20px;">
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 22px;font:800 12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:#8f8f8f;">OUTLY&nbsp;&nbsp;·&nbsp;&nbsp;WAITLIST</p>
          <h1 style="margin:0 0 14px;font:800 27px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ededed;letter-spacing:-.02em;">You made it onto the list.</h1>
          <p style="margin:0 0 14px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            Congratulations — you&rsquo;ve joined the waitlist for <strong style="color:#ededed;">Outly</strong>, the app that finally answers the eternal question: <em>&ldquo;where should we go tonight?&rdquo;</em>
          </p>
          <p style="margin:0 0 26px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            One last thing — tap the button so we know this inbox is really yours.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 8px;">
          <a href="$html$ || v_url || $html$" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">Confirm my spot</a>
        </td></tr>
        <tr><td style="padding:22px 28px 30px;">
          <p style="margin:0 0 18px;font:400 14px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            Once you&rsquo;re confirmed, you&rsquo;ll be among the first in when we launch in your city. Nothing else lands in your inbox until then — promise.
          </p>
          <p style="margin:0 0 6px;font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#7d7d7d;">
            Button not working? Paste this into your browser:<br>
            <span style="color:#9bb0ff;word-break:break-all;">$html$ || v_url || $html$</span>
          </p>
          <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            Didn&rsquo;t sign up? Just ignore this email — nothing happens without that click.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
$html$;

  v_text :=
    'You made it onto the list.' || E'\n\n' ||
    'Congratulations - you have joined the waitlist for Outly, the app that finally answers "where should we go tonight?"' || E'\n\n' ||
    'One last thing - open this link so we know this inbox is really yours:' || E'\n' || v_url || E'\n\n' ||
    'Once you are confirmed, you will be among the first in when we launch in your city.' || E'\n' ||
    'Didn''t sign up? Just ignore this email - nothing happens without that click.';

  perform net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object(
                 'api-key',      v_key,
                 'content-type', 'application/json',
                 'accept',       'application/json'
               ),
    body    := jsonb_build_object(
                 'sender',      jsonb_build_object('name', 'Outly', 'email', v_from),
                 'to',          jsonb_build_array(jsonb_build_object('email', v_email)),
                 'subject',     'You''re on the list 🎟️',
                 'htmlContent', v_html,
                 'textContent', v_text
               )
  );

  update public.waitlist_signups set last_sent_at = now() where id = p_id;
end;
$$;

-- Iz brskalnika te funkcije ni mogoče poklicati.
revoke all on function public.waitlist_send_confirmation(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6) Prijava na waitlist — edina pot, po kateri brskalnik vpisuje
--    Vrne: 'sent' | 'resent' | 'already_confirmed'
--          | 'invalid' | 'disposable' | 'busy'
-- ---------------------------------------------------------------------
create or replace function public.join_waitlist(
  p_email      text,
  p_is_user    boolean default true,
  p_is_creator boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_domain text;
  v_row    public.waitlist_signups%rowtype;
  v_recent int;
begin
  v_email  := lower(btrim(p_email));
  v_domain := split_part(v_email, '@', 2);

  -- Oblika naslova
  if v_email !~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$'
     or char_length(v_email) > 254 then
    return 'invalid';
  end if;

  -- Začasni ("one-time") predali nimajo smisla na waitlisti
  if v_domain = any (array[
       'mailinator.com','10minutemail.com','guerrillamail.com','tempmail.com',
       'temp-mail.org','throwawaymail.com','yopmail.com','trashmail.com',
       'sharklasers.com','getnada.com','maildrop.cc','dispostable.com',
       'fakeinbox.com','mytemp.email','moakt.com','tempr.email','emailondeck.com'
     ]) then
    return 'disposable';
  end if;

  -- Groba zaščita pred množičnim pošiljanjem (poraba mail kvote)
  select count(*) into v_recent
    from public.waitlist_signups
   where created_at > now() - interval '1 hour';
  if v_recent > 60 then
    return 'busy';
  end if;

  select * into v_row
    from public.waitlist_signups
   where lower(email) = v_email;

  if found then
    if v_row.confirmed then
      return 'already_confirmed';
    end if;

    -- Isti naslov ne dobi novega maila pogosteje kot na 2 minuti
    if v_row.last_sent_at is not null
       and v_row.last_sent_at > now() - interval '2 minutes' then
      return 'sent';
    end if;

    perform public.waitlist_send_confirmation(v_row.id);
    return 'resent';
  end if;

  insert into public.waitlist_signups (email, is_user, is_creator)
  values (v_email, coalesce(p_is_user, true), coalesce(p_is_creator, false))
  returning * into v_row;

  perform public.waitlist_send_confirmation(v_row.id);
  return 'sent';
end;
$$;


-- ---------------------------------------------------------------------
-- 7) Potrditev s klikom v mailu
--    Vrne: 'ok' | 'already' | 'invalid'
-- ---------------------------------------------------------------------
create or replace function public.confirm_waitlist(p_token uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.waitlist_signups%rowtype;
begin
  select * into v_row
    from public.waitlist_signups
   where confirm_token = p_token;

  if not found then
    return 'invalid';
  end if;

  if v_row.confirmed then
    return 'already';
  end if;

  update public.waitlist_signups
     set confirmed = true, confirmed_at = now()
   where id = v_row.id;

  return 'ok';
end;
$$;


-- ---------------------------------------------------------------------
-- 8) Pravice: brskalnik sme klicati samo ti dve funkciji
-- ---------------------------------------------------------------------
drop policy if exists "anon can join waitlist" on public.waitlist_signups;
revoke insert on public.waitlist_signups from anon, authenticated;

revoke all on function public.join_waitlist(text, boolean, boolean) from public;
revoke all on function public.confirm_waitlist(uuid)                from public;

grant execute on function public.join_waitlist(text, boolean, boolean) to anon, authenticated;
grant execute on function public.confirm_waitlist(uuid)                to anon, authenticated;


-- =====================================================================
--  KAJ MORAŠ NAREDITI ŠE TI
--  ---------------------------------------------------------------
--  1. Odpri brezplačen račun na https://www.brevo.com
--
--  2. Potrdi pošiljatelja (ker še nimaš domene):
--        Senders, Domains & Dedicated IPs → Senders → Add a sender
--        Vpiši outly.team@gmail.com → Brevo pošlje potrditveni mail
--        na ta naslov → klikni povezavo v njem.
--
--  3. Ustvari API ključ:
--        SMTP & API → API Keys → Generate a new API key
--        Kopiraj ga (začne se z "xkeysib-").
--
--  4. Tu v SQL Editorju poženi (z vstavljenimi svojimi vrednostmi):
--
--        insert into public.app_secrets (key, value) values
--          ('brevo_api_key', 'xkeysib-TVOJ-KLJUC'),
--          ('mail_from',     'outly.team@gmail.com'),
--          ('site_url',      'https://djurdje.github.io/outly_webpage')
--        on conflict (key) do update set value = excluded.value;
--
--  5. Test: prijavi se na strani s svojim naslovom in preveri predal.
--
--  Če mail ne pride, poglej zadnje odgovore Brevo API-ja:
--        select created, status_code, content
--          from net._http_response
--         order by created desc limit 5;
-- =====================================================================
