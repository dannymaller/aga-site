/* Member map. Leaflet with OpenStreetMap tiles, no API key anywhere.
   The one setting it needs lives in assets/config.js. */

const CFG = window.AGA_CONFIG || {};
const DEBUG = new URLSearchParams(location.search).has("debug");

const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const BASEMAPS = {
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    options: { maxZoom: 20, subdomains: "abcd", attribution: OSM_CREDIT + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' }
  },
  positron: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: { maxZoom: 20, subdomains: "abcd", attribution: OSM_CREDIT + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' }
  },
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { maxZoom: 19, attribution: OSM_CREDIT }
  }
};

function basemap() {
  const want = (CFG.BASEMAP || "voyager").toLowerCase();

  if (want === "mapbox" && (CFG.MAPBOX_TOKEN || "").startsWith("pk.")) {
    const style = CFG.MAPBOX_STYLE || "outdoors-v12";
    return L.tileLayer(
      "https://api.mapbox.com/styles/v1/mapbox/" + style +
      "/tiles/512/{z}/{x}/{y}@2x?access_token=" + CFG.MAPBOX_TOKEN,
      {
        maxZoom: 20,
        zoomOffset: -1,
        tileSize: 512,
        attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> ' + OSM_CREDIT
      }
    );
  }

  const pick = BASEMAPS[want] || BASEMAPS.voyager;
  return L.tileLayer(pick.url, pick.options);
}

// Avondale, roughly Belmont and Kedzie
const CENTER = [41.9400, -87.7080];
const ZOOM = 14;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let map = null;
let members = [];
let markers = new Map();
let gardenFilters = new Set();
let toolFilters = new Set();

/* Interests arrive as free text from the sheet, so match on keywords. */
const MATCHERS = {
  garden:   t => t.includes("have a garden"),
  space:    t => t.includes("no space"),
  help:     t => t.includes("could use help"),
  helper:   t => t.includes("want to help"),
  starting: t => t.includes("just getting started"),
  seeds:    t => t.includes("seeds")
};

function lends(m) {
  return m.toolSharing && m.tools.length > 0;
}

function matchesTool(m, filter) {
  if (!lends(m)) return false;
  if (filter === "any") return true;
  return m.tools.some(t => (t.category || "Other") === filter);
}

/**
 * Within a group, any selected chip counts. Across the two groups both have to
 * agree, so Has a garden plus Ladders means gardeners who lend ladders.
 */
function matches(m) {
  const text = m.interests.join(" ").toLowerCase();

  const gardenOk = !gardenFilters.size ||
    [...gardenFilters].some(f => MATCHERS[f] && MATCHERS[f](text));

  const toolOk = !toolFilters.size ||
    [...toolFilters].some(f => matchesTool(m, f));

  return gardenOk && toolOk;
}

function anyFilterOn() {
  return gardenFilters.size > 0 || toolFilters.size > 0;
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showMessage(title, body) {
  $("#map-message-title").textContent = title;
  $("#map-message-body").textContent = body;
  $("#map-message").hidden = false;
}

/* ---------- boot ---------- */

function start() {
  if (!AGA.require()) return;   // bounces to the login page

  map = L.map("map", { scrollWheelZoom: true, zoomControl: false }).setView(CENTER, ZOOM);
  L.control.zoom({ position: "topright" }).addTo(map);
  basemap().addTo(map);

  load();
}

async function load() {
  try {
    const data = await AGA.authed("members");
    if (!data) return;                       // the page is already heading to login
    if (!data.ok) throw new Error(data.error || "Could not read the member list.");

    members = (data.members || []).filter(m => m.lat && m.lng);
    buildToolFilters();
    render();
  } catch (err) {
    console.error("Map load failed:", err);
    $("#count").textContent = "";
    showMessage("Couldn't load members", DEBUG ? err.message : "Something went wrong reading the member list. Try a refresh in a minute.");
  }
}

/** Builds the tool chips from the categories members actually listed. */
function buildToolFilters() {
  const box = $("#tool-filters");
  const row = $(".filters", box);
  const categories = new Set();

  members.forEach(m => {
    if (lends(m)) m.tools.forEach(t => categories.add(t.category || "Other"));
  });

  if (!categories.size) {
    box.hidden = true;
    return;
  }

  row.innerHTML = "";
  const options = ["any", ...[...categories].sort()];

  options.forEach(value => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.tool = value;
    chip.setAttribute("aria-pressed", "false");
    chip.textContent = value === "any" ? "Shares any tools" : value;
    chip.addEventListener("click", () => toggle(toolFilters, value));
    row.appendChild(chip);
  });

  box.hidden = false;
}

