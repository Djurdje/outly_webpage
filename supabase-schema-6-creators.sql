-- =====================================================================
--  Outly — 6. del: PRIJAVE CREATORJEV V BAZO
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
-- =====================================================================
--
--  ZAKAJ: dosedanji obrazec na Creator.html je ob oddaji samo odprl
--  Gmail z novim sporočilom, v katerega ni prepisal nobenega vnesenega
--  podatka. Prijave torej niso prišle nikamor. Kdor nima Gmaila, je
--  obtičal. Ta migracija naredi prijavo pravo: podatki gredo v bazo,
--  ti dobiš obvestilo po mailu, prijavitelj pa potrdilo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Tabela prijav — zasebna, iz brskalnika neberljiva
-- ---------------------------------------------------------------------
create table if not exists public.creator_applications (
  id               uuid primary key default gen_random_uuid(),
  business_name    text not null,
  business_type    text,
  business_address text,
  city             text,
  licence_id       text,
  contact_name     text not null,
  contact_role     text,
  email            text not null,
  phone            text,
  status           text not null default 'new',
  created_at       timestamptz not null default now(),

  constraint creator_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$'),
  constraint creator_email_length check (char_length(email) between 5 and 254)
);

alter table public.creator_applications enable row level security;
revoke all on public.creator_applications from anon, authenticated;

create index if not exists creator_applications_created_idx
  on public.creator_applications (created_at desc);


-- ---------------------------------------------------------------------
-- 2) Obvestilo tebi + potrdilo prijavitelju
-- ---------------------------------------------------------------------
create or replace function public.creator_send_mails(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r       public.creator_applications%rowtype;
  v_key   text;
  v_from  text;
  v_site  text;
  v_team  text;
  v_html  text;
begin
  select * into r from public.creator_applications where id = p_id;
  if not found then return; end if;

  select value into v_key  from public.app_secrets where key = 'brevo_api_key';
  select value into v_from from public.app_secrets where key = 'mail_from';
  select value into v_site from public.app_secrets where key = 'site_url';
  select value into v_team from public.app_secrets where key = 'team_email';

  if v_key is null or v_from is null or v_site is null then
    raise warning 'creator: v app_secrets manjkajo brevo_api_key / mail_from / site_url';
    return;
  end if;

  v_site := rtrim(v_site, '/');
  v_team := coalesce(v_team, v_from);

  -- --- obvestilo ekipi -------------------------------------------------
  v_html :=
    '<h2 style="font:800 18px Inter,Arial,sans-serif;">New creator application</h2>' ||
    '<table cellpadding="6" style="font:400 14px Inter,Arial,sans-serif;border-collapse:collapse;">' ||
    '<tr><td><b>Business</b></td><td>'  || coalesce(r.business_name,'-')    || '</td></tr>' ||
    '<tr><td><b>Type</b></td><td>'      || coalesce(r.business_type,'-')    || '</td></tr>' ||
    '<tr><td><b>Address</b></td><td>'   || coalesce(r.business_address,'-') || '</td></tr>' ||
    '<tr><td><b>City</b></td><td>'      || coalesce(r.city,'-')             || '</td></tr>' ||
    '<tr><td><b>Licence ID</b></td><td>'|| coalesce(r.licence_id,'-')       || '</td></tr>' ||
    '<tr><td><b>Contact</b></td><td>'   || coalesce(r.contact_name,'-')     || '</td></tr>' ||
    '<tr><td><b>Role</b></td><td>'      || coalesce(r.contact_role,'-')     || '</td></tr>' ||
    '<tr><td><b>Email</b></td><td>'     || r.email                          || '</td></tr>' ||
    '<tr><td><b>Phone</b></td><td>'     || coalesce(r.phone,'-')            || '</td></tr>' ||
    '<tr><td><b>Received</b></td><td>'  || to_char(r.created_at at time zone 'Europe/Ljubljana', 'DD.MM.YYYY HH24:MI') || '</td></tr>' ||
    '</table>';

  perform net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', v_key, 'content-type', 'application/json', 'accept', 'application/json'),
    body    := jsonb_build_object(
                 'sender',      jsonb_build_object('name', 'Outly', 'email', v_from),
                 'to',          jsonb_build_array(jsonb_build_object('email', v_team)),
                 'replyTo',     jsonb_build_object('email', r.email),
                 'subject',     'Creator application: ' || r.business_name,
                 'htmlContent', v_html
               )
  );

  -- --- potrdilo prijavitelju -------------------------------------------
  v_html := $c$
