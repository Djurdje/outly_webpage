-- =====================================================================
--  Outly waitlist — 9) Povabilo prijateljev (referral link)
-- ---------------------------------------------------------------------
--  Poganjaj v Supabase → SQL Editor, ENKRAT, po shemah 1–8.
--
--  Kaj naredi:
--   – vsaka prijava dobi kratko kodo (ref_code, 6 znakov brez 0/O/1/I),
--   – ?ref=KODA na strani se shrani kot referred_by ob NOVI prijavi,
--   – šteje se SAMO potrjeno vabilo (povabljeni je kliknil potrditveni mail),
--   – join_waitlist dobi 4. parameter p_ref (stara 3-parametrska se odstrani,
--     sicer je klic iz brskalnika dvoumen),
--   – referral_status(token): koda + stevilo potrjenih vabil za stran confirm.html,
--   – referral_leaderboard(n): top n z zakritimi e-naslovi (za kasneje),
--   – pozdravni mail dobi osebno povezavo.
--  Tock ali nagrad NI (odloceno 9. 9. 2026) — samo stetje.
--  Varno za ponovni zagon.
-- =====================================================================

-- 1) Koda: 6 znakov iz abecede brez zamenljivih znakov (~1 milijarda kombinacij)
create or replace function public.gen_ref_code()
returns text
language plpgsql
volatile
as $$
declare
  abc  constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    exit when not exists (select 1 from public.waitlist_signups where ref_code = code);
  end loop;
  return code;
end;
$$;

alter table public.waitlist_signups
  add column if not exists ref_code    text,
  add column if not exists referred_by uuid references public.waitlist_signups(id) on delete set null;

-- Obstojece vrstice dobijo kodo; nove jo dobijo ob vstavljanju (sprozilec, ne default,
-- ker default ne sme brati iz iste tabele med vstavljanjem vec vrstic).
update public.waitlist_signups set ref_code = public.gen_ref_code() where ref_code is null;

create or replace function public.waitlist_set_ref_code()
returns trigger language plpgsql as $$
begin
  if new.ref_code is null then new.ref_code := public.gen_ref_code(); end if;
  return new;
end;
$$;
drop trigger if exists waitlist_ref_code on public.waitlist_signups;
create trigger waitlist_ref_code
  before insert on public.waitlist_signups
  for each row execute function public.waitlist_set_ref_code();

create unique index if not exists waitlist_signups_ref_code_key on public.waitlist_signups (ref_code);
create index if not exists waitlist_signups_referred_by_idx on public.waitlist_signups (referred_by) where referred_by is not null;

-- 2) join_waitlist s kodo povabitelja
drop function if exists public.join_waitlist(text, boolean, boolean);

create or replace function public.join_waitlist(
  p_email      text,
  p_is_user    boolean default true,
  p_is_creator boolean default false,
  p_ref        text    default null
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
  v_ref_id uuid;
begin
  v_email  := lower(btrim(p_email));
  v_domain := split_part(v_email, '@', 2);

  if v_email !~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$'
     or char_length(v_email) > 254 then
    return 'invalid';
  end if;

  if v_domain = any (array[
       'mailinator.com','10minutemail.com','guerrillamail.com','tempmail.com',
       'temp-mail.org','throwawaymail.com','yopmail.com','trashmail.com',
       'sharklasers.com','getnada.com','maildrop.cc','dispostable.com',
       'fakeinbox.com','mytemp.email','moakt.com','tempr.email','emailondeck.com'
     ]) then
    return 'disposable';
  end if;

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
    -- Obstojeca prijava: povabitelja NE spreminjamo (sicer bi si ga kdo "prepisal").
    if v_row.confirmed then
      return 'already_confirmed';
    end if;
    if v_row.last_sent_at is not null
       and v_row.last_sent_at > now() - interval '2 minutes' then
      return 'sent';
    end if;
    perform public.waitlist_send_confirmation(v_row.id);
    return 'resent';
  end if;

  -- Povabitelj: koda mora obstajati; neveljavna koda prijave ne ustavi.
  if p_ref is not null and length(btrim(p_ref)) between 4 and 12 then
    select id into v_ref_id
      from public.waitlist_signups
     where ref_code = upper(btrim(p_ref));
  end if;

  insert into public.waitlist_signups (email, is_user, is_creator, referred_by)
  values (v_email, coalesce(p_is_user, true), coalesce(p_is_creator, false), v_ref_id)
  returning * into v_row;

  perform public.waitlist_send_confirmation(v_row.id);
  return 'sent';
end;
$$;

revoke all on function public.join_waitlist(text, boolean, boolean, text) from public;
grant execute on function public.join_waitlist(text, boolean, boolean, text) to anon, authenticated;

-- 3) Stanje vabil za potrditveno stran (dostop z zetonom iz maila)
create or replace function public.referral_status(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
           'ref_code',          s.ref_code,
           'confirmed_invites', (select count(*) from public.waitlist_signups r
                                  where r.referred_by = s.id and r.confirmed),
           'pending_invites',   (select count(*) from public.waitlist_signups r
                                  where r.referred_by = s.id and not r.confirmed)
         )
    from public.waitlist_signups s
   where s.confirm_token = p_token
     and s.confirmed;
$$;
revoke all on function public.referral_status(uuid) from public;
grant execute on function public.referral_status(uuid) to anon, authenticated;

-- 4) Lestvica (samo potrjeni povabitelji, samo potrjena vabila, e-naslov zakrit)
create or replace function public.referral_leaderboard(p_limit int default 10)
returns table (rank bigint, email_masked text, invites bigint)
language sql
security definer
set search_path = public
stable
as $$
  select row_number() over (order by count(r.id) desc, min(r.confirmed_at)) as rank,
         public.mask_email(s.email) as email_masked,
         count(r.id) as invites
    from public.waitlist_signups s
    join public.waitlist_signups r on r.referred_by = s.id and r.confirmed
   where s.confirmed
   group by s.id, s.email
   order by 3 desc, min(r.confirmed_at)
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.referral_leaderboard(int) from public;
grant execute on function public.referral_leaderboard(int) to anon, authenticated;