/* ---------- rendering ---------- */

/**
 * Returns a Map of member id -> [lat, lng] to draw at. Members closer than
 * ~12m to each other are treated as sharing a spot (a building or household)
 * and fanned into a small ring around their shared center, so no pin hides
 * another. A lone member keeps their exact coordinate.
 */
function placePins(list) {
  const out = new Map();
  const CLUSTER_M = 12;         // how close counts as "same place"
  const RING_M = 9;             // radius of the fan-out ring

  // meters -> degrees, latitude-corrected for longitude
  const mToLat = (m) => m / 111320;
  const mToLng = (m, lat) => m / (111320 * Math.cos(lat * Math.PI / 180));

  const groups = [];
  list.forEach(m => {
    // find an existing group whose center is within CLUSTER_M
    let g = groups.find(gr => {
      const dLat = (m.lat - gr.lat) * 111320;
      const dLng = (m.lng - gr.lng) * 111320 * Math.cos(m.lat * Math.PI / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) <= CLUSTER_M;
    });
    if (!g) { g = { lat: m.lat, lng: m.lng, members: [] }; groups.push(g); }
    g.members.push(m);
  });

  groups.forEach(g => {
    if (g.members.length === 1) {
      const m = g.members[0];
      out.set(m.id, [m.lat, m.lng]);
      return;
    }
    // fan the group evenly around a ring centered on the shared spot
    const n = g.members.length;
    g.members.forEach((m, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top
      const lat = g.lat + mToLat(RING_M) * Math.sin(angle);
      const lng = g.lng + mToLng(RING_M, g.lat) * Math.cos(angle);
      out.set(m.id, [lat, lng]);
    });
  });

  return out;
}

function render() {
  const shown = members.filter(matches);

  markers.forEach(mk => map.removeLayer(mk));
  markers = new Map();

  // Members at the same address (or within a few meters, which is what
  // geocoding a shared building gives) would otherwise stack one pin exactly
  // on top of another, hiding everyone but the last drawn. Group anyone who
  // lands within ~12m and fan a group of two or more into a small ring around
  // the shared spot, so every household member gets a visible, clickable pin.
  const placed = placePins(shown);

  shown.forEach(m => {
    const icon = L.divIcon({
      className: "",
      html: '<span class="pin' + (lends(m) ? " pin-tools" : "") + '"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -13]
    });
    const at = placed.get(m.id) || [m.lat, m.lng];
    const marker = L.marker(at, { icon: icon, title: m.name, alt: m.name })
      .addTo(map)
      .bindPopup(popupHTML(m), { maxWidth: 340, minWidth: 260, autoPanPadding: [30, 30] });
    markers.set(m.id, marker);
  });

  const list = $("#member-list");
  list.innerHTML = "";

  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = members.length
      ? "Nobody matches that filter yet."
      : "No members on the map yet. Be the first one on it.";
    list.appendChild(li);
  }

  shown.forEach(m => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML =
      '<span class="who">' + esc(m.name) + "</span>" +
      '<span class="tags">' + esc(m.interests.join(" \u00b7 ") || "Member") + "</span>" +
      (m.toolSharing && m.tools.length
        ? '<span class="tools-flag">' + m.tools.length + (m.tools.length === 1 ? " tool" : " tools") + " to share</span>"
        : "");
    btn.addEventListener("click", () => focusMember(m));
    li.appendChild(btn);
    list.appendChild(li);
  });

  const n = shown.length;
  $("#count").textContent = members.length
    ? n + (n === 1 ? " member" : " members") + (anyFilterOn() ? " match" : " on the map")
    : "";

  if (shown.length > 1) {
    map.fitBounds(L.latLngBounds(shown.map(m => [m.lat, m.lng])).pad(0.25));
  } else if (shown.length === 1) {
    map.setView([shown[0].lat, shown[0].lng], 16);
  }
}

