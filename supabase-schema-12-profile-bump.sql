-- Outly waitlist — 12) Ob ustvarjenem profilu vrstica skoči na vrh seznama (10. 9. 2026)
-- Poganjaj po shemi 11. Varno za ponovni zagon.
create or replace function public.waitlist_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.confirmed then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.confirmed then
    if new.username is distinct from old.username then
      update public.waitlist_public
         set display_name = public.mask_name(new.username),
             created_at   = case when old.username is null then now() else created_at end
       where id = new.id;
    end if;
    return new;
  end if;

  insert into public.waitlist_public (id, masked_email, is_creator, created_at, display_name)
  values (new.id,
          public.mask_email(new.email),
          new.is_creator,
          coalesce(new.confirmed_at, now()),
          public.mask_name(new.username))
  on conflict (id) do update set display_name = excluded.display_name;

  return new;
end;
$$;

select 'shema 12 OK' as status;
