/* Settings live in assets/config.js. Loaded before this file. */
const CFG = window.AGA_CONFIG || {};
const APPS_SCRIPT_URL = CFG.APPS_SCRIPT_URL || "";
// The form does not use Mapbox. Addresses are looked up by the Apps Script,
// which asks the US Census geocoder.

// Add ?debug to the page URL to surface the real error text on screen
const DEBUG = new URLSearchParams(location.search).has("debug");

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- arriving from the login card ----------
   Google already told us who they are, so start them part way in. */

const handoff = new URLSearchParams(location.search);
const pendingGoogle = (() => {
  try { return sessionStorage.getItem("aga_pending_google"); } catch (e) { return null; }
})();

["email", "first", "last"].forEach(key => {
  const value = handoff.get(key);
  const field = $("#" + key);
  if (value && field && !field.value) field.value = value;
});

if (pendingGoogle) {
  const address = handoff.get("email") || "";
  const note = $("#google-note");
  if (note && address) {
    $("#google-note-email").textContent = address;
    note.hidden = false;
  }
  if (address) {
    // Their Google account owns this address, so no need to let them edit it
    $("#email").readOnly = true;
    $("#email").classList.add("locked");
  }
}

/* ---------- signed-in members are editing, not joining ---------- */

if (window.AGA && AGA.session()) prefill();

async function prefill() {
  try {
    const data = await AGA.call("me", { token: AGA.token() });
    if (!data.ok || !data.profile) return;
    const p = data.profile;

    $("#page-title").textContent = "Update your details";
    if ($("#already")) $("#already").hidden = true;
    $("#submit-btn").textContent = "Save changes";
    $("#done-next").href = "dashboard.html";

    [["first", p.first], ["last", p.last], ["email", p.email], ["phone", p.phone],
     ["street", p.street], ["unit", p.unit], ["city", p.city], ["state", p.state],
     ["zip", p.zip], ["about", p.about], ["lat", p.lat], ["lng", p.lng],
     ["tool-notes", p.toolNotes]].forEach(pair => {
      const el = $("#" + pair[0]);
      if (el && pair[1]) el.value = pair[1];
    });

    $$('input[name="interest"]').forEach(box => {
      box.checked = (p.interests || []).indexOf(box.value) > -1;
    });

    $("#consent").checked = true;

    if (p.toolSharing && p.tools.length) {
      setTools(true);
      $("#tool-list").innerHTML = "";
      p.tools.forEach(t => {
        addToolRow();
        const row = $$(".tool-row", tray).pop();
        row.querySelector(".tool-name").value = t.tool || "";
        row.querySelector(".tool-note").value = t.notes || "";
        if (t.category) row.querySelector(".tool-cat").value = t.category;
      });
    }
  } catch (err) {
    if (DEBUG) console.warn("Prefill skipped:", err);
  }
}

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
    source: "membership.html",
    googleCredential: pendingGoogle || ""
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

    // Signed up through Google? The reply carries the session, so go straight in.
    if (out.token) {
      try { sessionStorage.removeItem("aga_pending_google"); } catch (e) {}
      AGA.save({
        token: out.token,
        expires: out.expires,
        email: (out.profile && out.profile.email) || payload.email,
        profile: out.profile
      });
      location.href = "dashboard.html";
      return;
    }

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

async function finish() {
  // Joined through Google? Sign them straight in rather than sending them
  // back around the login screen.
  if (pendingGoogle) {
    try {
      const data = await AGA.call("googleSignIn", { credential: pendingGoogle });
      if (data.ok && data.token) {
        try { sessionStorage.removeItem("aga_pending_google"); } catch (e) {}
        AGA.save({ token: data.token, expires: data.expires, email: data.profile.email, profile: data.profile });
        location.href = "dashboard.html";
        return;
      }
    } catch (err) {
      if (DEBUG) console.warn("Auto sign-in after joining failed:", err);
    }
  }

  form.hidden = true;
  $("#intro").hidden = true;
  $("#done").hidden = false;
  $("#done h2").setAttribute("tabindex", "-1");
  $("#done h2").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
