/* =====================================================================
   Outly — potrditvena stran (klik iz potrditvenega maila)
   ---------------------------------------------------------------------
   Iz naslova prebere ?token=… in ga pošlje funkciji confirm_waitlist()
   v bazi. Šele ta klic uvrsti prijavo na javni seznam.
   ===================================================================== */

(() => {
  "use strict";

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const card    = document.getElementById("confirmCard");
  const icon    = document.getElementById("confirmIcon");
  const kicker  = document.getElementById("confirmKicker");
  const title   = document.getElementById("confirmTitle");
  const text    = document.getElementById("confirmText");
  const actions = document.getElementById("confirmActions");

  const ICONS = {
    ok:    '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l5.2 5.2L20 7"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 6.5v7.2M12 17.6v.1"/></svg>'
  };

  function show(state, kickerText, titleText, bodyText) {
    card.classList.remove("is-loading");
    card.classList.add(state === "ok" ? "is-ok" : "is-error");
    icon.innerHTML = ICONS[state === "ok" ? "ok" : "error"];
    kicker.textContent = kickerText;
    title.textContent = titleText;
    text.textContent = bodyText;
    actions.hidden = false;
    document.title = titleText + " – Outly";
  }

  const token = new URLSearchParams(location.search).get("token");

  // Grob preizkus oblike, da za očitno pokvarjeno povezavo ne kličemo baze.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!token || !isUuid.test(token)) {
    show("error", "LINK PROBLEM", "This link looks broken.",
      "Copy the full link from the email — it may have been cut in half by your mail app. Or just sign up again and we'll send a fresh one.");
    return;
  }

  const cfg = window.OUTLY_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) {
    show("error", "SOMETHING'S OFF", "We can't reach our servers.",
      "Please try the link again in a minute.");
    return;
  }

  // Odjemalca ustvari auth.js (deljena seja); brez njega ga naredimo tukaj.
  const client = window.OUTLY_CLIENT || window.supabase.createClient(cfg.url, cfg.anonKey);

  // "Create an account" odpre registracijo v plosci (auth.js); brez nje pelje domov.
  const regBtn = document.getElementById("confirmRegister");
  if (regBtn) regBtn.addEventListener("click", () => {
    if (window.OutlyAuth) window.OutlyAuth.open("register");
    else location.href = "index.html";
  });

  client.rpc("confirm_waitlist", { p_token: token }).then(({ data, error }) => {
    if (error) {
      console.warn("[confirm] error:", error);
      show("error", "SOMETHING'S OFF", "We couldn't confirm your spot.",
        "Please try the link again in a minute. If it keeps failing, sign up once more and we'll send a fresh link.");
      return;
    }

    if (data === "ok") {
      show("ok", "YOU'RE IN", "Your spot is confirmed.",
        "Congratulations — you're officially on the Outly waitlist. Create an account to get your personal invite link and collect points for every friend who joins.");
    } else if (data === "already") {
      show("ok", "ALREADY CONFIRMED", "You're already on the list.",
        "This link was used before, so there's nothing left to do. See you at launch.");
    } else {
      show("error", "LINK PROBLEM", "This link isn't valid.",
        "It may have been mistyped or already replaced by a newer one. Sign up again and we'll send you a fresh link.");
    }
  });
})();
