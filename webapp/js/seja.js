/* Seja uporabnika: prijava prek Supabase, profil iz GET /me (kot SessionStore na iOS).
   Vloge odloca streznik; tu samo beremo, kaj je rekel. */
import { supabase } from "./supabase.js";
import { send, nastaviObZavrnjeniSeji, pocistiPredpomnilnik } from "./api.js";
import { ApiError } from "./napake.js";
import { ustvariTrgovino, useStore } from "./store.js";

export const seja = ustvariTrgovino({
  pripravljena: false,   // prvo branje seje iz localStorage je koncano
  prijavljen: false,
  email: "",
  me: null,              // odgovor GET /me
  meNapaka: null,        // napaka zadnjega nalaganja /me (ne 401)
  obvestilo: ""          // npr. "seja je potekla" - pokaze prijava
});

export const useSeja = (izb = s => s) => useStore(seja, izb);

/** Onboarding: samo navaden uporabnik brez onboarded_at (business/admin nikoli, kot iOS). */
export const potrebujeOnboarding = me => !!me && (me.role || "user") === "user" && !me.onboarded_at;

let zadnjiUid = null;

export async function zacniSejo() {
  nastaviObZavrnjeniSeji(() => odjava("Your session has expired. Please log in again."));
  let s = null;
  try { s = (await supabase.auth.getSession()).data.session; } catch { s = null; }
  posodobiIzSeje(s);
  seja.set({ pripravljena: true });
  if (s) naloziMe();
  supabase.auth.onAuthStateChange((dogodek, nova) => {
    const prej = zadnjiUid;
    posodobiIzSeje(nova);
    if (dogodek === "SIGNED_OUT") { seja.set({ me: null }); pocistiPredpomnilnik(); }
    else if (nova && nova.user && nova.user.id !== prej) naloziMe();
  });
}

function posodobiIzSeje(s) {
  zadnjiUid = s && s.user ? s.user.id : null;
  seja.set({ prijavljen: !!s, email: (s && s.user && s.user.email) || "" });
}

/** GET /me; ob 401 (tudi po osvezitvi) je seja mrtva -> odjava. 503 in omrezje: seja ostane. */
export async function naloziMe() {
  try {
    const me = await send("/me", { auth: true });
    seja.set({ me, meNapaka: null });
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await odjava("Your session has expired. Please log in again.");
      return null;
    }
    seja.set({ meNapaka: e });
    return null;
  }
}

export async function odjava(obvestilo = "") {
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* lokalno vseeno pocistimo */ }
  pocistiPredpomnilnik();
  seja.set({ prijavljen: false, me: null, meNapaka: null, obvestilo });
}

export function nastaviMe(me) { seja.set({ me }); }
