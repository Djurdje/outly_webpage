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
  const FETCH_LIMIT   = 12;      // koliko prijav preberemo iz baze
  const MOBILE_MQ     = window.matchMedia("(max-width: 600px)");
  const POLL_MS       = 15000;   // fallback osveževanje, če realtime ne steče
  const CLOCK_MS      = 60000;   // osveževanje relativnih časov ("2m ago")

  // Enaka validacija kot CHECK constraint v bazi.
  const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

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

  if (!form) return;

  const submitBtn   = form.querySelector('button[type="submit"]');
  const emailInput  = form.elements.email;
  const submitLabel = submitBtn ? submitBtn.textContent : "Join the waitlist";

  /* ---------------------------------------------------------------
     Stanje
  ---------------------------------------------------------------- */
  let client   = null;
  let rows     = [];     // zadnjih FETCH_LIMIT maskiranih prijav
  let total    = 0;      // skupno število prijav
  let pollId   = null;
  let sending  = false;

  /* ---------------------------------------------------------------
     Pomožne funkcije
  ---------------------------------------------------------------- */
  // Na telefonu prikažemo krajši seznam, da ne nastane neskončen scroll.
  function visibleLimit() {
    return MOBILE_MQ.matches ? 8 : FETCH_LIMIT;
  }

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

    listEl.innerHTML = "";
    rows.slice(0, visibleLimit()).forEach((row) => {
      const li = document.createElement("li");
      li.className = "person";
      if (newIds && newIds.has(row.id)) li.classList.add("is-new");

      const initial = (row.masked_email || "?").charAt(0).toUpperCase();
      li.innerHTML = `
        <span class="person__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
        <span class="person__mail">${escapeHtml(row.masked_email)}</span>
        ${row.is_creator ? '<span class="person__tag">creator</span>' : ""}
        <time class="person__time" datetime="${escapeHtml(row.created_at)}">${relTime(row.created_at)}</time>
      `;
      listEl.appendChild(li);
    });

    const rest = total - Math.min(rows.length, visibleLimit());
    if (moreEl) {
      if (rest > 0) {
        moreEl.textContent = "+ " + rest.toLocaleString("en-US") + (rest === 1 ? " other" : " others");
        moreEl.hidden = false;
      } else {
        moreEl.hidden = true;
      }
    }

    if (panel) panel.hidden = false;
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
  async function loadList(newIds) {
    if (!client) return;

    const [listRes, countRes] = await Promise.all([
      client
        .from("waitlist_public")
        .select("id, masked_email, is_creator, created_at")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
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
  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return;

    const email     = (emailInput.value || "").trim().toLowerCase();
    const isUser    = form.elements.type_user.checked;
    const isCreator = form.elements.type_creator.checked;

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
      form.elements.type_user.checked = true;
      return;
    }

    sending = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Joining…";
    }
    setMsg("");

    const { error } = await client.from("waitlist_signups").insert({
      email,
      is_user: isUser || !isCreator,   // vsaj ena vloga mora biti označena
      is_creator: isCreator
    });

    sending = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }

    if (error) {
      if (error.code === "23505") {
        setMsg("This email is already on the waitlist — you're all set.", "ok");
        form.reset();
        form.elements.type_user.checked = true;
      } else if (error.code === "23514") {
        setMsg("Please enter a valid email address.", "error");
      } else {
        console.warn("[waitlist] insert error:", error);
        setMsg("Something went wrong. Please try again in a moment.", "error");
      }
      return;
    }

    const type = isCreator && isUser ? "user + creator" : isCreator ? "creator" : "user";
    setMsg(`Thanks! You're on the waitlist as a ${type}. We'll email you at ${email}.`, "ok");
    form.reset();
    form.elements.type_user.checked = true;

    // Na mobilnem zapri tipkovnico in pokaži potrditev/seznam.
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }

    loadList();   // takojšen odziv, ne čakamo na realtime event
  }

  form.addEventListener("submit", onSubmit);

  // Sprotna validacija: skrij napako, ko uporabnik popravlja vnos.
  emailInput?.addEventListener("input", () => {
    if (msg && msg.classList.contains("is-error")) setMsg("");
  });

  /* ---------------------------------------------------------------
     Zagon
  ---------------------------------------------------------------- */
  if (isConfigured()) {
    const cfg = window.OUTLY_SUPABASE;
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      realtime: { params: { eventsPerSecond: 5 } }
    });

    loadList().then(subscribe);
    setInterval(refreshClock, CLOCK_MS);

    // Ob rotaciji / spremembi širine prilagodi dolžino seznama.
    const onMq = () => render();
    if (MOBILE_MQ.addEventListener) MOBILE_MQ.addEventListener("change", onMq);
    else MOBILE_MQ.addListener(onMq);

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
