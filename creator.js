/* =====================================================================
   Outly — prijava creatorja
   ---------------------------------------------------------------------
   Podatki gredo prek funkcije submit_creator_application() v Supabase.
   Ta shrani prijavo, pošlje obvestilo ekipi in potrdilo prijavitelju.
   Nastavitve baze so v ./supabase-config.js, shema v
   ./supabase-schema-6-creators.sql.
   ===================================================================== */

(() => {
  "use strict";

  const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

  let currentStep = 1;
  let sending = false;
  let client = null;

  /* ---------- pomožno ---------- */
  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function fields() {
    return {
      p_business_name:    val("businessName"),
      p_business_type:    val("businessType"),
      p_business_address: val("businessAddress"),
      p_city:             val("city"),
      p_licence_id:       val("licenceId"),
      p_contact_name:     val("contactName"),
      p_contact_role:     val("contactRole"),
      p_email:            val("contactEmail"),
      p_phone:            val("contactPhone")
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
      if (!f.p_business_name) {
        msg("Please enter your business name.", "error");
        focusOn("businessName");
        return false;
      }
    }

    if (step === 2) {
      if (!f.p_contact_name) {
        msg("Please enter the contact person's full name.", "error");
        focusOn("contactName");
        return false;
      }
      if (!EMAIL_RE.test(f.p_email)) {
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
      ["Business",   f.p_business_name],
      ["Type",       f.p_business_type],
      ["Address",    f.p_business_address],
      ["City",       f.p_city],
      ["Licence ID", f.p_licence_id],
      ["Contact",    f.p_contact_name],
      ["Role",       f.p_contact_role],
      ["Email",      f.p_email],
      ["Phone",      f.p_phone]
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
    if (!f0.p_business_name) {
      currentStep = 1; showStep(1); validateStep(1); return;
    }
    if (!f0.p_contact_name || !EMAIL_RE.test(f0.p_email)) {
      currentStep = 2; showStep(2); validateStep(2); return;
    }

    const btn = document.getElementById("creatorSubmit");

    if (!client) {
      msg("We can't reach our servers right now. Please try again in a minute.", "error");
      return;
    }

    sending = true;
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    msg("");

    const { data: status, error } = await client.rpc("submit_creator_application", fields());

    sending = false;
    if (btn) { btn.disabled = false; btn.textContent = "Submit application"; }

    if (error) {
      console.warn("[creator] submit error:", error);
      msg("Something went wrong. Please try again in a moment.", "error");
      return;
    }

    if (status === "ok") {
      showDone();
    } else if (status === "duplicate") {
      msg("We already have an application from this address. We'll be in touch.", "ok");
    } else if (status === "invalid") {
      msg("Please check your business name, contact name and email address.", "error");
    } else if (status === "busy") {
      msg("We're getting a lot of applications right now. Please try again in a few minutes.", "error");
    } else {
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
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
    } else {
      console.info("[creator] Supabase ni nastavljen — glej supabase-config.js");
    }
    showStep(currentStep);
  });
})();
