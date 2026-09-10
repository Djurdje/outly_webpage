-- Outly waitlist — 13) Kdo te je povabil (delno zakrito ime za pasico na strani), 10. 9. 2026
-- Poganjaj po shemi 12. Varno za ponovni zagon.
create or replace function public.referrer_public(p_ref text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.mask_name(s.username), public.mask_email(s.email))
    from public.waitlist_signups s
   where s.ref_code = upper(btrim(p_ref))
     and s.confirmed
   limit 1;
$$;
revoke all on function public.referrer_public(text) from public;
grant execute on function public.referrer_public(text) to anon, authenticated;

select 'shema 13 OK' as status;
