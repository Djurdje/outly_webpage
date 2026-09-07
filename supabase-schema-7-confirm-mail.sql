-- =====================================================================
--  Outly — waitlist, 7. del: PRENOVLJEN POTRDITVENI MAIL
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
--  (Zamenja samo funkcijo iz `supabase-schema-2-confirm.sql`.)
-- =====================================================================
--
--  ZAKAJ: prejšnji mail se je začel z "You made it onto the list",
--  kar ni bilo res — prijava se šteje šele po kliku. Ljudje so mislili,
--  da so notri, mail pustili pri miru in nikoli niso bili na seznamu.
--
--  Novo besedilo pove eno stvar: to še ni konec, klikni gumb.
--  Slog sledi spletni strani (temno ozadje, kartica, modri gumb).
-- =====================================================================

create or replace function public.waitlist_send_confirmation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
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

  v_html := $html$<!doctype html>
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

        <p style="margin:0 0 16px;font:800 11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#8F8F8F;">ONE LAST STEP</p>

        <h1 style="margin:0 0 14px;font:800 26px/1.2 Inter,Helvetica,Arial,sans-serif;color:#EDEDED;letter-spacing:-.02em;">Confirm your email.</h1>

        <p style="margin:0 0 20px;font:400 15px/1.65 Inter,Helvetica,Arial,sans-serif;color:#B4B4B4;">
          You asked to join the waitlist for <strong style="color:#EDEDED;">Outly</strong> &mdash; the app that answers the eternal question: <em>where should we go tonight?</em>
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:rgba(76,118,255,.10);border:1px solid rgba(76,118,255,.28);border-radius:12px;padding:13px 15px;">
            <p style="margin:0;font:600 13px/1.5 Inter,Helvetica,Arial,sans-serif;color:#C4D0FF;">
              Your spot is not saved yet. Tap the button below and you are in.
            </p>
          </td></tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="padding:24px 0 4px;">
            <a href="$html$ || v_url || $html$" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">Confirm my spot</a>
          </td></tr>
        </table>

        <p style="margin:20px 0 0;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#7D7D7D;">
          Button not working? Paste this link into your browser:<br>
          <span style="color:#9BB0FF;word-break:break-all;">$html$ || v_url || $html$</span>
        </p>

      </td></tr>

      <tr><td style="padding:16px 8px 0;">
        <p style="margin:0;font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6E6E6E;">
          Once you confirm, you are on the list and you hear from us when Outly launches in your city. Nothing else lands in your inbox until then.
        </p>
        <p style="margin:10px 0 0;font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6E6E6E;">
          Did not sign up? Ignore this email &mdash; nothing is saved without that tap.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>$html$;

  v_text :=
    'Confirm your email.' || E'\n\n' ||
    'You asked to join the waitlist for Outly - the app that answers the eternal question: where should we go tonight?' || E'\n\n' ||
    'Your spot is not saved yet. Open this link and you are in:' || E'\n' || v_url || E'\n\n' ||
    'Once you confirm, you are on the list and you hear from us when Outly launches in your city.' || E'\n' ||
    'Did not sign up? Ignore this email - nothing is saved without that tap.';

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
                 'subject',     'Confirm your email to join the Outly waitlist',
                 'htmlContent', v_html,
                 'textContent', v_text
               )
  );

  update public.waitlist_signups set last_sent_at = now() where id = p_id;
end;
$fn$;

revoke all on function public.waitlist_send_confirmation(uuid) from public, anon, authenticated;
