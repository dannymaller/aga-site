/* ------------------------------------------------------------------
   CONFIG. Fill these two in and the page is live.
   APPS_SCRIPT_URL: the /exec URL from Deploy > New deployment > Web app
   MAPBOX_TOKEN:    public token, pk.***. Leave blank to type addresses
                    by hand (no lat/lng gets saved).
------------------------------------------------------------------ */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwRDdKsHdD1g4XrqmaPzukwjtZBu2hjsHrE81Tlv6NckXk4RnmRZRlage-s7aYiKRfy/exec";
const MAPBOX_TOKEN    = "";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- tool sharing toggle + tray ---------- */
const sw = $("#tool-switch");
const tray = $("#tool-tray");
const swText = $("#tool-switch-text");

sw.addEventListener("click", () => setTools(sw.getAttribute("aria-checked") !== "true"));

function setTools(on) {
  sw.setAttribute("aria-checked", String(on));
  swText.textContent = on ? "Yes" : "No";
  tray.classList.toggle("open", on);
  if (on) {
    tray.removeAttribute("inert");
    if (!$$(".tool-row", tray).length) addToolRow();
    requestAnimationFrame(() => $(".tool-name", tray)?.focus());
  } else {
    tray.setAttribute("inert", "");
  }
}

const CATEGORIES = ["Hand tools", "Power tools", "Digging and soil", "Pruning and cutting", "Watering", "Carts and hauling", "Ladders", "Harvest and food prep", "Seed starting", "Other"];

function addToolRow() {
  const row = document.createElement("div");
  row.className = "tool-row";
  const id = "t" + Math.random().toString(36).slice(2, 7);
  row.innerHTML =
    '<div class="field"><label for="' + id + 'n">Tool</label>' +
      '<input class="tool-name" id="' + id + 'n" type="text" placeholder="Wheelbarrow"></div>' +
    '<div class="field"><label for="' + id + 'c">Category</label><select id="' + id + 'c" class="tool-cat">' +
      CATEGORIES.map(c => '<option>' + c + '</option>').join("") + '</select></div>' +
    '<div class="field"><label for="' + id + 'd">Notes <span class="optional">(optional)</span></label>' +
      '<input class="tool-note" id="' + id + 'd" type="text" placeholder="Flat tire, still rolls fine"></div>' +
    '<button type="button" class="remove" aria-label="Remove this tool">&times;</button>';
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    if (!$$(".tool-row", tray).length) addToolRow();
  });
  $("#tool-list").appendChild(row);
}
$("#add-tool").addEventListener("click", () => {
  addToolRow();
  $$(".tool-name", tray).pop().focus();
});

function collectTools() {
  if (sw.getAttribute("aria-checked") !== "true") return [];
  return $$(".tool-row", tray)
    .map(r => ({
      tool: r.querySelector(".tool-name").value.trim(),
      category: r.querySelector(".tool-cat").value,
      notes: r.querySelector(".tool-note").value.trim()
    }))
    .filter(t => t.tool);
}

/* ---------- address autocomplete (Mapbox) ---------- */
const street = $("#street");
const box = $("#street-suggestions");
let timer, features = [];

street.addEventListener("input", () => {
  $("#lat").value = "";
  $("#lng").value = "";
  clearTimeout(timer);
  const q = street.value.trim();
  if (!MAPBOX_TOKEN || q.length < 4) return hideSuggestions();
  timer = setTimeout(() => lookup(q), 280);
});

async function lookup(q) {
  const url = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + encodeURIComponent(q) +
    ".json?access_token=" + MAPBOX_TOKEN +
    "&country=us&types=address&limit=5&proximity=-87.7080,41.9400";
  try {
    const r = await fetch(url);
    const data = await r.json();
    features = data.features || [];
    if (!features.length) return hideSuggestions();
    box.innerHTML = "";
    features.forEach((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.textContent = f.place_name;
      b.addEventListener("click", () => choose(i));
      box.appendChild(b);
    });
    box.hidden = false;
    street.setAttribute("aria-expanded", "true");
  } catch (e) {
    hideSuggestions();
  }
}

function choose(i) {
  const f = features[i];
  const part = t => (f.context || []).find(c => c.id.startsWith(t));
  street.value = f.address ? f.address + " " + f.text : f.text;
  $("#city").value = part("place")?.text || $("#city").value;
  $("#state").value = part("region")?.short_code?.replace("US-", "") || $("#state").value;
  $("#zip").value = part("postcode")?.text || $("#zip").value;
  $("#lng").value = f.center[0];
  $("#lat").value = f.center[1];
  hideSuggestions();
}

function hideSuggestions() {
  box.hidden = true;
  street.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", e => {
  if (!e.target.closest(".autocomplete")) hideSuggestions();
});
street.addEventListener("keydown", e => {
  if (e.key === "Escape") hideSuggestions();
  if (e.key === "ArrowDown" && !box.hidden) {
    e.preventDefault();
    box.querySelector("button")?.focus();
  }
});

/* ---------- submit ---------- */
const form = $("#member-form");
const statusEl = $("#status");

form.addEventListener("submit", async e => {
  e.preventDefault();
  statusEl.className = "status";
  statusEl.textContent = "";

  const missing = ["first", "last", "email", "street", "city", "state", "zip"].filter(id => !$("#" + id).value.trim());
  if (missing.length) {
    $("#" + missing[0]).focus();
    statusEl.className = "status bad";
    statusEl.textContent = "A few fields still need filling in.";
    return;
  }
  if (!$("#consent").checked) {
    $("#consent").focus();
    statusEl.className = "status bad";
    statusEl.textContent = "Please check the box so we know it's okay to list you.";
    return;
  }

  const payload = {
    first: $("#first").value.trim(),
    last: $("#last").value.trim(),
    email: $("#email").value.trim(),
    phone: $("#phone").value.trim(),
    street: $("#street").value.trim(),
    unit: $("#unit").value.trim(),
    city: $("#city").value.trim(),
    state: $("#state").value.trim(),
    zip: $("#zip").value.trim(),
    lat: $("#lat").value,
    lng: $("#lng").value,
    interests: $$('input[name="interest"]:checked').map(c => c.value),
    about: $("#about").value.trim(),
    toolSharing: sw.getAttribute("aria-checked") === "true",
    tools: collectTools(),
    toolNotes: $("#tool-notes").value.trim(),
    consent: true,
    source: "membership.html"
  };

  const btn = $("#submit-btn");
  btn.disabled = true;
  statusEl.textContent = "Saving your spot...";

  try {
    if (!APPS_SCRIPT_URL.startsWith("http")) throw new Error("no endpoint");
    // text/plain keeps this a simple request, so Apps Script sees no CORS preflight
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || "sheet error");
    finish();
  } catch (err) {
    console.warn("Primary submit failed, falling back:", err);
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      finish();
    } catch (err2) {
      btn.disabled = false;
      statusEl.className = "status bad";
      statusEl.textContent = "That didn't go through. Try again, or email avondalegardeners@gmail.com and we'll add you by hand.";
    }
  }
});

function finish() {
  form.hidden = true;
  $("#intro").hidden = true;
  $("#done").hidden = false;
  $("#done h2").setAttribute("tabindex", "-1");
  $("#done h2").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
