/* =====================================================================
   Outly — waitlist: shranjevanje prijav + realtime seznam
   ---------------------------------------------------------------------
   Nastavitve so v `supabase-config.js`, shema baze v `supabase-schema.sql`.
   Če Supabase ni nastavljen, forma pade nazaj na prvotni demo način in
   seznam ostane skrit — stran torej deluje tudi brez baze.
   ===================================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------------
     Konstante
  ---------------------------------------------------------------- */
  const FETCH_LIMIT   = 40;      // velikost ene strani; ob scrollu do dna nalozimo naslednjo (do konca)
  const MOBILE_MQ     = window.matchMedia("(max-width: 600px)");
  const DESKTOP_MQ    = window.matchMedia("(min-width: 981px)");
  const POLL_MS       = 15000;   // fallback osveževanje, če realtime ne steče
  const CLOCK_MS      = 60000;   // osveževanje relativnih časov ("2m ago")

  // Enaka validacija kot CHECK constraint v bazi.
  const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

  /* ---------------------------------------------------------------
     Povabilo (?ref=KODA). Kodo si zapomnimo, da velja tudi, ce obiskovalec
     najprej brska in se prijavi kasneje. Steje jo baza, in to samo, ko
     povabljeni potrdi e-naslov (supabase-schema-9-referral.sql).
  ---------------------------------------------------------------- */
  const REF_KEY = "outly_ref";
  const REF_RE  = /^[A-Z0-9]{4,12}$/;
  function shraniRefIzNaslova() {
    try {
      const r = (new URLSearchParams(location.search).get("ref") || "").trim().toUpperCase();
      if (REF_RE.test(r)) localStorage.setItem(REF_KEY, r);
    } catch (_) { /* zasebni nacin ipd. */ }
  }
  function refKoda() {
    try {
      const r = (localStorage.getItem(REF_KEY) || "").toUpperCase();
      return REF_RE.test(r) ? r : null;
    } catch (_) { return null; }
  }
  shraniRefIzNaslova();
  const REF_IN_URL = /[?&]ref=/i.test(location.search);

  // Pogoste tipkarske napake v domeni. Baza jih ne more ujeti (gmial.com
  // je čisto veljavna oblika), zato uporabnika opozorimo takoj.
  const TYPOS = {
    "gmial.com": "gmail.com",   "gmai.com": "gmail.com",   "gmail.co": "gmail.com",
    "gmail.con": "gmail.com",   "gmaill.com": "gmail.com", "gnail.com": "gmail.com",
    "gmail.cm": "gmail.com",    "gamil.com": "gmail.com",  "hotmial.com": "hotmail.com",
    "hotmail.co": "hotmail.com","outlok.com": "outlook.com","outloook.com": "outlook.com",
    "yahooo.com": "yahoo.com",  "yaho.com": "yahoo.com",   "iclod.com": "icloud.com",
    "icloud.co": "icloud.com",  "sioll.net": "siol.net",   "gmx.co": "gmx.com"
  };

  /* ---------------------------------------------------------------
     DOM
  ---------------------------------------------------------------- */
  const form     = document.getElementById("waitlistForm");
  const msg      = document.getElementById("formMsg");
  const panel    = document.getElementById("waitlistPeople");
  const listEl   = document.getElementById("waitlistList");
  const countEl  = document.getElementById("waitlistCount");
  const labelEl  = document.getElementById("waitlistLabel");
  const moreEl   = document.getElementById("waitlistMore");
  const liveEl   = document.getElementById("waitlistLive");
  const formBox  = document.querySelector(".waitlist__form");
  const copyBox  = document.querySelector(".waitlist__copy");
  const gridBox  = document.querySelector(".waitlist");

  if (!form) return;

  const submitBtn   = form.querySelector('button[type="submit"]');
  const emailInput  = form.elements.email;
  const submitLabel = submitBtn ? submitBtn.textContent : "Join the waitlist";

  /* ---------------------------------------------------------------
     Stanje
  ---------------------------------------------------------------- */
  let client   = null;
  let rows     = [];     // nalozene prijave (od najnovejse), raste ob scrollu
  let total    = 0;      // skupno število prijav
  let pollId   = null;
  let sending  = false;
  let loadingMore = false;
  let allLoaded   = false;
  let lastEmail = "";   // naslov iz zadnje uspesne oddaje (za "poslji znova")

  /* ---------------------------------------------------------------
     Pomožne funkcije
  ---------------------------------------------------------------- */
  // Seznam se scrolla do konca (vse prijave), zato omejitve prikaza ni vec;
  // funkcija ostaja zaradi klicev spodaj.
  function visibleLimit() {
    return Infinity;
  }

  /* Na desktopu panel s seznamom spodaj poravnamo s formo.
     Sam CSS tega ne zmore: mreža brez določene višine se vedno razteza po
     vsebini seznama (tudi `1fr` se v takem primeru obnaša kot max-content).

     Postavitev na desktopu:
        vrstica 1 = besedilo            (višina copyBox)
        razmik    = row-gap mreže
        vrstica 2 = margin panela + panel
        forma     = sega čez obe vrstici

     Da se spodnja robova ujameta, mora veljati:
        višina forme = copy + gap + margin + višina panela
     Iz tega neposredno izračunamo višino panela — brez merjenja panela
     samega, zato ni povratne zanke in ni potrebe po večkratnem popravljanju. */
  function alignPanelToForm() {
    if (!panel || !formBox || !copyBox || !gridBox || panel.hidden) return;

    if (!DESKTOP_MQ.matches) {
      panel.style.height = "";                     // na telefonu višino ureja CSS
      return;
    }

    const gs     = getComputedStyle(gridBox);
    const gap    = parseFloat(gs.rowGap) || 0;
    const mt     = parseFloat(getComputedStyle(panel).marginTop) || 0;
    const formH  = formBox.getBoundingClientRect().height;
    const copyH  = copyBox.getBoundingClientRect().height;

    const next = Math.max(150, Math.round(formH - copyH - gap - mt));
    if (Math.abs(parseFloat(panel.style.height) - next) < 1) return;
    panel.style.height = next + "px";
  }

  const onLayoutChange = () => alignPanelToForm();

  function setMsg(text, kind) {
    if (!msg) return;
    msg.textContent = text;
    msg.classList.remove("is-error", "is-ok");
    if (kind) msg.classList.add(kind === "error" ? "is-error" : "is-ok");
  }

  function isConfigured() {
    const cfg = window.OUTLY_SUPABASE;
    return !!(cfg && cfg.url && cfg.anonKey && window.supabase);
  }

  function relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    if (!isFinite(min) || min < 1) return "just now";
    if (min < 60)  return min + "m ago";
    const h = Math.floor(min / 60);
    if (h < 24)    return h + "h ago";
    const d = Math.floor(h / 24);
    if (d < 7)     return d + "d ago";
    return Math.floor(d / 7) + "w ago";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function setLive(on) {
    if (!liveEl) return;
    liveEl.classList.toggle("is-live", !!on);
    liveEl.querySelector("span").textContent = on ? "live" : "auto-refresh";
  }

  /* ---------------------------------------------------------------
     Izris seznama
  ---------------------------------------------------------------- */
  function render(newIds) {
    if (!listEl) return;

    if (countEl) countEl.textContent = total.toLocaleString("en-US");
    if (labelEl) labelEl.textContent = total === 1 ? "person is already in" : "people are already in";

    const keepScroll = listEl.scrollTop;

    listEl.innerHTML = "";
    rows.slice(0, visibleLimit()).forEach((row) => {
      const li = document.createElement("li");
      li.className = "person";
      if (newIds && newIds.has(row.id)) li.classList.add("is-new");

      // Registrirani se kazejo z delno zakritim imenom + "created a profile",
      // ostali z maskiranim mailom.
      const label   = row.display_name || row.masked_email || "?";
      const initial = label.charAt(0).toUpperCase();
      const text    = row.display_name
        ? `<span class="person__mail person__mail--name"><b>${escapeHtml(label)}</b> created a profile</span>`
        : `<span class="person__mail">${escapeHtml(label)}</span>`;
      li.innerHTML = `
        <span class="person__avatar${row.display_name ? " person__avatar--user" : ""}" aria-hidden="true">${escapeHtml(initial)}</span>
        ${text}
        ${row.is_creator ? '<span class="person__tag">creator</span>' : ""}
        <time class="person__time" datetime="${escapeHtml(row.created_at)}">${relTime(row.created_at)}</time>
      `;
      listEl.appendChild(li);
    });

    // Ob novi prijavi pokažemo vrh seznama, sicer ostanemo, kjer je bil uporabnik.
    listEl.scrollTop = (newIds && newIds.size) ? 0 : keepScroll;

    const rest = total - rows.length;
    allLoaded = rest <= 0;
    if (moreEl) {
      if (rest > 0) {
        moreEl.textContent = "+ " + rest.toLocaleString("en-US") + (rest === 1 ? " other" : " others") + " — scroll for more";
        moreEl.hidden = false;
      } else {
        moreEl.hidden = true;
      }
    }

    if (panel) panel.hidden = false;
    alignPanelToForm();
  }

  function refreshClock() {
    if (!listEl) return;
    listEl.querySelectorAll("time.person__time").forEach((t) => {
      t.textContent = relTime(t.getAttribute("datetime"));
    });
  }

  /* ---------------------------------------------------------------
     Branje iz baze
  ---------------------------------------------------------------- */
  const COLS = "id, masked_email, display_name, is_creator, created_at";

  async function loadList(newIds) {
    if (!client) return;

    // Osvezimo toliko vrstic, kolikor jih je uporabnik ze videl (vsaj eno stran),
    // da se ob osvezitvi seznam ne skrci nazaj na vrh.
    const want = Math.max(FETCH_LIMIT, rows.length);

    const [listRes, countRes] = await Promise.all([
      client
        .from("waitlist_public")
        .select(COLS)
        .order("created_at", { ascending: false })
        .limit(want),
      client
        .from("waitlist_public")
        .select("id", { count: "exact", head: true })
    ]);

    if (listRes.error) {
      console.warn("[waitlist] list error:", listRes.error.message);
      return;
    }

    rows  = listRes.data || [];
    total = (countRes && typeof countRes.count === "number") ? countRes.count : rows.length;
    render(newIds);
  }

  // Naslednja stran (starejse prijave) — kurzor po created_at, da realtime vstavki
  // na vrhu ne premaknejo strani.
  async function loadMore() {
    if (!client || loadingMore || allLoaded || !rows.length) return;
    loadingMore = true;

    const last = rows[rows.length - 1].created_at;
    const { data, error } = await client
      .from("waitlist_public")
      .select(COLS)
      .lt("created_at", last)
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);

    loadingMore = false;
    if (error) { console.warn("[waitlist] more error:", error.message); return; }

    if (!data || !data.length) { allLoaded = true; render(); return; }
    const seen = new Set(rows.map((r) => r.id));
    data.forEach((r) => { if (!seen.has(r.id)) rows.push(r); });
    render();
  }

  if (listEl) {
    listEl.addEventListener("scroll", () => {
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 80) loadMore();
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
     Realtime (z fallbackom na polling)
  ---------------------------------------------------------------- */
  function startPolling() {
    if (pollId) return;
    setLive(false);
    pollId = setInterval(() => {
      if (document.hidden) return;      // ne trošimo zahtevkov v ozadju
      loadList();
    }, POLL_MS);
  }

  function stopPolling() {
    if (!pollId) return;
    clearInterval(pollId);
    pollId = null;
  }

  function subscribe() {
    client
      .channel("waitlist-public")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "waitlist_public" },
        (payload) => {
          const row = payload.new;
          if (!row || rows.some((r) => r.id === row.id)) return;
          rows.unshift(row);
          rows = rows.slice(0, FETCH_LIMIT);
          total += 1;
          render(new Set([row.id]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "waitlist_public" },
        (payload) => {
          // Uporabnik si je izbral ime: vrstica dobi nov cas in skoci na vrh,
          // zato seznam raje na novo nalozimo.
          const row = payload.new;
          if (!row) return;
          rows = rows.filter((r) => r.id !== row.id);
          loadList(new Set([row.id]));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          stopPolling();
          setLive(true);
          loadList();                   // sinhroniziraj, kar smo zamudili
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startPolling();
        }
      });
  }

  /* ---------------------------------------------------------------
     Oddaja forme
  ---------------------------------------------------------------- */
  /* Rezervni način: neposreden vpis v tabelo, kot je delovalo pred
     uvedbo potrditvenih mailov. Uporabi se samo, če funkcije v bazi ni. */
  async function joinBrezPotrditve(email, isUser, isCreator) {
    const { error } = await client.from("waitlist_signups").insert({
      email,
      is_user: isUser || !isCreator,
      is_creator: isCreator
    });

    if (error && error.code === "23505") {
      setMsg("This email is already on the waitlist — you're all set.", "ok");
    } else if (error) {
      console.warn("[waitlist] insert error:", error);
      setMsg("Something went wrong. Please try again in a moment.", "error");
      return;
    } else {
      const type = isCreator && isUser ? "user + creator" : isCreator ? "creator" : "user";
      setMsg(`Thanks! You're on the waitlist as a ${type}. We'll email you at ${email}.`, "ok");
    }

    form.reset();
    loadList();
  }

  /* ---------------------------------------------------------------
     "Check your inbox" — korak po uspesni oddaji
     ---------------------------------------------------------------
     Brez klika v potrditvenem mailu prijava ne steje in se na seznamu
     ne pokaze. Ljudje na to pozabijo, zato obrazec po oddaji zamenjamo
     s to plosco in ponudimo gumb naravnost v njihov predal.
  ---------------------------------------------------------------- */
  const checkBox    = document.getElementById("checkMail");
  const checkAddr   = document.getElementById("checkMailAddr");
  const checkOpen   = document.getElementById("checkMailOpen");
  const checkBack   = document.getElementById("checkMailBack");
  const checkResend = document.getElementById("checkMailResend");
  const checkNote   = document.getElementById("checkMailNote");
  const fieldEl     = form.querySelector(".field");
  const fineEl      = form.querySelector(".fineprint");
  const creatorEl   = form.querySelector(".creatorLine");
  const btnsEl      = form.querySelector(".waitlist__btns");

  // Znani spletni predali. Za neznano domeno gumba ne pokazemo —
  // ugibana povezava bi peljala v prazno.
  const INBOXES = {
    "gmail.com":       ["Gmail",        "https://mail.google.com/mail/u/0/#inbox"],
    "googlemail.com":  ["Gmail",        "https://mail.google.com/mail/u/0/#inbox"],
    "outlook.com":     ["Outlook",      "https://outlook.live.com/mail/0/"],
    "hotmail.com":     ["Outlook",      "https://outlook.live.com/mail/0/"],
    "live.com":        ["Outlook",      "https://outlook.live.com/mail/0/"],
    "msn.com":         ["Outlook",      "https://outlook.live.com/mail/0/"],
    "yahoo.com":       ["Yahoo Mail",   "https://mail.yahoo.com/"],
    "icloud.com":      ["iCloud Mail",  "https://www.icloud.com/mail"],
    "me.com":          ["iCloud Mail",  "https://www.icloud.com/mail"],
    "mac.com":         ["iCloud Mail",  "https://www.icloud.com/mail"],
    "proton.me":       ["Proton Mail",  "https://mail.proton.me/u/0/inbox"],
    "protonmail.com":  ["Proton Mail",  "https://mail.proton.me/u/0/inbox"],
    "pm.me":           ["Proton Mail",  "https://mail.proton.me/u/0/inbox"],
    "gmx.com":         ["GMX",          "https://www.gmx.com/"],
    "gmx.net":         ["GMX",          "https://www.gmx.net/"],
    "siol.net":        ["Siol webmail", "https://webmail.siol.net/"],
    "t-2.net":         ["T-2 webmail",  "https://webmail.t-2.net/"],
    "arnes.si":        ["Arnes webmail","https://webmail.arnes.si/"],
    "guest.arnes.si":  ["Arnes webmail","https://webmail.arnes.si/"],
    "student.arnes.si":["Arnes webmail","https://webmail.arnes.si/"]
  };

  function inboxFor(email) {
    return INBOXES[(email.split("@")[1] || "").toLowerCase()] || null;
  }

  function setNote(txt) {
    if (checkNote) checkNote.textContent = txt || "";
  }

  function showCheckMail(email) {
    // Ce je v obtoku se stara razlicica strani brez te plosce,
    // pademo nazaj na navadno sporocilo pod gumbom.
    if (!checkBox) {
      setMsg("Almost there — we sent a confirmation link to " + email +
             ". Tap it and your spot is locked in.", "ok");
      form.reset();
      return;
    }

    lastEmail = email;
    if (checkAddr) checkAddr.textContent = email;

    const inbox = inboxFor(email);
    if (checkOpen) {
      if (inbox) {
        checkOpen.href = inbox[1];
        checkOpen.textContent = "Open " + inbox[0];
        checkOpen.hidden = false;
      } else {
        checkOpen.hidden = true;      // neznana domena: brez gumba
      }
    }

    setMsg("");
    setNote("");
    [fieldEl, btnsEl || submitBtn, fineEl, creatorEl].forEach((el) => { if (el) el.hidden = true; });
    checkBox.hidden = false;
    alignPanelToForm();
  }

  function hideCheckMail() {
    if (!checkBox) return;
    checkBox.hidden = true;
    [fieldEl, btnsEl || submitBtn, fineEl, creatorEl].forEach((el) => { if (el) el.hidden = false; });
    form.reset();
    setMsg("");
    setNote("");
    if (emailInput) emailInput.focus();
    alignPanelToForm();
  }

  if (checkBack) checkBack.addEventListener("click", hideCheckMail);

  if (checkResend) {
    checkResend.addEventListener("click", async () => {
      if (!client || !lastEmail || sending) return;

      sending = true;
      checkResend.disabled = true;
      setNote("Sending…");

      const { data: st, error: err } = await client.rpc("join_waitlist", {
        p_email: lastEmail, p_is_user: true, p_is_creator: false, p_ref: refKoda()
      });

      sending = false;
      checkResend.disabled = false;

      if (err) {
        setNote("Couldn't send it just now — try again in a minute.");
        return;
      }
      if (st === "already_confirmed") {
        hideCheckMail();
        setMsg("You're already on the waitlist — see you at launch.", "ok");
        return;
      }
      // Baza istemu naslovu ne poslje novega maila pogosteje kot na 2 minuti.
      setNote("On its way — give it a minute, and check spam too.");
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return;

    const email     = (emailInput.value || "").trim().toLowerCase();
    // Creatorji imajo svoj postopek na Creator.html; ta forma je samo za uporabnike.
    const isUser    = true;
    const isCreator = false;

    if (!EMAIL_RE.test(email) || email.length > 254) {
      setMsg("Please enter a valid email address.", "error");
      emailInput.focus();
      return;
    }

    // Demo način — baza ni nastavljena.
    if (!client) {
      const type = isCreator && isUser ? "user + creator" : isCreator ? "creator" : "user";
      setMsg(`Thanks! You're on the waitlist as a ${type}. We'll email you at ${email}.`, "ok");
      form.reset();
      return;
    }

    const domain = email.split("@")[1];
    if (TYPOS[domain]) {
      setMsg(`Did you mean @${TYPOS[domain]}? Fix it or submit again to keep it.`, "error");
      delete TYPOS[domain];          // ob drugi oddaji ne vztrajamo
      emailInput.focus();
      return;
    }

    sending = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
    }
    setMsg("");

    const { data: status, error } = await client.rpc("join_waitlist", {
      p_email: email,
      p_is_user: isUser || !isCreator,   // vsaj ena vloga mora biti označena
      p_is_creator: isCreator,
      p_ref: refKoda()                   // koda povabitelja, ce je prisel prek povezave
    });

    sending = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }

    if (error) {
      // Če migracija `supabase-schema-2-confirm.sql` še ni pognana, funkcije
      // v bazi ni. V tem primeru pademo nazaj na prvotni način (vpis brez
      // potrditvenega maila), da se prijave nikoli ne zlomijo — ne glede na
      // to, ali je bila prej objavljena stran ali baza.
      const funkcijeNi =
        error.code === "PGRST202" ||
        /could not find the function/i.test(error.message || "");

      if (funkcijeNi) {
        console.info("[waitlist] join_waitlist še ne obstaja — vpis brez potrditve.");
        await joinBrezPotrditve(email, isUser, isCreator);
        return;
      }

      console.warn("[waitlist] join error:", error);
      setMsg("Something went wrong. Please try again in a moment.", "error");
      return;
    }

    // Prijava se šteje šele, ko uporabnik klikne povezavo v mailu.
    if (status === "sent" || status === "resent") {
      showCheckMail(email);
    } else if (status === "already_confirmed") {
      setMsg("You're already on the waitlist — see you at launch.", "ok");
      form.reset();
    } else if (status === "invalid") {
      setMsg("Please enter a valid email address.", "error");
      return;
    } else if (status === "disposable") {
      setMsg("Please use a permanent email address — we need to reach you at launch.", "error");
      return;
    } else if (status === "busy") {
      setMsg("We're getting a lot of signups right now. Please try again in a few minutes.", "error");
      return;
    } else {
      setMsg("Something went wrong. Please try again in a moment.", "error");
      return;
    }

    // Na mobilnem zapri tipkovnico, da se vidi sporočilo.
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }

  form.addEventListener("submit", onSubmit);

  /* ---------------------------------------------------------------
     Povabilo: kdo te je povabil (delno zakrito ime iz baze) + skok na formo.
     Pasica se pokaze, dokler koda velja; ob prihodu prek linka se stran
     pomakne na waitlisto in postavi kurzor v polje.
  ---------------------------------------------------------------- */
  async function pokaziPovabitelja() {
    const box = document.getElementById("invitedBy");
    const code = refKoda();
    if (!box || !code || !client) return;

    const { data: name, error } = await client.rpc("referrer_public", { p_ref: code });
    if (error || !name) {
      if (error) console.info("[waitlist] referrer_public:", error.message);
      return;
    }

    document.getElementById("invitedByName").textContent = name;
    document.getElementById("invitedByAvatar").textContent = name.charAt(0).toUpperCase();
    box.hidden = false;
    alignPanelToForm();

    if (REF_IN_URL) {
      const target = document.getElementById("waitlist");
      setTimeout(() => {
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => { if (emailInput && !MOBILE_MQ.matches) emailInput.focus({ preventScroll: true }); }, 700);
      }, 250);
    }
  }

  // "Invite friends": link imajo samo registrirani — prijavljenemu odpre profil
  // z linkom, ostalim prijavo/registracijo (auth.js).
  const inviteBtn = document.getElementById("inviteFriendsBtn");
  if (inviteBtn) {
    inviteBtn.addEventListener("click", () => {
      if (window.OutlyAuth) window.OutlyAuth.open("invite");
      else setMsg("Create an account to get your invite link.", "error");
    });
  }

  // Sprotna validacija: skrij napako, ko uporabnik popravlja vnos.
  emailInput?.addEventListener("input", () => {
    if (msg && msg.classList.contains("is-error")) setMsg("");
  });

  /* ---------------------------------------------------------------
     Zagon
  ---------------------------------------------------------------- */
  if (isConfigured()) {
    const cfg = window.OUTLY_SUPABASE;
    // Odjemalca ustvari auth.js (deljena seja); brez njega ga naredimo tukaj.
    client = window.OUTLY_CLIENT || window.supabase.createClient(cfg.url, cfg.anonKey, {
      realtime: { params: { eventsPerSecond: 5 } }
    });

    loadList().then(subscribe);
    pokaziPovabitelja();
    setInterval(refreshClock, CLOCK_MS);

    // Ob rotaciji / spremembi širine prilagodi dolžino seznama.
    const onMq = () => render();
    if (MOBILE_MQ.addEventListener) MOBILE_MQ.addEventListener("change", onMq);
    else MOBILE_MQ.addListener(onMq);

    // Poravnava panela s formo: ob spremembi širine okna in kadar forma
    // spremeni višino (npr. ko se pod gumbom izpiše sporočilo).
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("orientationchange", onLayoutChange);
    if (DESKTOP_MQ.addEventListener) DESKTOP_MQ.addEventListener("change", onLayoutChange);
    else DESKTOP_MQ.addListener(onLayoutChange);
    if (window.ResizeObserver && formBox) {
      new ResizeObserver(onLayoutChange).observe(formBox);
    }

    // Po vrnitvi na zavihek osveži takoj (realtime je med sleepom lahko padel).
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadList();
    });
  } else if (panel) {
    panel.hidden = true;
    if (!window.OUTLY_SUPABASE || !window.OUTLY_SUPABASE.url) {
      console.info("[waitlist] Supabase ni nastavljen — forma teče v demo načinu. Glej supabase-config.js");
    }
  }
})();
