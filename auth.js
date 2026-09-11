/* =====================================================================
   Outly — racun na spletni strani: prijava, registracija, profil
   ---------------------------------------------------------------------
   Supabase Auth (e-mail + geslo). Plosca se odpre cez stran iz desnega
   zgornjega kota (ikona profila v glavi), ozadje se zamegli.
   Baza: supabase-schema-10-accounts.sql (sync_my_account, my_profile,
   set_username, delete_my_account).

   Odjemalec Supabase se ustvari TUKAJ in je na voljo kot
   window.OUTLY_CLIENT — waitlist.js, confirm.js in creator.js ga
   uporabijo, da ni vec odjemalcev z isto sejo.

   Javni vmesnik: window.OutlyAuth = { open(view), close(), user(), profile() }
   ===================================================================== */

(() => {
  "use strict";

  const cfg = window.OUTLY_SUPABASE;
  if (!(cfg && cfg.url && cfg.anonKey && window.supabase)) return;

  const client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    realtime: { params: { eventsPerSecond: 5 } },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.OUTLY_CLIENT = client;

  const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
  const USER_RE  = /^[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,18}[A-Za-z0-9_])?$/;
  const REF_KEY  = "outly_ref";
  const HOME     = new URL("./", location.href).href;   // https://outly.si/ ali podmapa
  const START_HASH = location.hash;                     // #access_token=… iz potrditvenega maila

  let user    = null;
  let profile = null;
  let busy    = false;

  /* ---------------------------------------------------------------
     Markup plosce (enkrat, na vseh straneh)
  ---------------------------------------------------------------- */
  const ICON = {
    close:  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
    back:   '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm-7.5 8c.6-3.6 3.7-5.7 7.5-5.7s6.9 2.1 7.5 5.7"/></svg>',
    lock:   '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M7 10.5V8a5 5 0 0 1 10 0v2.5M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18v-6a1.5 1.5 0 0 1 1.5-1.5Z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
    trash:  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M5 7h14M9 7V5h6v2M8 7l.7 12h6.6L16 7M10 11v5M14 11v5"/></svg>'
  };

  const html = `
<div class="drawer" id="authDrawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" hidden>
  <div class="drawer__backdrop" data-close></div>
  <div class="drawer__panel">
    <button class="drawer__close" type="button" aria-label="Close" data-close>${ICON.close}</button>

    <!-- nalaganje -->
    <div class="drawer__view" data-view="loading"><div class="drawer__spin" aria-label="Loading"></div></div>

    <!-- prijava -->
    <div class="drawer__view" data-view="login">
      <p class="kicker">WELCOME BACK</p>
      <h2 id="drawerTitle">Log in to Outly.</h2>
      <p class="drawer__lead">Your invite link and points live here.</p>
      <form data-form="login" novalidate>
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@domain.com" required></label>
        <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" placeholder="Your password" required></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--ring btn--block" type="submit">Log in</button>
      </form>
      <p class="drawer__switch"><button class="linklike" type="button" data-go="forgot">Forgot your password?</button></p>
      <p class="drawer__switch">New here? <button class="linklike" type="button" data-go="register">Create an account</button></p>
    </div>

    <!-- registracija -->
    <div class="drawer__view" data-view="register">
      <p class="kicker">GET IN EARLY</p>
      <h2>Create your account.</h2>
      <p class="drawer__lead">Registered members get a personal invite link and collect a point for every friend who joins.</p>
      <form data-form="register" novalidate>
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@domain.com" required></label>
        <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--ring btn--block" type="submit">Create account</button>
      </form>
      <p class="drawer__fine">We store your email and a hashed password so you can log in and we can tell you when Outly launches. See our <a href="privacy.html">Privacy Policy</a>.</p>
      <p class="drawer__switch">Already have an account? <button class="linklike" type="button" data-go="login">Log in</button></p>
    </div>

    <!-- preveri posto -->
    <div class="drawer__view" data-view="checkmail">
      <p class="kicker">ONE LAST STEP</p>
      <h2>Check your inbox.</h2>
      <p class="drawer__lead">We sent a confirmation link to <strong data-mail></strong>. Tap it and you're in — your account isn't active until you do.</p>
      <p class="drawer__fine">Nothing there? Look in spam or Promotions. It comes from luka@outly.si.</p>
      <p class="drawer__switch"><button class="linklike" type="button" data-go="login">Back to log in</button></p>
    </div>

    <!-- pozabljeno geslo -->
    <div class="drawer__view" data-view="forgot">
      <button class="drawer__back" type="button" data-go="login">${ICON.back} Back</button>
      <p class="kicker">RESET</p>
      <h2>Forgot your password?</h2>
      <p class="drawer__lead">Enter your email and we'll send you a link to set a new one.</p>
      <form data-form="forgot" novalidate>
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@domain.com" required></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--block" type="submit">Send reset link</button>
      </form>
    </div>

    <!-- novo geslo (iz maila) -->
    <div class="drawer__view" data-view="reset">
      <p class="kicker">RESET</p>
      <h2>Choose a new password.</h2>
      <form data-form="reset" novalidate>
        <label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--ring btn--block" type="submit">Save password</button>
      </form>
    </div>

    <!-- izbira uporabniskega imena -->
    <div class="drawer__view" data-view="username">
      <p class="kicker">ALMOST DONE</p>
      <h2>Pick a username.</h2>
      <p class="drawer__lead">This is how you'll show up on the waitlist instead of your email.</p>
      <form data-form="username" novalidate>
        <label class="field"><span>Username</span><input type="text" name="username" autocomplete="nickname" placeholder="e.g. sefika" maxlength="20" required></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--ring btn--block" type="submit">Save</button>
      </form>
      <p class="drawer__fine">3–20 characters: letters, numbers, dots and underscores.</p>
    </div>

    <!-- profil -->
    <div class="drawer__view" data-view="profile">
      <div class="profile__head">
        <span class="profile__avatar" data-avatar aria-hidden="true">?</span>
        <p class="profile__name" data-name></p>
        <p class="profile__mail" data-mail></p>
      </div>

      <div class="points">
        <div class="points__row">
          <img class="points__coin" src="./assets/points-coin.png" alt="" width="48" height="48">
          <span class="points__num" data-points>0</span>
        </div>
        <p class="points__label" data-points-label></p>
        <button class="btn btn--primary btn--ring" type="button" data-toggle-invite>Invite friends</button>

        <div class="invitePanel" data-invite hidden>
          <div class="invite__row">
            <input class="invite__link" type="text" readonly value="" aria-label="Your invite link" data-invite-link>
            <button class="btn btn--primary" type="button" data-copy>Copy</button>
          </div>
          <div class="invite__share">
            <a class="btn" href="#" target="_blank" rel="noopener" data-share-wa>WhatsApp</a>
            <a class="btn" href="#" data-share-sms>Message</a>
            <button class="btn" type="button" hidden data-share-native>Share&hellip;</button>
          </div>
          <p class="invite__stats">One point for every friend who joins through your link and confirms their email.</p>
        </div>
      </div>

      <div class="menu">
        <button class="menu__item" type="button" data-go="personal">${ICON.person} Personal info</button>
        <button class="menu__item" type="button" data-go="password">${ICON.lock} Password and security</button>
        <button class="menu__item" type="button" data-action="logout">${ICON.logout} Log out</button>
        <button class="menu__item menu__item--danger" type="button" data-go="delete">${ICON.trash} Delete account</button>
      </div>
    </div>

    <!-- osebni podatki -->
    <div class="drawer__view" data-view="personal">
      <button class="drawer__back" type="button" data-go="profile">${ICON.back} Profile</button>
      <p class="kicker">PERSONAL INFO</p>
      <h2>Your details.</h2>
      <form data-form="personal" novalidate>
        <label class="field"><span>Username</span><input type="text" name="username" autocomplete="nickname" maxlength="20" required></label>
        <label class="field"><span>Email</span><input type="email" name="email" readonly></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--block" type="submit">Save changes</button>
      </form>
      <p class="drawer__fine">Want to change your email or have your data deleted? Write to <a href="mailto:luka@outly.si">luka@outly.si</a>.</p>
    </div>

    <!-- geslo -->
    <div class="drawer__view" data-view="password">
      <button class="drawer__back" type="button" data-go="profile">${ICON.back} Profile</button>
      <p class="kicker">SECURITY</p>
      <h2>Change your password.</h2>
      <form data-form="password" novalidate>
        <label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required></label>
        <label class="field"><span>Repeat new password</span><input type="password" name="password2" autocomplete="new-password" placeholder="Same again" required></label>
        <p class="formMsg" data-msg aria-live="polite"></p>
        <button class="btn btn--primary btn--block" type="submit">Update password</button>
      </form>
    </div>

    <!-- brisanje -->
    <div class="drawer__view" data-view="delete">
      <button class="drawer__back" type="button" data-go="profile">${ICON.back} Profile</button>
      <p class="kicker">DELETE ACCOUNT</p>
      <h2>Are you sure?</h2>
      <p class="drawer__lead">This removes your account, your spot on the waitlist and your points. Friends you invited keep theirs. There is no undo.</p>
      <p class="formMsg" data-msg aria-live="polite"></p>
      <button class="btn btn--danger btn--block" type="button" data-action="delete">Yes, delete my account</button>
      <p class="drawer__switch"><button class="linklike" type="button" data-go="profile">Keep my account</button></p>
    </div>
  </div>
</div>`;

  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const drawer = wrap.firstElementChild;
  document.body.appendChild(drawer);

  const panel   = drawer.querySelector(".drawer__panel");
  const views   = Array.from(drawer.querySelectorAll(".drawer__view"));
  const avatarBtn = document.getElementById("profileBtn");

  /* ---------------------------------------------------------------
     Pomozno
  ---------------------------------------------------------------- */
  const $ = (sel, root) => (root || drawer).querySelector(sel);

  function view(name) {
    views.forEach((v) => v.classList.toggle("is-active", v.dataset.view === name));
    const first = $('.drawer__view.is-active input:not([readonly])');
    if (first && !("ontouchstart" in window)) setTimeout(() => first.focus(), 60);
    panel.scrollTop = 0;
  }

  function setMsg(form, text, kind) {
    const el = form.querySelector("[data-msg]") || form.closest(".drawer__view").querySelector("[data-msg]");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("is-error", "is-ok");
    if (kind) el.classList.add(kind === "error" ? "is-error" : "is-ok");
  }

  function working(form, on, label) {
    const btn = form.querySelector('button[type="submit"], button[data-action]');
    if (!btn) return;
    if (on) { btn.dataset.label = btn.dataset.label || btn.textContent; btn.disabled = true; btn.textContent = label || "Working…"; }
    else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
  }

  function friendly(err) {
    const m = (err && err.message) || "";
    if (/invalid login credentials/i.test(m))   return "Wrong email or password.";
    if (/email not confirmed/i.test(m))         return "Confirm your email first — check your inbox.";
    if (/already registered|already exists/i.test(m)) return "This email already has an account. Log in instead.";
    if (/rate limit|too many/i.test(m))         return "Too many attempts. Give it a minute and try again.";
    if (/password/i.test(m) && /short|least/i.test(m)) return "Password must be at least 8 characters.";
    if (/network|fetch/i.test(m))               return "Can't reach our servers. Check your connection.";
    return "Something went wrong. Please try again in a moment.";
  }

  function refCode() {
    try {
      const r = (localStorage.getItem(REF_KEY) || "").toUpperCase();
      return /^[A-Z0-9]{4,12}$/.test(r) ? r : null;
    } catch (_) { return null; }
  }

  /* ---------------------------------------------------------------
     Odpiranje / zapiranje
  ---------------------------------------------------------------- */
  let lastFocus = null;

  function open(target) {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.body.classList.add("drawer-open");
    if (avatarBtn) avatarBtn.setAttribute("aria-expanded", "true");
    // dva okvirja, da animacija steče iz začetnega stanja
    requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add("is-open")));
    route(target);
  }

  function close() {
    if (drawer.hidden) return;
    drawer.classList.remove("is-open");
    drawer.classList.add("is-closing");
    document.body.classList.remove("drawer-open");
    if (avatarBtn) avatarBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      drawer.classList.remove("is-closing");
      drawer.hidden = true;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }, 320);
  }

  // Kam naj gre plosca glede na stanje racuna.
  async function route(target) {
    // Med ponastavitvijo gesla (povezava iz maila) je uporabnik ze prijavljen,
    // a mora najprej izbrati novo geslo — vse poti vodijo na "reset".
    if (pendingRecovery || target === "reset") { view("reset"); return; }
    if (!user) {
      // Neprijavljen: dovoljeni pogledi so login, register, forgot in reset;
      // vse drugo pelje na prijavo. ("forgot" je manjkal -> gumb "Forgot your
      // password?" ni naredil nic; popravljeno 11. 9. 2026.)
      view(["register", "forgot"].includes(target) ? target : "login");
      return;
    }
    view("loading");
    if (!profile) await loadProfile();
    if (!profile) { view("login"); return; }

    if (!profile.username) { view("username"); return; }

    renderProfile();
    if (target === "invite") toggleInvite(true);
    view(["personal", "password", "delete"].includes(target) ? target : "profile");
  }

  /* ---------------------------------------------------------------
     Profil
  ---------------------------------------------------------------- */
  async function loadProfile() {
    const { data, error } = await client.rpc("sync_my_account", { p_ref: refCode() });
    if (error) {
      console.warn("[auth] sync_my_account:", error.message);
      profile = null;
      return;
    }
    profile = data || null;
    paintAvatar();
  }

  function initial() {
    const src = (profile && profile.username) || (user && user.email) || "?";
    return src.charAt(0).toUpperCase();
  }

  function paintAvatar() {
    if (!avatarBtn) return;
    const icon = avatarBtn.querySelector(".avatarBtn__icon");
    const init = avatarBtn.querySelector(".avatarBtn__initial");
    const on = !!user;
    avatarBtn.classList.toggle("is-user", on);
    if (icon) icon.hidden = on;
    if (init) { init.hidden = !on; init.textContent = on ? initial() : ""; }
    avatarBtn.setAttribute("aria-label", on ? "Your profile" : "Log in or create an account");
  }

  function renderProfile() {
    const v = $('[data-view="profile"]');
    $("[data-avatar]", v).textContent = initial();
    $("[data-name]", v).textContent   = profile.username || "";
    $("[data-mail]", v).textContent   = profile.email || (user && user.email) || "";

    const pts = Number(profile.points || 0), pend = Number(profile.pending || 0);
    $("[data-points]", v).textContent = String(pts);
    $("[data-points-label]", v).textContent =
      pts === 0
        ? (pend > 0 ? pend + " invited — waiting for them to confirm." : "No points yet. Invite a friend to get your first.")
        : (pts === 1 ? "1 point" : pts + " points") + (pend > 0 ? " · " + pend + " still to confirm" : "");

    const link = HOME + "?ref=" + profile.ref_code;
    const text = "Where should we go tonight? Get on the Outly list with me: " + link;
    $("[data-invite-link]", v).value = link;
    $("[data-share-wa]", v).href  = "https://wa.me/?text=" + encodeURIComponent(text);
    $("[data-share-sms]", v).href = "sms:?&body=" + encodeURIComponent(text);
    const nat = $("[data-share-native]", v);
    nat.hidden = !navigator.share;
    nat.onclick = () => navigator.share({ title: "Outly", text, url: link }).catch(() => {});

    // osebni podatki
    const pf = $('[data-form="personal"]');
    pf.elements.username.value = profile.username || "";
    pf.elements.email.value    = profile.email || (user && user.email) || "";
  }

  function toggleInvite(force) {
    const box = $("[data-invite]");
    const on = typeof force === "boolean" ? force : box.hidden;
    box.hidden = !on;
    if (on) setTimeout(() => $("[data-invite-link]").select(), 50);
  }

  /* ---------------------------------------------------------------
     Dogodki v plosci
  ---------------------------------------------------------------- */
  drawer.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-close],[data-go],[data-action],[data-toggle-invite],[data-copy]");
    if (!t) return;

    if (t.hasAttribute("data-close")) { close(); return; }
    if (t.hasAttribute("data-go"))    { route(t.dataset.go); return; }
    if (t.hasAttribute("data-toggle-invite")) { toggleInvite(); return; }

    if (t.hasAttribute("data-copy")) {
      const input = $("[data-invite-link]");
      try { await navigator.clipboard.writeText(input.value); }
      catch (_) { input.select(); document.execCommand && document.execCommand("copy"); }
      t.textContent = "Copied";
      setTimeout(() => { t.textContent = "Copy"; }, 1800);
      return;
    }

    if (t.dataset.action === "logout") {
      await client.auth.signOut();
      close();
      return;
    }

    if (t.dataset.action === "delete") {
      if (busy) return;
      busy = true;
      const v = t.closest(".drawer__view");
      working(v, true, "Deleting…");
      const { error } = await client.rpc("delete_my_account");
      busy = false;
      if (error) {
        working(v, false);
        setMsg(v, friendly(error), "error");
        return;
      }
      await client.auth.signOut().catch(() => {});
      working(v, false);
      close();
    }
  });

  drawer.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!form.matches("form[data-form]")) return;
    e.preventDefault();
    if (busy) return;

    const kind = form.dataset.form;
    const f = form.elements;

    // validacija pred klicem
    if (f.email && !f.email.readOnly && !EMAIL_RE.test((f.email.value || "").trim())) {
      setMsg(form, "Please enter a valid email address.", "error"); f.email.focus(); return;
    }
    if (f.password && (f.password.value || "").length < 8 && kind !== "login") {
      setMsg(form, "Password must be at least 8 characters.", "error"); f.password.focus(); return;
    }
    if (kind === "login" && !(f.password.value || "")) {
      setMsg(form, "Please enter your password.", "error"); f.password.focus(); return;
    }
    if (kind === "password" && f.password.value !== f.password2.value) {
      setMsg(form, "The two passwords don't match.", "error"); f.password2.focus(); return;
    }
    if (f.username && !USER_RE.test((f.username.value || "").trim())) {
      setMsg(form, "3–20 characters: letters, numbers, dots and underscores.", "error"); f.username.focus(); return;
    }

    busy = true;
    working(form, true, kind === "login" ? "Logging in…" : kind === "forgot" ? "Sending…" : "Saving…");
    setMsg(form, "");

    try {
      if (kind === "login") {
        const { error } = await client.auth.signInWithPassword({
          email: f.email.value.trim().toLowerCase(), password: f.password.value
        });
        if (error) {
          if (/email not confirmed/i.test(error.message)) {
            $('[data-view="checkmail"] [data-mail]').textContent = f.email.value.trim().toLowerCase();
            view("checkmail");
          } else setMsg(form, friendly(error), "error");
          return;
        }
        form.reset();
        // onAuthStateChange(SIGNED_IN) nadaljuje: profil ali izbira usernama
      }

      else if (kind === "register") {
        const email = f.email.value.trim().toLowerCase();
        const { data, error } = await client.auth.signUp({
          email, password: f.password.value,
          options: { emailRedirectTo: HOME, data: { ref: refCode() } }
        });
        if (error) { setMsg(form, friendly(error), "error"); return; }
        // Supabase pri ze obstojecem naslovu ne vrne napake (da se ne razkrije,
        // kdo je registriran), ampak uporabnika brez identitet.
        if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMsg(form, "This email already has an account. Log in instead.", "error");
          return;
        }
        form.reset();
        if (data && data.session) return;      // potrjevanje izklopljeno → ze prijavljen
        $('[data-view="checkmail"] [data-mail]').textContent = email;
        view("checkmail");
      }

      else if (kind === "forgot") {
        const { error } = await client.auth.resetPasswordForEmail(
          f.email.value.trim().toLowerCase(), { redirectTo: HOME }
        );
        if (error) { setMsg(form, friendly(error), "error"); return; }
        setMsg(form, "If that address has an account, a reset link is on its way.", "ok");
      }

      else if (kind === "reset" || kind === "password") {
        const { error } = await client.auth.updateUser({ password: f.password.value });
        if (error) { setMsg(form, friendly(error), "error"); return; }
        form.reset();
        if (kind === "reset") {
          pendingRecovery = false;
          history.replaceState(null, "", location.pathname + location.search);
          await loadProfile();
          route("profile");
        }
        else setMsg(form, "Password updated.", "ok");
      }

      else if (kind === "username" || kind === "personal") {
        const name = f.username.value.trim();
        const { data: st, error } = await client.rpc("set_username", { p_username: name });
        if (error) { setMsg(form, friendly(error), "error"); return; }
        if (st === "taken")   { setMsg(form, "That username is taken — try another.", "error"); return; }
        if (st === "invalid") { setMsg(form, "3–20 characters: letters, numbers, dots and underscores.", "error"); return; }
        if (st !== "ok")      { setMsg(form, "Something went wrong. Please try again.", "error"); return; }
        profile = Object.assign({}, profile, { username: name });
        paintAvatar();
        renderProfile();
        if (kind === "username") { form.reset(); view("profile"); }
        else setMsg(form, "Saved.", "ok");
      }
    } catch (err) {
      setMsg(form, friendly(err), "error");
    } finally {
      busy = false;
      working(form, false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) close();
  });

  if (avatarBtn) avatarBtn.addEventListener("click", () => (drawer.hidden ? open("profile") : close()));

  /* ---------------------------------------------------------------
     Stanje seje
  ---------------------------------------------------------------- */
  // Povezava iz maila za ponastavitev gesla ima v hashu type=recovery. Supabase
  // najprej sprozi SIGNED_IN (ta bi odprl profil) in sele nato PASSWORD_RECOVERY,
  // zato to vemo ze vnaprej — sicer je nalaganje profila prepisalo pogled "reset"
  // (hrosc 11. 9. 2026: "select new password" te vrze v profil).
  let pendingRecovery = /type=recovery/.test(START_HASH);

  client.auth.onAuthStateChange(async (event, session) => {
    const before = user && user.id;
    user = session ? session.user : null;

    if (event === "PASSWORD_RECOVERY") {
      pendingRecovery = true;
      paintAvatar();
      history.replaceState(null, "", location.pathname + location.search);
      open("reset");
      return;
    }

    if (event === "SIGNED_OUT") {
      profile = null;
      paintAvatar();
      document.dispatchEvent(new CustomEvent("outly:auth", { detail: { user: null, profile: null } }));
      return;
    }

    if (user && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED")) {
      if (event === "USER_UPDATED" && profile) return;
      paintAvatar();
      if (pendingRecovery) { open("reset"); return; }   // najprej novo geslo
      await loadProfile();
      document.dispatchEvent(new CustomEvent("outly:auth", { detail: { user, profile } }));

      // Nov prihod (klik v potrditvenem mailu ali prijava): brez usernama → vprasaj zanj.
      const fresh = event === "SIGNED_IN" && before !== user.id;
      const fromMail = /access_token=|type=signup/.test(START_HASH);
      if (fresh || fromMail) {
        if (fromMail) history.replaceState(null, "", location.pathname + location.search);
        if (!drawer.hidden) route("profile");
        else if (profile && !profile.username) open("username");
        else if (fromMail) open("profile");
      }
    } else {
      paintAvatar();
    }
  });

  window.OutlyAuth = {
    open, close,
    user: () => user,
    profile: () => profile
  };
})();
