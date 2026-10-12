-- supabase-schema-15-pravice-rpc.sql
-- Varnostni pregled 12. 10. 2026 (outly-backend#223). POZENE MARTIN v Supabase SQL Editorju (projekt zbewqcxnvrwebxonvebx),
-- PO shemi 14 (supabase-schema-14-zapri-staro-prosnjo.sql, ta zapre submit_creator_application - tukaj je ne podvajamo).
--
-- Zakaj: vzorec "revoke all on function ... from public" (sheme 2, 9, 10, 13) anonu ne odvzame EXECUTE, ker ga Supabase
-- (default privileges) da vlogam anon in authenticated neposredno. Ta skripta pravice uskladi z namenom (outly-backend#223).
--
-- Kaj naredi ta skripta (stanje kataloga preverjeno 12. 10. 2026 s pg_proc / pg_get_function_identity_arguments):
--   1) sync_my_account(text), my_profile(), set_username(text), delete_my_account(): odvzame EXECUTE od anon in public;
--      authenticated OSTANE (auth.js jih klice po prijavi, backend index.js klice delete_my_account z uporabnikovim zetonom).
--   2) auth_email(), gen_ref_code(), mask_email(text), mask_name(text), waitlist_set_ref_code(), waitlist_publish(),
--      referral_status(uuid), referral_leaderboard(integer): odvzame EXECUTE od anon, authenticated in public.
--      Kliceta jih samo funkcije SECURITY DEFINER (tecejo kot postgres) in sprozilca (za sprozilec se EXECUTE preverja samo
--      ob CREATE TRIGGER, ne ob sprozitvi). service_role in postgres pravico obdrzita.
--   3) ALTER FUNCTION ... SET search_path = public za 5 funkcij brez nastavljenega search_path (auth_email, gen_ref_code,
--      mask_email, mask_name, waitlist_set_ref_code). Nobena ni SECURITY DEFINER; to je samo utrditev.
--   NAMERNO JAVNO (anon + authenticated) ostanejo: join_waitlist(text,boolean,boolean,text), confirm_waitlist(uuid),
--   referrer_public(text) - klice jih waitlist.js / confirm.js z javnim kljucem. Ne dotaknemo se jih.
--   rls_auto_enable() je event trigger, ki ga upravlja Supabase - ne dotaknemo se ga (prek RPC ni klicljiv, ker vraca event_trigger).
--
-- Nic se ne brise, podatki in tabele ostanejo nedotaknjeni. Skripta je idempotentna (varno za ponovni zagon).
--
-- Povratno (vrni stanje iz kataloga 12. 10. 2026):
--   grant execute on function public.sync_my_account(text), public.my_profile(), public.set_username(text),
--         public.delete_my_account(), public.auth_email(), public.referral_status(uuid),
--         public.referral_leaderboard(integer) to anon, authenticated;
--   grant execute on function public.gen_ref_code(), public.mask_email(text), public.mask_name(text),
--         public.waitlist_set_ref_code(), public.waitlist_publish() to public, anon, authenticated;
--   alter function public.auth_email() reset search_path;   -- enako za gen_ref_code(), mask_email(text), mask_name(text),
--                                                           -- waitlist_set_ref_code()
--
-- Opomba: Supabasovi privzeti privilegiji bodo tudi PRIHODNJIM funkcijam v shemi public spet dali EXECUTE anonu. Vsaka nova
-- funkcija mora imeti izrecen "revoke execute ... from anon, public" (ne samo "from public").

begin;

-- 1) Funkcije za prijavljene: anon/public ven, authenticated ostane -------------------------------------------------------
revoke execute on function public.sync_my_account(text) from anon, public;
revoke execute on function public.my_profile()          from anon, public;
revoke execute on function public.set_username(text)    from anon, public;
revoke execute on function public.delete_my_account()   from anon, public;

grant execute on function public.sync_my_account(text) to authenticated;
grant execute on function public.my_profile()          to authenticated;
grant execute on function public.set_username(text)    to authenticated;
grant execute on function public.delete_my_account()   to authenticated;

-- 2) Pomozne, sprozilne in nekliccane funkcije: zaprte za vse razen postgres/service_role ----------------------------------
revoke execute on function public.auth_email()                 from anon, authenticated, public;
revoke execute on function public.gen_ref_code()               from anon, authenticated, public;
revoke execute on function public.mask_email(text)             from anon, authenticated, public;
revoke execute on function public.mask_name(text)              from anon, authenticated, public;
revoke execute on function public.waitlist_set_ref_code()      from anon, authenticated, public;
revoke execute on function public.waitlist_publish()           from anon, authenticated, public;
revoke execute on function public.referral_status(uuid)        from anon, authenticated, public;
revoke execute on function public.referral_leaderboard(integer) from anon, authenticated, public;