function popupHTML(m) {
  const tags = m.interests.length
    ? '<ul class="pop-tags">' + m.interests.map(i => "<li>" + esc(i) + "</li>").join("") + "</ul>"
    : "";

  const about = m.about ? '<p class="pop-about">' + esc(m.about) + "</p>" : "";

  let tools = "";
  if (m.toolSharing && m.tools.length) {
    tools =
      '<div class="pop-section">' +
        '<p class="pop-label">Happy to lend</p>' +
        '<ul class="pop-tools">' +
          m.tools.map(t => {
            const askable = t.id && t.status !== "on loan" && t.status !== "paused";
            return "<li><span class=\"t-name\">" + esc(t.tool) + "</span>" +
              (t.notes ? '<span class="t-note">' + esc(t.notes) + "</span>" : "") +
              (askable
                ? '<button type="button" class="t-ask" data-ask="' + esc(t.id) +
                  '" data-toolname="' + esc(t.tool) + '" data-owner="' + esc(m.name) + '">Ask to borrow</button>'
                : (t.id ? '<span class="t-out">' + (t.status === "on loan" ? "On loan" : "Paused") + "</span>" : "")) +
              "</li>";
          }).join("") +
        "</ul>" +
        (m.toolNotes ? '<p class="pop-pickup">' + esc(m.toolNotes) + "</p>" : "") +
      "</div>";
  }

  return '<div class="pop">' +
      '<h3 class="pop-name"><a class="pop-profile-link" href="member.html?id=' + esc(m.id) + '">' + esc(m.name) + "</a></h3>" +
      tags + about + tools +
      '<a class="pop-cta" href="member.html?id=' + esc(m.id) + '">View full profile</a>' +
    "</div>";
}

function openBorrow(toolId, toolName, ownerName) {
  if (!AGA.session()) { location.href = "login.html?next=map.html"; return; }
  ensureBorrowModal();
  $("#borrow-tool").textContent = toolName;
  $("#borrow-owner").textContent = ownerName;
  $("#borrow-msg").value = "";
  $("#borrow-start").value = "";
  $("#borrow-due").value = "";
  $("#borrow-consent").checked = false;
  $("#borrow-error").hidden = true;
  $("#borrow-reviews").innerHTML = '<p class="muted-sm">Checking reviews...</p>';
  $("#borrow-modal").dataset.toolId = toolId;
  $("#borrow-modal").hidden = false;
  loadToolReviews(toolId);
}

async function loadToolReviews(toolId) {
  const host = $("#borrow-reviews");
  try {
    const data = await AGA.authed("toolDetail", { toolId });
    if (!data || !data.ok) { host.innerHTML = ""; return; }
    const tool = data.tool;

    if (!tool.rating.count) {
      host.innerHTML = '<p class="muted-sm">No reviews yet. You could be the first.</p>';
      return;
    }

    let html = '<p class="br-rating">' + starRow(tool.rating.average) + " " +
      tool.rating.average + " from " + tool.rating.count +
      (tool.rating.count === 1 ? " borrower" : " borrowers") + "</p>";

    tool.reviews
      .filter(r => r.direction === "of_owner")
      .slice(0, 3)
      .forEach(r => {
        html += '<div class="br-review">' +
          '<p class="br-head">' + starRow(r.rating) + " <strong>" + esc(r.reviewerName) + "</strong></p>" +
          (r.comment ? '<p class="br-comment">' + esc(r.comment) + "</p>" : "") +
          "</div>";
      });
    host.innerHTML = html;
  } catch (err) {
    host.innerHTML = "";
  }
}

function starRow(n) {
  const full = Math.round(n);
  return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
}

