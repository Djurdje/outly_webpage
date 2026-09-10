-- =====================================================================
--  Outly waitlist — 10) Uporabniški računi na spletni strani
-- ---------------------------------------------------------------------
--  Poganjaj v Supabase → SQL Editor, ENKRAT, po shemah 1–9.
--  Varno za ponovni zagon.
--
--  Kaj naredi (odločeno 10. 9. 2026):
--   – registracija/prijava gre prek Supabase Auth (e-mail + geslo);
--     ta datoteka Auth NE nastavlja — glej "KAJ MORAŠ NAREDITI ŠE TI" spodaj,
--   – prijavljen uporabnik se z e-naslovom poveže s svojo vrstico na
--     waitlisti (sync_my_account); če ga tam še ni, ga dodamo kot POTRJENEGA,
--     ker je e-naslov potrdil že Auth,
--   – uporabniško ime (set_username) se na javnem seznamu kaže namesto
--     maskiranega e-naslova (stolpec waitlist_public.display_name),
--   – invite link + točke (my_profile): 1 točka = 1 povabljeni, ki je
--     POTRDIL e-naslov; nepotrjeni se štejejo posebej ("pending"),
--   – brisanje računa (delete_my_account) izbriše Auth uporabnika IN
--     prijavo na waitlisti.
--  Invite link se od zdaj kaže samo registriranim (confirm.html ga ne kaže
--  več); stari linki iz mailov še naprej delajo, ker so kode iste.
-- =====================================================================

-- 1) Stolpci -----------------------------------------------------------
alter table public.waitlist_signups
  add column if not exists user_id  uuid references auth.users(id) on delete set null,
  add column if not exists username text;

create unique index if not exists waitlist_signups_user_id_key
  on public.waitlist_signups (user_id) where user_id is not null;
create unique index if not exists waitlist_signups_username_key
  on public.waitlist_signups (lower(username)) where username is not null;

alter table public.waitlist_public
  add column if not exists display_name text;

-- Vsak potrjen uporabnik z usernamom mora imeti vrstico v javni tabeli z
-- display_name; to uredi razširjeni trigger iz sheme 2.
create or replace function public.waitlist_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.confirmed then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.confirmed then
    -- Že objavljen: osvežimo samo prikazno ime (če se je spremenilo).
    if new.username is distinct from old.username then
      update public.waitlist_public
         set display_name = new.username
       where id = new.id;
    end if;
    return new;
  end if;

  insert into public.waitlist_public (id, masked_email, is_creator, created_at, display_name)
  values (new.id,
          public.mask_email(new.email),
          new.is_creator,
          coalesce(new.confirmed_at, now()),
          new.username)
  on conflict (id) do update set display_name = excluded.display_name;

  return new;
end;
$$;

drop trigger if exists waitlist_publish_trg on public.waitlist_signups;
create trigger waitlist_publish_trg
  after insert or update of confirmed, username on public.waitlist_signups
  for each row execute function public.waitlist_publish();

-- 2) Pomožno: e-naslov prijavljenega uporabnika iz žetona ----------------
create or replace function public.auth_email()
returns text
language sql
stable
as $$
  select lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- 3) Povezava računa z waitlisto (kliče stran takoj po prijavi) ----------
