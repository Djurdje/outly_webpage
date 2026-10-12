-- supabase-schema-16-waitlist-omejitev.sql
-- Varnostni pregled 12. 10. 2026 (outly-backend#223). POZENE MARTIN v Supabase SQL Editorju (projekt zbewqcxnvrwebxonvebx),
-- po shemah 14 in 15 (od njiju ni tehnicno odvisna, a vrstni red je 14 -> 15 -> 16).
--
-- Kaj je bilo narobe v join_waitlist (shema 9, v produkciji enaka):
--   (a) Ponovno posiljanje potrditve ('resent') ni steto nikamor. Napadalec je lahko ze obstojeco NEPOTRJENO vrstico (tuj
--       naslov) zasipal z mailom z luka@outly.si vsaki 2 minuti, neomejeno dolgo; ker so omejevale samo NOVE vrstice
--       (60/h), je to veljalo za vse nepotrjene naslove, ki so se nabrali v preteklosti. Posledica: poraba Brevo kvote,
--       slab sloves posiljatelja, nadlegovanje tujcev.
--   (b) Meja 60 novih vrstic/uro se je preverjala PRED vsem ostalim, zato je 61 smetnih prijav v uri vsem (tudi ze
--       potrjenim in tistim, ki le ponovno prosijo za mail) vrnilo 'busy'.
--
-- Kaj naredi ta skripta (podpis funkcije, pravice in vrnjene vrednosti ostanejo enaki: 'invalid' | 'disposable' | 'busy' |
-- 'already_confirmed' | 'sent' | 'resent'; waitlist.js se ne spremeni):
--   1) Nov stolpec waitlist_signups.confirm_sends int not null default 0 = koliko ponovnih posiljanj je ta vrstica ze dobila.
--      ADD COLUMN s konstantnim DEFAULT je hiter (brez prepisa tabele), obstojeci podatki se ne spremenijo (vse vrstice dobijo 0).
--   2) Najvec 3 ponovna posiljanja na vrstico (skupaj, ne na uro). Ko je meja dosezena, funkcija vrne isti odgovor 'resent',
--      a NE poslje maila, tako da odgovor ne razkrije nic vec kot prej. Stetje je atomarno (UPDATE ... WHERE confirm_sends < 3).
--      Pocasen napadalec zato iz ene vrstice dobi najvec 1 + 3 maile, ne neskoncno.
--   3) Urna meja (ostane > 60) zdaj steje NEPOTRJENE vrstice, ki so v zadnji uri dobile potrditveni mail (new ali resend):
--      last_sent_at > now() - 1 uro AND NOT confirmed. Tako (a) ponovna posiljanja stejejo v mejo, in (b) vrstice, ki jih
--      pravi uporabniki v nekaj minutah potrdijo, mejo sprostijo, zato naval pravih prijav ne povzroca 'busy'. Meja se
--      preverja samo tam, kjer bi funkcija res poslala mail (nova vrstica, ponovno posiljanje); 'already_confirmed',
--      2-minutna zapora ('sent') in dosezena meja ponovnih posiljanj ('resent') ne vrnejo vec 'busy'.
--   OMEJITEV (iskreno): funkcija ne pozna IP-ja, zato ne more prepoznati napadalca od pravih uporabnikov. Kdor namenoma polni
--   mejo z 61 nepotrjenimi naslovi v uri, jo se vedno zapre za nove prijave do izteka ure (najvec 1 ura, ponavljati mora
--   vsako uro). Pravo zdravilo je preverjanje na robu (Cloudflare Turnstile ali prijava prek backenda z mejo po IP) - to je
--   locena odlocitev. Mejo steje po naslovih (vrstica se v uri steje enkrat), skupno pa jo omejuje se meja 3 ponovnih
--   posiljanj na vrstico: dolgorocno najvec 4 maili na naslov.
--   Stranski ucinek: pravi uporabnik, ki je ze 3x prosil za ponovno posiljanje, dobi odgovor 'resent' brez maila (stran mu
--   pise "On its way"). Takemu je treba pomagati rocno (npr. v SQL Editorju: update public.waitlist_signups set confirm_sends = 0
--   where lower(email) = '...';) ali pa se registrira v aplikaciji / na strani z geslom (sync_my_account potrdi naslov sam).
--
-- Nic se ne brise, nobena vrstica se ne posodobi (razen novega stolpca z DEFAULT). Skripta je idempotentna.
--
-- Povratno: pozeni funkcijo join_waitlist iz supabase-schema-9-referral.sql (razdelek 2, brez "drop function ... " vrstice)
-- in po zelji: alter table public.waitlist_signups drop column if exists confirm_sends;