function ensureBorrowModal() {
  if ($("#borrow-modal")) return;
  const veil = document.createElement("div");
  veil.className = "modal-veil";
  veil.id = "borrow-modal";
  veil.hidden = true;
  veil.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="borrow-title">' +
      '<h2 id="borrow-title">Ask to borrow</h2>' +
      '<p class="borrow-sub">You are asking <strong id="borrow-owner"></strong> for their <strong id="borrow-tool"></strong>. ' +
        'They will get an email and can say yes or no.</p>' +
      '<div id="borrow-reviews" class="borrow-reviews"></div>' +
      '<div class="field-pair">' +
        '<div class="field"><label for="borrow-start">Borrow from <span class="optional">(optional)</span></label>' +
          '<input id="borrow-start" type="datetime-local"></div>' +
        '<div class="field"><label for="borrow-due">Return it by <span class="optional">(optional)</span></label>' +
          '<input id="borrow-due" type="datetime-local"></div>' +
      '</div>' +
      '<div class="field"><label for="borrow-msg">A note <span class="optional">(optional)</span></label>' +
        '<textarea id="borrow-msg" maxlength="500" placeholder="What you need it for, when you could pick it up..."></textarea></div>' +
      '<div class="disclaimer">Borrowing is between you and the owner. The Avondale Gardening Alliance just runs the board. ' +
        'AGA is not responsible for lost, damaged, or stolen tools, for injuries, or for any dispute between members. ' +
        'Take care of what you borrow and return it as agreed.</div>' +
      '<label class="consent-row"><input type="checkbox" id="borrow-consent">' +
        '<span>I understand AGA is not liable and I agree to these terms.</span></label>' +
      '<p class="modal-error" id="borrow-error" hidden></p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-outline" id="borrow-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-teal" id="borrow-send">Send request</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(veil);

  veil.addEventListener("click", e => { if (e.target === veil) veil.hidden = true; });
  $("#borrow-cancel").addEventListener("click", () => veil.hidden = true);
  $("#borrow-send").addEventListener("click", sendBorrow);
}

async function sendBorrow() {
  const modal = $("#borrow-modal");
  const toolId = modal.dataset.toolId;

  if (!$("#borrow-consent").checked) {
    const e = $("#borrow-error");
    e.textContent = "Please agree to the lending terms first.";
    e.hidden = false;
    return;
  }

  const btn = $("#borrow-send");
  btn.disabled = true;
  try {
    const start = $("#borrow-start").value;
    const due = $("#borrow-due").value;
    if (start && due && new Date(due) <= new Date(start)) {
      const e = $("#borrow-error");
      e.textContent = "The return time needs to be after the pickup.";
      e.hidden = false;
      btn.disabled = false;
      return;
    }
    const data = await AGA.authed("requestLoan", {
      toolId,
      message: $("#borrow-msg").value.trim(),
      start: start || "",
      due: due || "",
      consent: true
    });
    if (!data) return;
    if (!data.ok) {
      const e = $("#borrow-error");
      e.textContent = data.error || "Couldn't send that.";
      e.hidden = false;
      return;
    }
    modal.hidden = true;
    if (map) map.closePopup();
    alert("Request sent. " + $("#borrow-owner").textContent + " will get an email.");
  } catch (err) {
    const e = $("#borrow-error");
    e.textContent = AGA.debug ? err.message : "Couldn't reach the server.";
    e.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function focusMember(m) {
  const marker = markers.get(m.id);
  if (!marker || !map) return;
  // Use the marker's real position, which may be fanned out from the raw
  // coordinate when several members share an address.
  map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.7 });
  marker.openPopup();
}

/* ---------- filters ---------- */

function toggle(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
  paintChips();
  render();
}

function clearFilters() {
  gardenFilters.clear();
  toolFilters.clear();
  paintChips();
  render();
}

function paintChips() {
  $$("[data-garden]").forEach(c => {
    const on = gardenFilters.has(c.dataset.garden);
    c.classList.toggle("is-on", on);
    c.setAttribute("aria-pressed", String(on));
  });
  $$("[data-tool]").forEach(c => {
    const on = toolFilters.has(c.dataset.tool);
    c.classList.toggle("is-on", on);
    c.setAttribute("aria-pressed", String(on));
  });
  const all = $('[data-filter="all"]');
  all.classList.toggle("is-on", !anyFilterOn());
  all.setAttribute("aria-pressed", String(!anyFilterOn()));
}

$$("[data-garden]").forEach(chip => {
  chip.addEventListener("click", () => toggle(gardenFilters, chip.dataset.garden));
});
$('[data-filter="all"]').addEventListener("click", clearFilters);

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-ask]");
  if (btn) openBorrow(btn.dataset.ask, btn.dataset.toolname, btn.dataset.owner);
});

// Landed here from a profile's Ask to borrow button
const borrowIntent = new URLSearchParams(location.search);
if (borrowIntent.get("borrow")) {
  setTimeout(() => {
    openBorrow(borrowIntent.get("borrow"), borrowIntent.get("tool") || "this tool",
      borrowIntent.get("owner") || "this member");
  }, 400);
}

start();
