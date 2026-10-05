-- supabase-schema-14-zapri-staro-prosnjo.sql
-- Varnostni pregled 5. 10. 2026. POZENE MARTIN v Supabase SQL Editorju (projekt zbewqcxnvrwebxonvebx).
--
-- Stara funkcija submit_creator_application (schema 6) je bila odprta za anon, ceprav je Creator.html od
-- 11. 9. 2026 ne uporablja vec (prosnja gre na backend POST /creator-applications). Funkcija:
--   - v interni mail ekipi vstavi vnos uporabnika brez ubezanja (HTML vrinjenje v mail, ki ga prejmeta luka@ in fedja@),
--   - poslje potrdilo na poljuben e-naslov iz obrazca (kdorkoli lahko z njo posilja maile z luka@outly.si na tuje naslove).
-- Ta skripta ji samo ODVZAME pravico izvajanja za anon/authenticated. Podatki in tabela creator_applications
-- ostanejo nedotaknjeni; nic se ne brise. Povratno: ponovno pozeni vrstico GRANT iz supabase-schema-6-creators.sql.

revoke execute on function public.submit_creator_application(text,text,text,text,text,text,text,text,text) from anon, authenticated, public;

-- Preverba (mora vrniti false, false):
select has_function_privilege('anon', 'public.submit_creator_application(text,text,text,text,text,text,text,text,text)', 'execute') as anon_lahko,
       has_function_privilege('authenticated', 'public.submit_creator_application(text,text,text,text,text,text,text,text,text)', 'execute') as prijavljen_lahko;