<!doctype html>
<html><body style="margin:0;padding:0;background:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#171717;border:1px solid rgba(255,255,255,.10);border-radius:20px;">
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 22px;font:800 12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:#8f8f8f;">OUTLY&nbsp;&nbsp;&middot;&nbsp;&nbsp;CREATORS</p>
          <h1 style="margin:0 0 14px;font:800 27px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ededed;letter-spacing:-.02em;">We got your application.</h1>
          <p style="margin:0 0 14px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            Thanks for applying to become an <strong style="color:#ededed;">Outly</strong> creator. A real person reads every application &mdash; we will get back to you at this address.
          </p>
          <p style="margin:0 0 22px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            If we need your business licence, proof of ownership, tax number or bank details, we will ask for them in our reply. Please do not send documents before we ask.
          </p>
          <p style="margin:16px 0 30px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            We store the details you submitted in order to review your application. Reply to this email if you want them deleted.
            <a href="$c$ || v_site || $c$/privacy.html" style="color:#9bb0ff;">Privacy Policy</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
$c$;

  perform net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', v_key, 'content-type', 'application/json', 'accept', 'application/json'),
    body    := jsonb_build_object(
                 'sender',      jsonb_build_object('name', 'Outly', 'email', v_from),
                 'to',          jsonb_build_array(jsonb_build_object('email', r.email)),
                 'subject',     'We got your Outly creator application',
                 'htmlContent', v_html
               )
  );
end;
$$;

revoke all on function public.creator_send_mails(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3) Edina pot, po kateri brskalnik oddaja prijavo
--    Vrne: 'ok' | 'invalid' | 'duplicate' | 'busy'
-- ---------------------------------------------------------------------
create or replace function public.submit_creator_application(
  p_business_name    text,
  p_business_type    text default null,
  p_business_address text default null,
  p_city             text default null,
  p_licence_id       text default null,
  p_contact_name     text default null,
  p_contact_role     text default null,
  p_email            text default null,
  p_phone            text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_id    uuid;
  v_recent int;
begin
  v_email := lower(btrim(coalesce(p_email, '')));

  if btrim(coalesce(p_business_name,'')) = ''
     or btrim(coalesce(p_contact_name,'')) = ''
     or v_email !~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$'
     or char_length(v_email) > 254 then
    return 'invalid';
  end if;

  -- Groba zaščita pred zasipavanjem
  select count(*) into v_recent
    from public.creator_applications
   where created_at > now() - interval '1 hour';
  if v_recent > 20 then
    return 'busy';
  end if;

  -- Ista prijava v zadnjih 24 urah se ne podvaja
  if exists (
    select 1 from public.creator_applications
     where lower(email) = v_email
       and created_at > now() - interval '24 hours'
  ) then
    return 'duplicate';
  end if;

  insert into public.creator_applications (
    business_name, business_type, business_address, city, licence_id,
    contact_name, contact_role, email, phone
  ) values (
    btrim(p_business_name), nullif(btrim(coalesce(p_business_type,'')),''),
    nullif(btrim(coalesce(p_business_address,'')),''), nullif(btrim(coalesce(p_city,'')),''),
    nullif(btrim(coalesce(p_licence_id,'')),''), btrim(p_contact_name),
    nullif(btrim(coalesce(p_contact_role,'')),''), v_email,
    nullif(btrim(coalesce(p_phone,'')),'')
  )
  returning id into v_id;

  perform public.creator_send_mails(v_id);
  return 'ok';
end;
$$;

revoke all on function public.submit_creator_application(text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_creator_application(text,text,text,text,text,text,text,text,text) to anon, authenticated;


-- =====================================================================
--  NASTAVI ŠE NASLOV, KAMOR NAJ PRIHAJAJO OBVESTILA
--  (če vrstice ni, gredo na isti naslov kot pošiljatelj)
--
--      insert into public.app_secrets (key, value)
--      values ('team_email', 'luka@outly.si')
--      on conflict (key) do update set value = excluded.value;
--
--  Pregled prijav:
--      select created_at, business_name, city, contact_name, email, phone, status
--        from public.creator_applications
--       order by created_at desc;
-- =====================================================================
