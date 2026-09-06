-- =====================================================================
--  Outly — waitlist, 4. del: GDPR vrstica v obeh mailih
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
--  (Pred tem morajo biti pognani deli 1, 2 in 3.)
-- =====================================================================
--
--  ZAKAJ: 13. člen Splošne uredbe zahteva, da posameznik ve, kdo hrani
--  njegov naslov in kako ga izbriše. ZEKom-2 zahteva možnost odjave v
--  vsakem sporočilu neposrednega trženja. Ta migracija v nogo obeh
--  mailov doda povezavo na politiko zasebnosti in navodilo za izbris.
--
--  Spremenjeni sta samo besedili mailov; logika ostaja nespremenjena.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Potrditveni mail
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

  v_site := rtrim(v_site, '/');
  v_url  := v_site || '/confirm.html?token=' || v_token::text;

  v_html := $h1$
<!doctype html>
<html><body style="margin:0;padding:0;background:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#171717;border:1px solid rgba(255,255,255,.10);border-radius:20px;">
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 22px;font:800 12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:#8f8f8f;">OUTLY&nbsp;&nbsp;&middot;&nbsp;&nbsp;WAITLIST</p>
          <h1 style="margin:0 0 14px;font:800 27px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ededed;letter-spacing:-.02em;">You made it onto the list.</h1>
          <p style="margin:0 0 14px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            Congratulations &mdash; you&rsquo;ve joined the waitlist for <strong style="color:#ededed;">Outly</strong>, the app that finally answers the eternal question: <em>&ldquo;where should we go tonight?&rdquo;</em>
          </p>
          <p style="margin:0 0 26px;font:400 15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            One last thing &mdash; tap the button so we know this inbox is really yours.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 8px;">
          <a href="$h1$ || v_url || $h1$" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">Confirm my spot</a>
        </td></tr>
        <tr><td style="padding:22px 28px 30px;">
          <p style="margin:0 0 18px;font:400 14px/1.6 Inter,Helvetica,Arial,sans-serif;color:#b4b4b4;">
            Once you&rsquo;re confirmed, you&rsquo;ll be among the first in when we launch in your city. Nothing else lands in your inbox until then &mdash; promise.
          </p>
          <p style="margin:0 0 6px;font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#7d7d7d;">
            Button not working? Paste this into your browser:<br>
            <span style="color:#9bb0ff;word-break:break-all;">$h1$ || v_url || $h1$</span>
          </p>
          <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            Didn&rsquo;t sign up? Just ignore this email &mdash; nothing happens without that click.<br>
            We store your email address only to notify you at launch. Reply to this email and we will delete it straight away.
            <a href="$h1$ || v_site || $h1$/privacy.html" style="color:#9bb0ff;">Privacy Policy</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
$h1$;

  v_text :=
    'You made it onto the list.' || E'\n\n' ||
    'Congratulations - you have joined the waitlist for Outly, the app that finally answers "where should we go tonight?"' || E'\n\n' ||
    'One last thing - open this link so we know this inbox is really yours:' || E'\n' || v_url || E'\n\n' ||
    'Once you are confirmed, you will be among the first in when we launch in your city.' || E'\n' ||
    'Didn''t sign up? Just ignore this email - nothing happens without that click.' || E'\n\n' ||
    'We store your email address only to notify you at launch. Reply to this email and we will delete it straight away.' || E'\n' ||
    'Privacy Policy: ' || v_site || '/privacy.html';

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

revoke all on function public.waitlist_send_confirmation(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2) Pozdravni mail
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

  v_html := $h2$
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
          <a href="$h2$ || v_site || $h2$" style="display:inline-block;background:#4C76FF;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:14px;">See what&rsquo;s coming</a>
        </td></tr>
        <tr><td style="padding:22px 28px 30px;">
          <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font:400 12px/1.6 Inter,Helvetica,Arial,sans-serif;color:#6e6e6e;">
            You received this because you confirmed your spot on the Outly waitlist. We won&rsquo;t email you again until launch.<br>
            We store your email address only for that purpose. Reply to this email and we will delete it straight away.
            <a href="$h2$ || v_site || $h2$/privacy.html" style="color:#9bb0ff;">Privacy Policy</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
$h2$;

  v_text :=
    'You are in.' || E'\n\n' ||
    'Your spot on the Outly waitlist is confirmed. Nothing else to do - we have your email and you are on the list.' || E'\n\n' ||
    'You will be among the first in when we launch in your city.' || E'\n' ||
    v_site || E'\n\n' ||
    'You received this because you confirmed your spot on the Outly waitlist. We will not email you again until launch.' || E'\n' ||
    'We store your email address only for that purpose. Reply to this email and we will delete it straight away.' || E'\n' ||
    'Privacy Policy: ' || v_site || '/privacy.html';

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
