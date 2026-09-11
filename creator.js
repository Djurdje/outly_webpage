/* =====================================================================
   Outly — prijava creatorja
   ---------------------------------------------------------------------
   Od 11. 9. 2026 gre prijava na backend aplikacije (POST /creator-applications),
   isto pot kot prijava iz aplikacije — tako se vidi v admin panelu (Prošnje)
   in jo tam odobriš. Backend pošlje obvestilo ekipi in potrdilo prijavitelju.
   Če je obiskovalec prijavljen (Supabase Auth), gre zraven njegov žeton in
   prošnja se veže na njegov račun. Stara pot prek Supabase
   (submit_creator_application) ostane v bazi, a se ne uporablja več.
   ===================================================================== */

(() => {
  "use strict";

  const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

  let currentStep = 1;
  let sending = false;
  let client = null;
  const API = "https://outly-backend-roy3.onrender.com";

  /* ---------- pomožno ---------- */
  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function fields() {
    return {
      businessName:    val("businessName"),
      businessType:    val("businessType"),
      businessAddress: val("businessAddress"),
      city:            val("city"),
      licenceId:       val("licenceId"),
      contactName:     val("contactName"),
      contactRole:     val("contactRole"),
      email:           val("contactEmail"),
      phone:           val("contactPhone")
    };
  }

  function msg(text, kind) {
    const el = document.querySelector('.step.active .step-msg');
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("is-error", "is-ok");
    if (kind) el.classList.add(kind === "error" ? "is-error" : "is-ok");
  }

  function focusOn(id) {
    const el = document.getElementById(id);
    if (el) el.focus();
  }

  function showStep(step) {
    document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
    const el = document.querySelector('.step[data-step="' + step + '"]');
    if (el) el.classList.add("active");
    if (step === 3) renderReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- preverjanje po korakih ---------- */
  function validateStep(step) {
    const f = fields();

    if (step === 1) {
      if (!f.businessName) {
        msg("Please enter your business name.", "error");
        focusOn("businessName");
        return false;
      }
    }

    if (step === 2) {
      if (!f.contactName) {
        msg("Please enter the contact person's full name.", "error");
        focusOn("contactName");
        return false;
      }
      if (!EMAIL_RE.test(f.email)) {
        msg("Please enter a valid email address — this is where we reply.", "error");
        focusOn("contactEmail");
        return false;
      }
    }

    msg("");
    return true;
  }

  /* ---------- pregled pred oddajo ---------- */
  function renderReview() {
    const list = document.getElementById("reviewList");
    if (!list) return;
    const f = fields();
    const rows = [
      ["Business",   f.businessName],
      ["Type",       f.businessType],
      ["Address",    f.businessAddress],
      ["City",       f.city],
      ["Licence ID", f.licenceId],
      ["Contact",    f.contactName],
      ["Role",       f.contactRole],
      ["Email",      f.email],
      ["Phone",      f.phone]
    ];

    list.innerHTML = "";
    rows.forEach(([label, value]) => {
      if (!value) return;
      const li = document.createElement("li");
      li.innerHTML =
        '<span class="review__k"></span><span class="review__v"></span>';
      li.querySelector(".review__k").textContent = label;
      li.querySelector(".review__v").textContent = value;
      list.appendChild(li);
    });
  }

  /* ---------- navigacija ---------- */
  window.nextStep = function () {
    if (!validateStep(currentStep)) return;
    if (currentStep < 3) {
      currentStep++;
      showStep(currentStep);
    }
  };

  window.prevStep = function () {
    if (currentStep > 1) {
      currentStep--;
      showStep(currentStep);
    }
  };

  /* ---------- oddaja ---------- */
  window.submitCreator = async function () {
    if (sending) return;

    // Če je kdo prišel do konca z manjkajočim podatkom, ga vrnemo na pravi korak.
    const f0 = fields();
    if (!f0.businessName) {
      currentStep = 1; showStep(1); validateStep(1); return;
    }
    if (!f0.contactName || !EMAIL_RE.test(f0.email)) {
      currentStep = 2; showStep(2); validateStep(2); return;
    }

    const btn = document.getElementById("creatorSubmit");

    sending = true;
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    msg("");

    // Prijavljen obiskovalec: žeton gre zraven, prošnja se veže na njegov račun.
    const headers = { "Content-Type": "application/json" };
    try {
      if (client) {
        const { data } = await client.auth.getSession();
        if (data && data.session && data.session.access_token) headers.Authorization = "Bearer " + data.session.access_token;
      }
    } catch (_) {}

    let resp = null, text = "";
    try {
      resp = await fetch(API + "/creator-applications", { method: "POST", headers, body: JSON.stringify(fields()) });
      text = await resp.text();
    } catch (err) {
      console.warn("[creator] submit error:", err);
    }

    sending = false;
    if (btn) { btn.disabled = false; btn.textContent = "Submit application"; }

    if (!resp) {
      msg("We can't reach our servers right now. Please try again in a minute.", "error");
      return;
    }
    if (resp.status === 201) {
      showDone();
    } else if (resp.status === 409) {
      msg("We already have an application from this address. We'll be in touch.", "ok");
    } else if (resp.status === 400) {
      msg(/phone/i.test(text) ? "Please check the phone number (digits only, optionally with +)." : "Please check your business name, contact name and email address.", "error");
    } else if (resp.status === 429) {
      msg("We're getting a lot of applications right now. Please try again in a few minutes.", "error");
    } else {
      console.warn("[creator] submit", resp.status, text);
      msg("Something went wrong. Please try again in a moment.", "error");
    }
  };

  function showDone() {
    const wrap = document.querySelector(".creator-wrapper");
    if (!wrap) return;
    const email = val("contactEmail");
    wrap.innerHTML =
      '<div class="step active">' +
      '  <h2>Application received.</h2>' +
      '  <p class="hint" id="doneMsg"></p>' +
      '  <p class="hint">A real person reads every application. If we need documents ' +
      '     — business licence, proof of ownership, tax number or bank details — we will ask ' +
      '     for them in our reply. Please don\'t send them before we ask.</p>' +
      '  <a class="btn primary" href="index.html">Back to Outly</a>' +
      '</div>';
    const d = document.getElementById("doneMsg");
    if (d) d.textContent = "We sent a confirmation to " + email + " and we'll get back to you there.";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- zagon ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const cfg = window.OUTLY_SUPABASE;
    if (cfg && cfg.url && cfg.anonKey && window.supabase) {
      client = window.OUTLY_CLIENT || window.supabase.createClient(cfg.url, cfg.anonKey);
    }
    showStep(currentStep);
  });
})();