--    Vrne jsonb kot my_profile().
create or replace function public.sync_my_account(p_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text := public.auth_email();
  v_row    public.waitlist_signups%rowtype;
  v_ref_id uuid;
begin
  if v_uid is null or v_email = '' then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Že povezan?
  select * into v_row from public.waitlist_signups where user_id = v_uid;

  if not found then
    -- Isti e-naslov je morda že na waitlisti (prijava prek forme).
    select * into v_row from public.waitlist_signups where lower(email) = v_email;

    if found then
      update public.waitlist_signups
         set user_id      = v_uid,
             confirmed    = true,
             confirmed_at = coalesce(confirmed_at, now())
       where id = v_row.id;
    else
      if p_ref is not null and length(btrim(p_ref)) between 4 and 12 then
        select id into v_ref_id from public.waitlist_signups
         where ref_code = upper(btrim(p_ref));
      end if;

      insert into public.waitlist_signups
             (email, is_user, is_creator, confirmed, confirmed_at, user_id, referred_by)
      values (v_email, true, false, true, now(), v_uid, v_ref_id)
      returning * into v_row;
    end if;

    -- Pozdravni mail (kot pri potrditvi prek forme); če ga je že dobil, funkcija ne naredi nič.
    begin
      perform public.waitlist_send_welcome(v_row.id);
    exception when others then
      raise warning 'sync_my_account: welcome mail failed: %', sqlerrm;
    end;
  end if;

  return public.my_profile();
end;
$$;

-- 4) Profil (username, koda, točke) --------------------------------------
create or replace function public.my_profile()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
           'email',     s.email,
           'username',  s.username,
           'ref_code',  s.ref_code,
           'points',    (select count(*) from public.waitlist_signups r
                          where r.referred_by = s.id and r.confirmed),
           'pending',   (select count(*) from public.waitlist_signups r
                          where r.referred_by = s.id and not r.confirmed),
           'joined_at', s.created_at
         )
    from public.waitlist_signups s
   where s.user_id = auth.uid();
$$;

-- 5) Uporabniško ime -----------------------------------------------------
--    Vrne: 'ok' | 'invalid' | 'taken' | 'not_linked'
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(p_username);
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- 3–20 znakov: črke, številke, pika, podčrtaj; ne sme se začeti ali končati s piko.
  if v_name !~ '^[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,18}[A-Za-z0-9_])?$' then
    return 'invalid';
  end if;

  select id into v_id from public.waitlist_signups where user_id = auth.uid();
  if v_id is null then
    return 'not_linked';
  end if;

  if exists (select 1 from public.waitlist_signups
              where lower(username) = lower(v_name) and id <> v_id) then
    return 'taken';
  end if;

  update public.waitlist_signups set username = v_name where id = v_id;
  return 'ok';
end;
$$;

-- 6) Brisanje računa -----------------------------------------------------
--    Izbriše Auth uporabnika (s tem sejo) in prijavo na waitlisti.
--    Vabila, ki jih je ta uporabnik pripeljal, ostanejo (referred_by → null).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.waitlist_signups where user_id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

-- 7) Pravice ------------------------------------------------------------
revoke all on function public.auth_email()          from public;
revoke all on function public.sync_my_account(text) from public;
revoke all on function public.my_profile()          from public;
revoke all on function public.set_username(text)    from public;
revoke all on function public.delete_my_account()   from public;

grant execute on function public.sync_my_account(text) to authenticated;
grant execute on function public.my_profile()          to authenticated;
grant execute on function public.set_username(text)    to authenticated;
grant execute on function public.delete_my_account()   to authenticated;

-- Javni seznam: display_name je v isti tabeli, ki jo anon že sme brati
-- (select policy iz sheme 1 velja za vse stolpce). Realtime za UPDATE
-- (zamenjava maila z usernamom v živo) potrebuje polno identiteto vrstice:
alter table public.waitlist_public replica identity full;

-- =====================================================================
--  KAJ MORAŠ NAREDITI ŠE TI (Supabase → Authentication)
--  ---------------------------------------------------------------
--  1. Sign In / Providers → Email: vklopljeno; "Confirm email": vklopljeno.
--  2. URL Configuration → Site URL: https://outly.si
--     Redirect URLs: https://outly.si/*  (in za lokalni test http://localhost:*)
--  3. Emails → SMTP Settings → Enable Custom SMTP:
--       Host smtp-relay.brevo.com, Port 587, User = Brevo login,
--       Pass = Brevo SMTP ključ (NE API ključ), Sender luka@outly.si "Outly".
--     Brez tega Supabase pošlje največ 2 maila na uro → registracije ne delajo.
--  4. Emails → Templates: "Confirm signup" in "Reset password" po želji
--     prilagodi (besedilo je angleško, v slogu ostalih mailov).
--
--  Preizkus po zagonu:
--   select username, display_name from public.waitlist_signups s
--     join public.waitlist_public p on p.id = s.id where s.username is not null;
-- =====================================================================
