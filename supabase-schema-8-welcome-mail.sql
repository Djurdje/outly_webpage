-- =====================================================================
--  Outly — waitlist, 8. del: PRENOVLJEN POZDRAVNI MAIL
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
--  (Zamenja samo funkcijo iz `supabase-schema-3-welcome.sql`.)
-- =====================================================================
--
--  Enak slog kot prenovljeni potrditveni mail (7. del): znak Outly nad
--  kartico, kartica s temnim ozadjem, oznaka, naslov, en odstavek,
--  barvni trak in gumb.
--
--  Logika barv: MODRI trak = nekaj moraš narediti (potrditveni mail),
--               ZELENI trak = opravljeno (ta mail).
-- =====================================================================

create or replace function public.waitlist_send_welcome(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
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
