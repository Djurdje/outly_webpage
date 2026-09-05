-- =====================================================================
--  Outly — waitlist schema
--  Zaženi to enkrat v Supabase: Dashboard → SQL Editor → New query → Run
-- =====================================================================
--
--  Zasnova (dve tabeli namesto ene):
--
--    waitlist_signups  → PRIVATNA. Hrani cele email naslove.
--                        Anon ključ ima samo pravico INSERT, nikoli SELECT,
--                        zato celih emailov ni mogoče prebrati iz brskalnika.
--
--    waitlist_public   → JAVNA. Hrani samo maskiran email ("j***@gmail.com").
--                        Iz nje bere seznam na strani in nanjo je vezan
--                        Realtime, tako da tudi realtime payload ne more
--                        razkriti pravega emaila.
--
--  Tabeli poveže trigger, ki ob vsaki novi prijavi zapiše maskirano vrstico.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Privatna tabela s pravimi emaili
-- ---------------------------------------------------------------------
create table if not exists public.waitlist_signups (
  id          uuid primary key default gen_random_uuid(),
  email       text        not null,
  is_user     boolean     not null default true,
  is_creator  boolean     not null default false,
  created_at  timestamptz not null default now(),

  -- validacija na strani baze (poleg validacije v brskalniku)
  constraint waitlist_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$'),
  constraint waitlist_email_length check (char_length(email) between 5 and 254)
);

-- Preprečuje dvojne prijave (case-insensitive: Jan@X.com == jan@x.com)
create unique index if not exists waitlist_signups_email_key
  on public.waitlist_signups (lower(email));


-- ---------------------------------------------------------------------
-- 2) Maskiranje emaila
-- ---------------------------------------------------------------------
create or replace function public.mask_email(addr text)
returns text
language sql
immutable
as $$
  select left(split_part(addr, '@', 1), 1) || '***@' || split_part(addr, '@', 2);
$$;


-- ---------------------------------------------------------------------
-- 3) Javna tabela — samo maskirani podatki
-- ---------------------------------------------------------------------
create table if not exists public.waitlist_public (
  id          uuid primary key
              references public.waitlist_signups(id) on delete cascade,
  masked_email text       not null,
  is_creator  boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists waitlist_public_created_at_idx
  on public.waitlist_public (created_at desc);


-- ---------------------------------------------------------------------
-- 4) Trigger: ob novi prijavi zapiši maskirano vrstico v javno tabelo
-- ---------------------------------------------------------------------
create or replace function public.waitlist_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.waitlist_public (id, masked_email, is_creator, created_at)
  values (new.id, public.mask_email(new.email), new.is_creator, new.created_at);
  return new;
end;
$$;

drop trigger if exists waitlist_publish_trg on public.waitlist_signups;
create trigger waitlist_publish_trg
  after insert on public.waitlist_signups
  for each row execute function public.waitlist_publish();


-- ---------------------------------------------------------------------
-- 5) Row Level Security
-- ---------------------------------------------------------------------
alter table public.waitlist_signups enable row level security;
alter table public.waitlist_public  enable row level security;

-- Kdorkoli se sme prijaviti ...
drop policy if exists "anon can join waitlist" on public.waitlist_signups;
create policy "anon can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (true);

-- ... nihče (razen service_role) pa ne sme brati pravih emailov.
-- (namenoma NI select policy na waitlist_signups)

-- Maskiran seznam sme brati vsak.
drop policy if exists "anyone can read masked waitlist" on public.waitlist_public;
create policy "anyone can read masked waitlist"
  on public.waitlist_public
  for select
  to anon, authenticated
  using (true);


-- ---------------------------------------------------------------------
-- 6) Grants (dodatna varovalka poleg RLS)
-- ---------------------------------------------------------------------
revoke all on public.waitlist_signups from anon, authenticated;
grant insert on public.waitlist_signups to anon, authenticated;

revoke all on public.waitlist_public from anon, authenticated;
grant select on public.waitlist_public to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7) Realtime — oddajaj spremembe SAMO iz javne (maskirane) tabele
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.waitlist_public;
exception
  when duplicate_object then null;   -- tabela je že v publikaciji
end $$;


-- =====================================================================
--  Kako prebereš prave emaile (za pošiljanje ob lansiranju):
--    Dashboard → Table Editor → waitlist_signups
--  ali v SQL Editorju:
--    select email, is_user, is_creator, created_at
--      from public.waitlist_signups
--     order by created_at desc;
--  Oboje teče pod service_role, zato RLS tega ne blokira.
-- =====================================================================