alter table public.waitlist_signups
  add column if not exists confirm_sends int not null default 0;

create or replace function public.join_waitlist(
  p_email      text,
  p_is_user    boolean default true,
  p_is_creator boolean default false,
  p_ref        text    default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ura_meja   constant int := 60;   -- najvec nepotrjenih naslovov, ki smejo v eni uri dobiti potrditveni mail
  c_ponovitev  constant int := 3;    -- najvec ponovnih posiljanj na vrstico (skupaj)
  v_email  text;
  v_domain text;
  v_row    public.waitlist_signups%rowtype;
  v_recent int;
  v_ref_id uuid;
  v_id     uuid;
begin
  v_email  := lower(btrim(p_email));
  v_domain := split_part(v_email, '@', 2);

  if v_email !~* '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$'
     or char_length(v_email) > 254 then
    return 'invalid';
  end if;

  if v_domain = any (array[
       'mailinator.com','10minutemail.com','guerrillamail.com','tempmail.com',
       'temp-mail.org','throwawaymail.com','yopmail.com','trashmail.com',
       'sharklasers.com','getnada.com','maildrop.cc','dispostable.com',
       'fakeinbox.com','mytemp.email','moakt.com','tempr.email','emailondeck.com'
     ]) then
    return 'disposable';
  end if;

  select * into v_row
    from public.waitlist_signups
   where lower(email) = v_email;

  if found then
    -- Obstojeca prijava: povabitelja NE spreminjamo (sicer bi si ga kdo "prepisal").
    if v_row.confirmed then
      return 'already_confirmed';
    end if;
    if v_row.last_sent_at is not null
       and v_row.last_sent_at > now() - interval '2 minutes' then
      return 'sent';
    end if;
    -- Meja ponovnih posiljanj dosezena: enak odgovor kot pri posiljanju, brez maila.
    if v_row.confirm_sends >= c_ponovitev then
      return 'resent';
    end if;

    select count(*) into v_recent
      from public.waitlist_signups
     where last_sent_at > now() - interval '1 hour'
       and not confirmed;
    if v_recent > c_ura_meja then
      return 'busy';
    end if;

    -- Atomarno zasedi eno od dovoljenih ponovitev; ce je med tem ze zasedena, mail ne gre.
    update public.waitlist_signups
       set confirm_sends = confirm_sends + 1
     where id = v_row.id
       and not confirmed
       and confirm_sends < c_ponovitev
    returning id into v_id;
    if v_id is null then
      return 'resent';
    end if;

    perform public.waitlist_send_confirmation(v_row.id);
    return 'resent';
  end if;

  select count(*) into v_recent
    from public.waitlist_signups
   where last_sent_at > now() - interval '1 hour'
     and not confirmed;
  if v_recent > c_ura_meja then
    return 'busy';
  end if;

  -- Povabitelj: koda mora obstajati; neveljavna koda prijave ne ustavi.
  if p_ref is not null and length(btrim(p_ref)) between 4 and 12 then
    select id into v_ref_id
      from public.waitlist_signups
     where ref_code = upper(btrim(p_ref));
  end if;

  insert into public.waitlist_signups (email, is_user, is_creator, referred_by)
  values (v_email, coalesce(p_is_user, true), coalesce(p_is_creator, false), v_ref_id)
  returning * into v_row;

  perform public.waitlist_send_confirmation(v_row.id);
  return 'sent';
end;
$$;

-- Pravice kot doslej: anon in authenticated NAMERNO smeta klicati (waitlist.js z javnim kljucem).
revoke all on function public.join_waitlist(text, boolean, boolean, text) from public;
grant execute on function public.join_waitlist(text, boolean, boolean, text) to anon, authenticated;

-- Preverba (mora vrniti: stolpec dodan = true, funkcija ima podpis 4 parametrov, security definer, search_path=public,
-- anon lahko klice = true, javno (PUBLIC) = false):
select (select count(*) = 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'waitlist_signups' and column_name = 'confirm_sends') as stolpec_dodan,
       p.oid::regprocedure::text as funkcija,
       p.prosecdef as security_definer,
       p.proconfig as nastavitve,
       has_function_privilege('anon', p.oid, 'execute')   as anon_lahko,
       has_function_privilege('public', p.oid, 'execute') as javno_lahko
  from pg_proc p
 where p.oid = 'public.join_waitlist(text,boolean,boolean,text)'::regprocedure;
