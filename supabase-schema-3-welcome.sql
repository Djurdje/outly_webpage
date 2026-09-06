-- =====================================================================
--  Outly — waitlist, 3. del: POZDRAVNI MAIL PO POTRDITVI
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
--  (Pred tem morata biti pognana `supabase-schema.sql` in
--   `supabase-schema-2-confirm.sql`.)
-- =====================================================================
--
--  ZAKAJ: po kliku na "Confirm my spot" uporabnik vidi potrditev samo
--  na spletni strani. Če zavihek zapre, mu v predalu ne ostane nič in
--  čez teden dni ne ve več, ali je na seznamu. Ta migracija doda še en
--  kratek mail, ki potrdi uvrstitev.
--
--  POZOR: vsaka prijava odslej porabi DVA maila namesto enega.
--  Brezplačni Brevo dovoli 300 mailov na dan.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Sled o poslanem pozdravnem mailu
--    Preprečuje dvojno pošiljanje, če bi funkcijo kdaj pognal ročno.
-- ---------------------------------------------------------------------
alter table public.waitlist_signups
  add column if not exists welcome_sent_at timestamptz;


-- ---------------------------------------------------------------------
-- 2) Pošiljanje pozdravnega maila (Brevo)
--    Iz brskalnika nedosegljiva, enako kot potrditveni mail.
-- ---------------------------------------------------------------------
create or replace function public.waitlist_send_welcome(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_key   text;
  v_from  text;
  v_site  text;
  v_html  text;
  v_text  text;
begin
  -- Samo enkrat na prijavo.
  select email into v_email
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

  v_html := $wm$
<!doctype html>
<html><body style="margin:0;padding:0;background:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#171717;border:1px solid rgba(255,255,255,.10);border-radius:20px;">
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 22px;font:800 12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:#8f8f8f;">OUTLY&nbsp;&nbsp;&middot;&nbsp;&nbsp;WAITLIST</p>
          <h1 style="margin:0 0 14px;font:800 27px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ededed;letter-spacing:-.02em;">You&rsquo;re in.</h1>
          <p style="margin:0 0 14px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            Your spot on the <strong style="color:#ededed;">Outly</strong> waitlist is confirmed. Nothing else to do &mdash; we&rsquo;ve got your email and you&rsquo;re on the list.
          </p>
          <p style="margin:0 0 26px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            You&rsquo;ll be among the first in when we launch in your city. Keep this email if you ever want to check you&rsquo;re really on the list.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 8px;">
          <a href="$wm$ || v_site || $wm$" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">See what&rsquo;s coming</a>
        </td></tr>
        <tr><td style="padding:22px 28px 30px;">
          <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            You received this because you confirmed your spot on the Outly waitlist. We won&rsquo;t email you again until launch.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
$wm$;

  v_text :=
    'You are in.' || E'\n\n' ||
    'Your spot on the Outly waitlist is confirmed. Nothing else to do - we have your email and you are on the list.' || E'\n\n' ||
    'You will be among the first in when we launch in your city.' || E'\n' ||
    v_site || E'\n\n' ||
    'You received this because you confirmed your spot on the Outly waitlist. We will not email you again until launch.';

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
                 'subject',     'You are in - welcome to Outly',
                 'htmlContent', v_html,
                 'textContent', v_text
               )
  );

  update public.waitlist_signups
     set welcome_sent_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.waitlist_send_welcome(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3) Potrditev s klikom v mailu — zdaj sproži še pozdravni mail
--    (Edina sprememba glede na 2. del je vrstica `perform`.)
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

  -- Pozdravni mail. Če pošiljanje ne uspe, potrditev vseeno obvelja.
  perform public.waitlist_send_welcome(v_row.id);

  return 'ok';
end;
$$;

revoke all on function public.confirm_waitlist(uuid) from public;
grant execute on function public.confirm_waitlist(uuid) to anon, authenticated;


-- =====================================================================
--  PREIZKUS
--  ---------------------------------------------------------------
--  1. Prijavi se na strani z novim naslovom.
--  2. Klikni "Confirm my spot" v prvem mailu.
--  3. V predal mora priti drugi mail: "You are in - welcome to Outly".
--  4. Preveri odgovor Brevo API-ja:
--        select created, status_code, content
--          from net._http_response
--         order by created desc limit 3;
--     Pričakovano: 201 in messageId.
-- =====================================================================
