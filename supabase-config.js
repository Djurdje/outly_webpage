/* =====================================================================
   Outly — Supabase nastavitve
   ---------------------------------------------------------------------
   1) Ustvari brezplačen projekt na https://supabase.com
   2) Dashboard → SQL Editor → prilepi in poženi `supabase-schema.sql`
   3) Dashboard → Project Settings → API → prekopiraj obe vrednosti sem:

        Project URL                    →  url
        anon public / publishable key  →  anonKey

   Ta ključ (publishable) je namenjen javni uporabi v brskalniku — varnost zagotavljajo
   RLS politike iz `supabase-schema.sql` (anon lahko samo vpisuje prijave in
   bere maskiran seznam, celih emailov ne more prebrati).
   NIKOLI sem ne prilepi `service_role` ključa.

   Dokler sta vrednosti neizpolnjeni, forma deluje v demo načinu
   (izpiše zahvalo, ničesar ne shrani) in seznam se ne prikaže.
   ===================================================================== */

window.OUTLY_SUPABASE = {
  url: "https://zbewqcxnvrwebxonvebx.supabase.co",
  anonKey: "sb_publishable_NzgXZhG7RGs0mZMjGYtyig_XfOvepXS"
};
