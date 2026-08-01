/* Settings live in assets/config.js. Loaded before this file. */
const CFG = window.AGA_CONFIG || {};
const APPS_SCRIPT_URL = CFG.APPS_SCRIPT_URL || "";
// The form does not use Mapbox. Addresses are looked up by the Apps Script,
// which asks the US Census geocoder.

// Add ?debug to the page URL to surface the real error text on screen
const DEBUG = new URLSearchParams(location.search).has("debug");

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

/* ---------- address check ----------
   Asks the Apps Script to look the address up while somebody is filling the
   form, so a typo shows up here instead of as a missing pin later. Purely
   advisory: the server geocodes again on submit either way. */

const street = $("#street");
const geoStatus = $("#geo-status");
let geoTimer;

["#street", "#city", "#state", "#zip"].forEach(sel => {
  $(sel).addEventListener("input", () => {
    $("#lat").value = "";
    $("#lng").value = "";
    clearTimeout(geoTimer);
    geoTimer = setTimeout(checkAddress, 700);
  });
});

async function checkAddress() {
  const parts = [street.value, $("#city").value, $("#state").value, $("#zip").value]
    .map(v => v.trim()).filter(Boolean);

  if (!street.value.trim() || !$("#zip").value.trim() || !APPS_SCRIPT_URL.startsWith("http")) {
    setGeo("", "");
    return;
  }

  setGeo("looking", "Checking that address...");
  try {
    const res = await fetch(APPS_SCRIPT_URL + "?action=geocode&q=" + encodeURIComponent(parts.join(", ")));
    const data = await res.json();
    if (data.found) {
      $("#lat").value = data.lat;
      $("#lng").value = data.lng;
      setGeo("found", "Found it: " + data.matched);
    } else {
      setGeo("missing", "We couldn't place that one. Go ahead and sign up anyway, we'll sort the pin out.");
    }
  } catch (err) {
    if (DEBUG) console.warn("Address check failed:", err);
    setGeo("", "");
  }
}

function setGeo(state, text) {
  geoStatus.className = "geo-status" + (state ? " " + state : "");
  geoStatus.textContent = text;
}

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
    if (!APPS_SCRIPT_URL.startsWith("http")) {
      throw new Error("APPS_SCRIPT_URL has not been filled in yet.");
    }
    if (!/\/exec$/.test(APPS_SCRIPT_URL)) {
      throw new Error("APPS_SCRIPT_URL should end in /exec, not /dev.");
    }

    // text/plain keeps this a simple request, so Apps Script sees no CORS preflight
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const raw = await res.text();
    if (DEBUG) console.log("Apps Script replied:", res.status, raw);

    let out;
    try {
      out = JSON.parse(raw);
    } catch (parseErr) {
      // An HTML reply means Google served a login or error page instead of the script
      throw new Error("Google returned a page instead of data. The deployment is probably not set to 'Anyone'.");
    }
    if (!out.ok) throw new Error(out.error || "The script ran but did not write a row.");

    finish();
  } catch (err) {
    console.error("Sign-up failed:", err);
    btn.disabled = false;
    statusEl.className = "status bad";
    statusEl.textContent = DEBUG
      ? err.message
      : "That didn't go through. Try again, or email avondalegardeners@gmail.com and we'll add you by hand.";
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
