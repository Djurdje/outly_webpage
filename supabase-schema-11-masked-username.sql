-- Outly waitlist — 11) Delno zakrito uporabniško ime na javnem seznamu (10. 9. 2026)
-- Poganjaj po shemi 10. Varno za ponovni zagon.
-- Na seznamu se registrirani kažejo kot "sef***" + "created a profile", ne s celim imenom.

create or replace function public.mask_name(u text)
returns text
language sql
immutable
as $$
  select case
           when u is null then null
           when char_length(u) <= 3 then left(u, 1) || '***'
           else left(u, greatest(2, char_length(u) / 2)) || '***'
         end;
$$;

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
         set display_name = public.mask_name(new.username)
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

-- Obstoječi registrirani uporabniki
update public.waitlist_public p
   set display_name = public.mask_name(s.username)
  from public.waitlist_signups s
 where s.id = p.id and s.username is not null;

select 'shema 11 OK' as status;
