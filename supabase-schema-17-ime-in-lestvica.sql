-- supabase-schema-17-ime-in-lestvica.sql
-- Varnostni pregled 12. 10. 2026 (outly-backend#223), NIZKE najdbe. POZENE MARTIN v Supabase SQL Editorju
-- (projekt zbewqcxnvrwebxonvebx), PO shemah 14, 15 in 16 (te so v produkciji pognane 12. 10. 2026).
--
-- Kaj naredi ta skripta (dve funkciji, podpis in vrnjeni tipi ostanejo enaki; nic se ne brise, noben podatek se ne spremeni):
--   1) set_username(text): oblika imena je zdaj ista kot na backendu (PATCH /me v outly-backend/index.js):
--        STARO: 1-20 znakov, dovoljena pika (ne na zacetku/koncu): ^[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,18}[A-Za-z0-9_])?$
--               (prepustilo je ime dolzine 1 in 'a.b'; NULL je mimo preverbe prisel do UPDATE ... username = NULL)
--        NOVO:  3-20 znakov, samo ASCII crke, stevke in podcrtaj: ^[A-Za-z0-9_]{3,20}$; NULL -> 'invalid'.
--      Presledki na robovih se se vedno odrezejo (btrim), enolicnost je se vedno brez razlikovanja velikih/malih crk
--      (lower(), kot LOWER(username) na backendu). Vrnjene vrednosti: 'ok' | 'invalid' | 'taken' | 'not_linked' (enako kot prej;
--      auth.js ob vsem razen 'ok' samo opozori v konzoli, backend PATCH /me pa je ze zavrnil napacno obliko).
--      Filtra prepovedanih imen (#218, prepovedana_imena.js) NAMERNO ne podvajamo: ostane samo na backendu.
--      POZOR: ze shranjena imena na waitlisti (npr. s piko ali krajsa od 3) se ne spremenijo; samo ponovni klic set_username
--      z njimi vrne 'invalid'. Kolikor jih je, pokaze neobvezna poizvedba na dnu datoteke.
--   2) referral_leaderboard(integer): stolpec email_masked ne pokaze vec cele domene.
--        STARO: s***@gmail.com   (mask_email: prva crka + *** + CELA domena)
--        NOVO:  registriran (ima uporabnisko ime): mask_name(username), npr. sef***  (kot referrer_public, shema 13)
--               sicer s***@g***.com  (prva crka lokalnega dela, prva crka domene, koncnica)
--      Vrstni red, filtri, limit in tip vrnjenih stolpcev (rank bigint, email_masked text, invites bigint) so nespremenjeni.
--      Funkcije ne klice nobena stran (script.js, auth.js, waitlist.js, webapp/ jo ne omenjajo) in od sheme 15 je ne more klicati
--      noben odjemalec (EXECUTE samo postgres/service_role); javni seznam (waitlist_public.masked_email, display_name) se ne dotakne.
--
-- Pravice: CREATE OR REPLACE jih ohrani; na koncu jih vseeno izrecno potrdimo (kot v shemi 15): set_username samo authenticated,
-- referral_leaderboard nihce razen postgres/service_role. SECURITY DEFINER in search_path = public ostaneta.
-- Skripta je idempotentna (varno za ponovni zagon).
--
-- Povratno: pozeni definicijo set_username iz supabase-schema-10-accounts.sql (razdelek 5) in referral_leaderboard iz
-- supabase-schema-9-referral.sql (razdelek 4), brez njunih vrstic revoke/grant (pravice kot po shemi 15).

begin;

-- 1) set_username -------------------------------------------------------------------------------------------------------
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

  -- 3-20 znakov: ASCII crke, stevke, podcrtaj (enako kot backend PATCH /me). NULL ni veljavno ime.
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,20}$' then
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

-- 2) referral_leaderboard -----------------------------------------------------------------------------------------------
create or replace function public.referral_leaderboard(p_limit int default 10)
returns table (rank bigint, email_masked text, invites bigint)
language sql
security definer
set search_path = public
stable
as $$
  select row_number() over (order by count(r.id) desc, min(r.confirmed_at)) as rank,
         coalesce(
           public.mask_name(s.username),
           left(split_part(s.email, '@', 1), 1) || '***@'
             || case
                  when split_part(s.email, '@', 2) = '' then '***'
                  when position('.' in split_part(s.email, '@', 2)) = 0 then left(split_part(s.email, '@', 2), 1) || '***'
                  else left(split_part(s.email, '@', 2), 1) || '***.' || substring(split_part(s.email, '@', 2) from '[^.]*$')
                end
         ) as email_masked,
         count(r.id) as invites
    from public.waitlist_signups s
    join public.waitlist_signups r on r.referred_by = s.id and r.confirmed
   where s.confirmed
   group by s.id, s.email, s.username
   order by 3 desc, min(r.confirmed_at)
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- 3) Pravice (potrditev stanja iz sheme 15) -------------------------------------------------------------------------------
revoke execute on function public.set_username(text) from anon, public;
grant  execute on function public.set_username(text) to authenticated;

revoke execute on function public.referral_leaderboard(integer) from anon, authenticated, public;

commit;

-- PREVERBA (SQL Editor pokaze samo zadnji rezultat, zato je ena vrstica). Pricakovano: vse stiri vrednosti true.
select (select pg_get_functiondef('public.set_username(text)'::regprocedure) like '%{3,20}%'
           and pg_get_functiondef('public.set_username(text)'::regprocedure) not like '%[A-Za-z0-9_.]%')            as set_username_novo_pravilo,
       (select pg_get_functiondef('public.referral_leaderboard(integer)'::regprocedure) like '%mask_name%')         as lestvica_zakriva_domeno,
       (select p.prosecdef and p.proconfig = array['search_path=public']
          from pg_proc p where p.oid = 'public.set_username(text)'::regprocedure)
       and (select p.prosecdef and p.proconfig = array['search_path=public']
          from pg_proc p where p.oid = 'public.referral_leaderboard(integer)'::regprocedure)                         as definer_in_search_path,
       not has_function_privilege('anon',          'public.set_username(text)', 'execute')
       and     has_function_privilege('authenticated', 'public.set_username(text)', 'execute')
       and not has_function_privilege('public',        'public.set_username(text)', 'execute')
       and not has_function_privilege('anon',          'public.referral_leaderboard(integer)', 'execute')
       and not has_function_privilege('authenticated', 'public.referral_leaderboard(integer)', 'execute')
       and not has_function_privilege('public',        'public.referral_leaderboard(integer)', 'execute')            as pravice_ok;

/* NEOBVEZNO, samo branje (pozeni posebej): koliko ze shranjenih imen na waitlisti ne ustreza novemu pravilu
   (ne spremeni se nic; samo stevilo, brez imen):
select count(*) as imen_mimo_pravila
  from public.waitlist_signups
 where username is not null and username !~ '^[A-Za-z0-9_]{3,20}$';
*/
