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

  map = L.map("map", { scrollWheelZoom: false, zoomControl: false }).setView(CENTER, ZOOM);
  L.control.zoom({ position: "topright" }).addTo(map);
  basemap().addTo(map);

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

function render() {
  const shown = members.filter(matches);

  markers.forEach(mk => map.removeLayer(mk));
  markers = new Map();

  shown.forEach(m => {
    const icon = L.divIcon({
      className: "",
      html: '<span class="pin' + (lends(m) ? " pin-tools" : "") + '"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -13]
    });
    const marker = L.marker([m.lat, m.lng], { icon: icon, title: m.name, alt: m.name })
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
          m.tools.map(t =>
            "<li><span class=\"t-name\">" + esc(t.tool) + "</span>" +
            (t.notes ? '<span class="t-note">' + esc(t.notes) + "</span>" : "") +
            "</li>"
          ).join("") +
        "</ul>" +
        (m.toolNotes ? '<p class="pop-pickup">' + esc(m.toolNotes) + "</p>" : "") +
      "</div>";
  }

  return '<div class="pop">' +
      '<h3 class="pop-name">' + esc(m.name) + "</h3>" +
      tags + about + tools +
      '<a class="pop-cta" href="mailto:avondalegardeners@gmail.com?subject=' +
        encodeURIComponent("Hello to " + m.name + " from the member map") +
      '">Say hello through AGA</a>' +
    "</div>";
}

function focusMember(m) {
  const marker = markers.get(m.id);
  if (!marker || !map) return;
  map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 16), { duration: 0.7 });
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

start();
