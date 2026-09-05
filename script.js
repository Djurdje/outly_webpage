document.getElementById("year").textContent = new Date().getFullYear();

/* ---------------------------
   HERO: jump to creator features
---------------------------- */
document.querySelectorAll('[data-features="creator"]').forEach(el => {
  el.addEventListener("click", () => {
    // switch features to creator mode
    setFeaturesMode("creator");
  });
});

/* ---------------------------
   HOW IT WORKS: 4-step flow
---------------------------- */
const stepBtns = Array.from(document.querySelectorAll(".step2"));
const pages = Array.from(document.querySelectorAll(".how2__page"));
const fill = document.querySelector(".how2__fill");

let state = {
  step: 1,
  genre: "Techno",
  age: 21,
  city: "Ljubljana",
  distance: 8,
  purchased: false
};

const genreHint = document.getElementById("genreHint");
const ageInput = document.getElementById("ageInput");
const cityInput = document.getElementById("cityInput");
const distanceInput = document.getElementById("distanceInput");
const distanceVal = document.getElementById("distanceVal");
const ticketName = document.getElementById("ticketName");
const ticketMeta = document.getElementById("ticketMeta");
const buyBtn = document.getElementById("buyBtn");
const buyHint = document.getElementById("buyHint");

const qrGenre = document.getElementById("qrGenre");
const qrCity = document.getElementById("qrCity");
const qrAge = document.getElementById("qrAge");

function setStep(n){
  state.step = n;

  // left step highlight
  stepBtns.forEach(b => {
    const active = b.dataset.step === String(n);
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });

  // show page
  pages.forEach(p => p.classList.toggle("is-active", p.dataset.page === String(n)));

  // progress 1..4
  fill.style.width = ((n / 4) * 100) + "%";

  // update dynamic text
  ticketName.textContent = `${state.genre} Night — City Center`;
  ticketMeta.textContent = `${state.city} • ${state.distance}km • ${state.age}+`;

  qrGenre.textContent = state.genre;
  qrCity.textContent = state.city;
  qrAge.textContent = String(state.age);
}

document.querySelectorAll("[data-next]").forEach(btn => {
  btn.addEventListener("click", () => {
    if(state.step < 4) setStep(state.step + 1);
  });
});
document.querySelectorAll("[data-prev]").forEach(btn => {
  btn.addEventListener("click", () => {
    if(state.step > 1) setStep(state.step - 1);
  });
});

stepBtns.forEach(btn => {
  btn.addEventListener("click", () => setStep(Number(btn.dataset.step)));
});

// Genres
const chips = Array.from(document.querySelectorAll(".chip"));
chips.forEach(ch => {
  ch.addEventListener("click", () => {
    chips.forEach(c => c.classList.remove("is-selected"));
    ch.classList.add("is-selected");
    state.genre = ch.dataset.genre;
    genreHint.innerHTML = `Selected: <strong>${state.genre}</strong>`;

    // keep ticket + qr fresh
    ticketName.textContent = `${state.genre} Night — City Center`;
    qrGenre.textContent = state.genre;
  });
});

// Age + location inputs
ageInput?.addEventListener("input", () => {
  const v = Number(ageInput.value || 0);
  state.age = Math.max(16, Math.min(99, v));
  ticketMeta.textContent = `${state.city} • ${state.distance}km • ${state.age}+`;
  qrAge.textContent = String(state.age);
});
cityInput?.addEventListener("input", () => {
  state.city = (cityInput.value || "").trim() || "Your city";
  ticketMeta.textContent = `${state.city} • ${state.distance}km • ${state.age}+`;
  qrCity.textContent = state.city;
});
distanceInput?.addEventListener("input", () => {
  state.distance = Number(distanceInput.value);
  distanceVal.textContent = String(state.distance);
  ticketMeta.textContent = `${state.city} • ${state.distance}km • ${state.age}+`;
});

// Buy ticket
buyBtn?.addEventListener("click", () => {
  state.purchased = true;
  buyHint.textContent = "";
  setStep(4);
});

/* ---------------------------
   FEATURES: User / Creator toggle
---------------------------- */
const featuresGrid = document.getElementById("featuresGrid");
const creatorCta = document.getElementById("creatorCta");
const toggleBtns = Array.from(document.querySelectorAll(".toggle__btn"));
const creatorCheck = document.getElementById("creatorCheck");

const FEATURES = {
  user: [
    { title: "Tonight feed", desc: "What’s relevant right now — no outdated posts." },
    { title: "Pick your vibe", desc: "Genre + price + distance — tailored suggestions." },
    { title: "In your area", desc: "Instant options around you (tourists & locals)." },
    { title: "Tickets & entry", desc: "Buy tickets fast and keep everything in one place." },
    { title: "Save & share", desc: "Favorites + share plans with friends." },
    { title: "Map view (soon)", desc: "See nightlife hotspots at a glance." }
  ],
  creator: [
    { title: "Event publishing", desc: "Post events fast and keep them updated." },
    { title: "Audience targeting", desc: "Reach people who actually like your vibe." },
    { title: "Ticketing (optional)", desc: "Sell tickets and manage capacity." },
    { title: "Analytics dashboard", desc: "Track performance, revenue, and trends." },
    { title: "Promotions (soon)", desc: "Boost visibility for key nights." },
    { title: "Creator profile", desc: "Build credibility with reviews and history." }
  ]
};

function renderFeatures(mode){
  featuresGrid.innerHTML = "";
  FEATURES[mode].forEach(item => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<h3>${item.title}</h3><p>${item.desc}</p>`;
    featuresGrid.appendChild(card);
  });

  creatorCta.style.display = (mode === "creator") ? "flex" : "none";
}

function setFeaturesMode(mode){
  toggleBtns.forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderFeatures(mode);
}

toggleBtns.forEach(b => {
  b.addEventListener("click", () => setFeaturesMode(b.dataset.mode));
});

// Creator CTA: pre-check creator on waitlist
document.getElementById("becomeCreatorBtn")?.addEventListener("click", () => {
  if(creatorCheck) creatorCheck.checked = true;
});
document.getElementById("footerCreatorLink")?.addEventListener("click", () => {
  if(creatorCheck) creatorCheck.checked = true;
});

// init
renderFeatures("user");

/* ---------------------------
   WAITLIST
   Prijava + realtime seznam sta v ./waitlist.js
   (nastavitve baze: ./supabase-config.js)
---------------------------- */
