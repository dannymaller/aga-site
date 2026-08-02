/* Member map. Leaflet with OpenStreetMap tiles, no API key anywhere.
   The one setting it needs lives in assets/config.js. */

const DEBUG = new URLSearchParams(location.search).has("debug");

// Avondale, roughly Belmont and Kedzie
const CENTER = [41.9400, -87.7080];
const ZOOM = 14;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let map = null;
let members = [];
let markers = new Map();
let activeFilter = "all";

/* Interests arrive as free text from the sheet, so match on keywords. */
const MATCHERS = {
  garden: t => t.includes("have a garden"),
  space: t => t.includes("no space"),
  help: t => t.includes("could use help"),
  helper: t => t.includes("want to help") || t.includes("just getting started")
};

function kindOf(m) {
  const t = m.interests.join(" ").toLowerCase();
  if (MATCHERS.garden(t)) return "garden";
  if (MATCHERS.space(t)) return "space";
  if (MATCHERS.help(t)) return "help";
  return "other";
}

function matches(m, filter) {
  if (filter === "all") return true;
  if (filter === "tools") return m.toolSharing && m.tools.length > 0;
  const t = m.interests.join(" ").toLowerCase();
  return MATCHERS[filter] ? MATCHERS[filter](t) : true;
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

  map = L.map("map", { scrollWheelZoom: false }).setView(CENTER, ZOOM);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Page scrolls freely until you click into the map
  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());

  load();
}

async function load() {
  try {
    const data = await AGA.authed("members");
    if (!data) return;                       // the page is already heading to login
    if (!data.ok) throw new Error(data.error || "Could not read the member list.");

    members = (data.members || []).filter(m => m.lat && m.lng);
    render();
  } catch (err) {
    console.error("Map load failed:", err);
    $("#count").textContent = "";
    showMessage("Couldn't load members", DEBUG ? err.message : "Something went wrong reading the member list. Try a refresh in a minute.");
  }
}

/* ---------- rendering ---------- */

function render() {
  const shown = members.filter(m => matches(m, activeFilter));

  markers.forEach(mk => map.removeLayer(mk));
  markers = new Map();

  shown.forEach(m => {
    const icon = L.divIcon({
      className: "",
      html: '<span class="pin pin-' + kindOf(m) +
        (m.toolSharing && m.tools.length ? " has-tools" : "") + '"></span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12]
    });
    const marker = L.marker([m.lat, m.lng], { icon: icon, title: m.name, alt: m.name })
      .addTo(map)
      .bindPopup(popupHTML(m), { maxWidth: 280 });
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
      '<span class="who"><i class="dot dot-' + kindOf(m) + '"></i>' + esc(m.name) + "</span>" +
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
    ? n + (n === 1 ? " member" : " members") + (activeFilter === "all" ? " on the map" : " match")
    : "";

  if (shown.length > 1) {
    map.fitBounds(L.latLngBounds(shown.map(m => [m.lat, m.lng])).pad(0.25));
  } else if (shown.length === 1) {
    map.setView([shown[0].lat, shown[0].lng], 16);
  }
}

function popupHTML(m) {
  let html = '<div class="pop"><h3>' + esc(m.name) + "</h3>";
  if (m.interests.length) {
    html += "<ul>" + m.interests.map(i => "<li>" + esc(i) + "</li>").join("") + "</ul>";
  }
  if (m.about) html += '<p class="about">' + esc(m.about) + "</p>";
  if (m.toolSharing && m.tools.length) {
    html += '<p class="tools-head">Happy to lend</p>';
    html += m.tools.map(t =>
      '<div class="tool">' + esc(t.tool) +
      (t.notes ? ' <span>(' + esc(t.notes) + ")</span>" : "") + "</div>"
    ).join("");
    if (m.toolNotes) html += '<p class="note">' + esc(m.toolNotes) + "</p>";
  }
  html += '<a class="say-hi" href="mailto:avondalegardeners@gmail.com?subject=' +
    encodeURIComponent("Hello to " + m.name + " from the member map") +
    '">Say hello through AGA</a>';
  return html + "</div>";
}

function focusMember(m) {
  const marker = markers.get(m.id);
  if (!marker || !map) return;
  map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 16), { duration: 0.7 });
  marker.openPopup();
}

/* ---------- filters ---------- */

$$(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    $$(".chip").forEach(c => c.classList.remove("is-on"));
    chip.classList.add("is-on");
    activeFilter = chip.dataset.filter;
    render();
  });
});

start();
