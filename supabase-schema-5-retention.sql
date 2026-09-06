-- =====================================================================
--  Outly — waitlist, 5. del: SAMODEJNO BRISANJE PO ROKU HRAMBE
--  Zaženi v Supabase: Dashboard → SQL Editor → New query → Run
-- =====================================================================
--
--  ZAKAJ: politika zasebnosti na outly.si/privacy.html obljublja:
--    – nepotrjene prijave se izbrišejo najkasneje 90 dni po prijavi
--    – potrjene prijave najkasneje 24 mesecev po potrditvi
--  Obljuba, ki se ne izvaja, je slabša od tega, da je ne bi dal.
--  Ta migracija doda funkcijo in dnevni urnik, ki to opravi sam.
--
--  Brisanje iz waitlist_signups zaradi ON DELETE CASCADE samodejno
--  odstrani tudi maskirano vrstico iz javnega seznama waitlist_public.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Funkcija za čiščenje
--    Vrne, koliko vrstic je pobrisala, da se da izvajanje preveriti.
-- ---------------------------------------------------------------------
create or replace function public.waitlist_purge()
returns table (nepotrjene int, potrjene int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unconfirmed int;
  v_confirmed   int;
begin
  with d as (
    delete from public.waitlist_signups
     where confirmed = false
       and created_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::int into v_unconfirmed from d;

  with d as (
    delete from public.waitlist_signups
     where confirmed = true
       and coalesce(confirmed_at, created_at) < now() - interval '24 months'
    returning 1
  )
  select count(*)::int into v_confirmed from d;

  raise notice 'waitlist_purge: nepotrjene=% potrjene=%', v_unconfirmed, v_confirmed;

  nepotrjene := v_unconfirmed;
  potrjene   := v_confirmed;
  return next;
end;
$$;

-- Iz brskalnika te funkcije ni mogoče poklicati.
revoke all on function public.waitlist_purge() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2) Dnevni urnik ob 03:00 UTC
--    pg_cron teče na strani baze, neodvisno od spletne strani.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

-- Če urnik z istim imenom že obstaja, ga najprej odstranimo,
-- da migracije ne moremo pognati dvakrat in dobiti dveh opravil.
select cron.unschedule('waitlist-purge')
 where exists (select 1 from cron.job where jobname = 'waitlist-purge');

select cron.schedule(
  'waitlist-purge',
  '0 3 * * *',
  $cron$ select public.waitlist_purge(); $cron$
);


-- =====================================================================
--  PREVERBA
--  ---------------------------------------------------------------
--  Urnik:
--      select jobid, jobname, schedule, active from cron.job;
--
--  Zadnji zagoni:
--      select jobid, status, return_message, start_time
--        from cron.job_run_details
--       order by start_time desc limit 10;
--
--  Ročni zagon (varno, briše samo, kar je res poteklo):
--      select * from public.waitlist_purge();
--
--  Koliko vrstic bi bilo danes pobrisanih:
--      select
--        count(*) filter (where not confirmed and created_at < now() - interval '90 days')  as nepotrjene,
--        count(*) filter (where confirmed and coalesce(confirmed_at, created_at) < now() - interval '24 months') as potrjene
--      from public.waitlist_signups;
-- =====================================================================