-- 5) Pogled za vaju (samo v SQL editorju / z servisnim kljucem — ni odprt za anon)
create or replace view public.referral_admin as
  select s.email, s.ref_code, s.confirmed,
         count(r.id) filter (where r.confirmed)     as confirmed_invites,
         count(r.id) filter (where not r.confirmed) as pending_invites,
         s.created_at
    from public.waitlist_signups s
    left join public.waitlist_signups r on r.referred_by = s.id
   group by s.id
   order by confirmed_invites desc, s.created_at;
revoke all on public.referral_admin from public, anon, authenticated;

-- 6) Pozdravni mail z osebno povezavo (zamenja funkcijo iz sheme 8)
create or replace function public.waitlist_send_welcome(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_email text;
  v_code  text;
  v_link  text;
  v_key   text;
  v_from  text;
  v_site  text;
  v_html  text;
  v_text  text;
begin
  -- Samo enkrat na prijavo.
  select email, ref_code into v_email, v_code
    from public.waitlist_signups
   where id = p_id
     and welcome_sent_at is null;
  if v_email is null then return; end if;

  select value into v_key  from public.app_secrets where key = 'brevo_api_key';
  select value into v_from from public.app_secrets where key = 'mail_from';
  select value into v_site from public.app_secrets where key = 'site_url';

  if v_key is null or v_from is null or v_site is null then
    raise warning 'waitlist: v app_secrets manjkajo brevo_api_key / mail_from / site_url';
    return;
  end if;

  v_site := rtrim(v_site, '/');
  v_link := v_site || '/?ref=' || v_code;

  v_html := $wm$<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

      <tr><td style="padding:0 4px 16px;">
        <p style="margin:0;font:800 19px/1 Inter,Helvetica,Arial,sans-serif;color:#EDEDED;letter-spacing:-.02em;">Outly</p>
      </td></tr>

      <tr><td style="background:#171717;border:1px solid rgba(255,255,255,.10);border-radius:20px;padding:34px 30px 28px;">

        <p style="margin:0 0 16px;font:800 11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#8F8F8F;">YOU ARE IN</p>

        <h1 style="margin:0 0 14px;font:800 26px/1.2 Inter,Helvetica,Arial,sans-serif;color:#EDEDED;letter-spacing:-.02em;">Your spot is confirmed.</h1>

        <p style="margin:0 0 20px;font:400 15px/1.65 Inter,Helvetica,Arial,sans-serif;color:#B4B4B4;">
          You are on the waitlist for <strong style="color:#EDEDED;">Outly</strong> &mdash; the app that answers the eternal question: <em>where should we go tonight?</em>
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:rgba(157,213,166,.10);border:1px solid rgba(157,213,166,.28);border-radius:12px;padding:13px 15px;">
            <p style="margin:0;font:600 13px/1.5 Inter,Helvetica,Arial,sans-serif;color:#A9DDB2;">
              Nothing else to do. We write once more, when Outly opens in your city.
            </p>
          </td></tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:22px 0 0;">
            <p style="margin:0 0 6px;font:800 11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#8F8F8F;">BRING YOUR CREW</p>
            <p style="margin:0 0 12px;font:400 14px/1.6 Inter,Helvetica,Arial,sans-serif;color:#B4B4B4;">
              Nights out are better together. Share your personal link &mdash; everyone who joins through it counts as your invite.
            </p>
            <p style="margin:0;background:#101010;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px 14px;font:600 14px/1.4 Inter,Helvetica,Arial,sans-serif;color:#EDEDED;word-break:break-all;">
              <a href="$wm$ || v_link || $wm$" style="color:#4C76FF;text-decoration:none;">$wm$ || v_link || $wm$</a>
            </p>
          </td></tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="padding:24px 0 4px;">
            <a href="$wm$ || v_site || $wm$" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">See what is coming</a>
          </td></tr>
        </table>

        <p style="margin:20px 0 0;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#7D7D7D;">
          Keep this email if you ever want to check that you are really on the list.
        </p>

      </td></tr>

      <tr><td style="padding:16px 8px 0;">
        <p style="margin:0;font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6E6E6E;">
          You are getting this because you confirmed your spot on the Outly waitlist. Nothing else lands in your inbox until launch.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>$wm$;

  v_text :=
    'Your spot is confirmed.' || E'\n\n' ||
    'You are on the waitlist for Outly - the app that answers the eternal question: where should we go tonight?' || E'\n\n' ||
    'Nothing else to do. We write once more, when Outly opens in your city.' || E'\n\n' ||
    v_site || E'\n\n' ||
    'Bring your crew - share your personal link, everyone who joins through it counts as your invite:' || E'\n' || v_link || E'\n\n' ||
    'You are getting this because you confirmed your spot on the Outly waitlist. Nothing else lands in your inbox until launch.';

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
                 'subject',     'You are on the Outly waitlist',
                 'htmlContent', v_html,
                 'textContent', v_text
               )
  );

  update public.waitlist_signups
     set welcome_sent_at = now()
   where id = p_id;
end;
$fn$;

revoke all on function public.waitlist_send_welcome(uuid) from public, anon, authenticated;

-- =====================================================================
--  Preizkus po zagonu:
--   select email, ref_code from public.waitlist_signups limit 3;   -- kode so
--   select * from public.referral_leaderboard(10);                 -- prazno, dokler ni vabil
--   select * from public.referral_admin limit 5;
-- =====================================================================
