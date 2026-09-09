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

  const client = window.supabase.createClient(cfg.url, cfg.anonKey);

  // Povabilo: osebna povezava + stevilo potrjenih vabil (referral_status v bazi).
  // Ce funkcije se ni (shema 9 ni pognana), blok preprosto ostane skrit.
  async function pokaziVabilo() {
    const box = document.getElementById("inviteBox");
    if (!box) return;
    const { data: st, error: err } = await client.rpc("referral_status", { p_token: token });
    if (err || !st || !st.ref_code) { if (err) console.info("[confirm] referral_status:", err.message); return; }

    const link  = new URL("./?ref=" + st.ref_code, location.href).href; // dela na outly.si in na podmapi
    const input = document.getElementById("inviteLink");
    const copy  = document.getElementById("inviteCopy");
    const stats = document.getElementById("inviteStats");
    const wa    = document.getElementById("shareWa");
    const sms   = document.getElementById("shareSms");
    const nat   = document.getElementById("shareNative");
    const besedilo = "Where should we go tonight? Get on the Outly list with me: " + link;

    input.value = link;
    wa.href  = "https://wa.me/?text=" + encodeURIComponent(besedilo);
    sms.href = "sms:?&body=" + encodeURIComponent(besedilo);

    const n = Number(st.confirmed_invites || 0), p = Number(st.pending_invites || 0);
    stats.textContent = n === 0
      ? (p > 0 ? p + " invited, waiting for them to confirm." : "No invites yet — you could be first.")
      : n + (n === 1 ? " friend" : " friends") + " joined through your link" + (p > 0 ? " · " + p + " still to confirm" : "") + ".";

    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); }
      catch (_) { input.select(); document.execCommand && document.execCommand("copy"); }
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1800);
    });
    input.addEventListener("focus", () => input.select());

    if (navigator.share) {
      nat.hidden = false;
      nat.addEventListener("click", () => navigator.share({ title: "Outly", text: besedilo, url: link }).catch(() => {}));
    }
    box.hidden = false;
  }

  client.rpc("confirm_waitlist", { p_token: token }).then(({ data, error }) => {
    if (error) {
      console.warn("[confirm] error:", error);
      show("error", "SOMETHING'S OFF", "We couldn't confirm your spot.",
        "Please try the link again in a minute. If it keeps failing, sign up once more and we'll send a fresh link.");
      return;
    }

    if (data === "ok") {
      show("ok", "YOU'RE IN", "Your spot is confirmed.",
        "Congratulations — you're officially on the Outly waitlist. You'll be among the first in when we launch in your city. Nothing else lands in your inbox until then.");
      pokaziVabilo();
    } else if (data === "already") {
      show("ok", "ALREADY CONFIRMED", "You're already on the list.",
        "This link was used before, so there's nothing left to do. See you at launch.");
      pokaziVabilo();
    } else {
      show("error", "LINK PROBLEM", "This link isn't valid.",
        "It may have been mistyped or already replaced by a newer one. Sign up again and we'll send you a fresh link.");
    }
  });
})();
