/* Odjemalec Supabase Auth (isti projekt kot iOS in outly.si). supabase-js (vendor/, UMD)
   in supabase-config.js se nalozita kot navadni skripti pred tem modulom.
   Seja je v localStorage pod privzetim kljucem, ki ga uporablja tudi auth.js na outly.si -
   prijava na strani in v spletni aplikaciji je ena. */
const cfg = window.OUTLY_SUPABASE;

export const supabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Prijava in ponastavitev gesla gresta s kodo iz maila (kot iOS), ne s povezavo.
    detectSessionInUrl: false
  }
});