-- 3) Utrditev: fiksen search_path na funkcijah, kjer ga ni -----------------------------------------------------------------
alter function public.auth_email()            set search_path = public;
alter function public.gen_ref_code()          set search_path = public;
alter function public.mask_email(text)        set search_path = public;
alter function public.mask_name(text)         set search_path = public;
alter function public.waitlist_set_ref_code() set search_path = public;

commit;

-- PREVERBA (SQL Editor pokaze samo zadnji rezultat, zato je ena vrstica): mora vrniti napak = 0, vrstic = 20.
-- Ce napak > 0: odkomentiraj podrobni preverbi spodaj in ju pozeni vsako posebej.
with pricak(sig, pricak_anon, pricak_auth) as (values
    ('public.sync_my_account(text)',            false, true),
    ('public.my_profile()',                     false, true),
    ('public.set_username(text)',               false, true),
    ('public.delete_my_account()',              false, true),
    ('public.join_waitlist(text,boolean,boolean,text)', true, true),
    ('public.confirm_waitlist(uuid)',           true,  true),
    ('public.referrer_public(text)',            true,  true),
    ('public.auth_email()',                     false, false),
    ('public.gen_ref_code()',                   false, false),
    ('public.mask_email(text)',                 false, false),
    ('public.mask_name(text)',                  false, false),
    ('public.waitlist_set_ref_code()',          false, false),
    ('public.waitlist_publish()',               false, false),
    ('public.referral_status(uuid)',            false, false),
    ('public.referral_leaderboard(integer)',    false, false)
), preverbe as (
  select has_function_privilege('anon', sig::regprocedure, 'execute') = pricak_anon
     and has_function_privilege('authenticated', sig::regprocedure, 'execute') = pricak_auth
     and has_function_privilege('public', sig::regprocedure, 'execute') = false as ok
    from pricak
  union all
  select coalesce('search_path=public' = any (p.proconfig), false)
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('auth_email', 'gen_ref_code', 'mask_email', 'mask_name', 'waitlist_set_ref_code')
)
select count(*) filter (where not ok) as napak, count(*) as vrstic from preverbe;

/* PODROBNO (samo ob napaki; vsako poizvedbo pozeni posebej):
-- Preverba 1: pravice. Stolpec "ok" mora biti povsod true (in vrstic mora biti 15).
select f.sig,
       has_function_privilege('anon',          f.sig::regprocedure, 'execute') as anon,
       has_function_privilege('authenticated', f.sig::regprocedure, 'execute') as prijavljen,
       has_function_privilege('public',        f.sig::regprocedure, 'execute') as javno,
       (has_function_privilege('anon',          f.sig::regprocedure, 'execute') = f.pricak_anon
        and has_function_privilege('authenticated', f.sig::regprocedure, 'execute') = f.pricak_auth
        and has_function_privilege('public',        f.sig::regprocedure, 'execute') = false) as ok
  from (values
    ('public.sync_my_account(text)',            false, true),
    ('public.my_profile()',                     false, true),
    ('public.set_username(text)',               false, true),
    ('public.delete_my_account()',              false, true),
    ('public.join_waitlist(text,boolean,boolean,text)', true, true),
    ('public.confirm_waitlist(uuid)',           true,  true),
    ('public.referrer_public(text)',            true,  true),
    ('public.auth_email()',                     false, false),
    ('public.gen_ref_code()',                   false, false),
    ('public.mask_email(text)',                 false, false),
    ('public.mask_name(text)',                  false, false),
    ('public.waitlist_set_ref_code()',          false, false),
    ('public.waitlist_publish()',               false, false),
    ('public.referral_status(uuid)',            false, false),
    ('public.referral_leaderboard(integer)',    false, false)
  ) as f(sig, pricak_anon, pricak_auth)
 order by f.pricak_anon desc, f.pricak_auth desc, f.sig;

-- Preverba 2: search_path. Vseh 5 vrstic mora imeti search_path = public (stolpec "ok" = true).
select p.oid::regprocedure::text as funkcija,
       p.proconfig,
       coalesce('search_path=public' = any (p.proconfig), false) as ok
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('auth_email', 'gen_ref_code', 'mask_email', 'mask_name', 'waitlist_set_ref_code')
 order by 1;
*/
