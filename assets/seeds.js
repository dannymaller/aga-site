/* Seed library catalog grid. Settings come from config.js; auth.js gives us AGA. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const DEBUG = new URLSearchParams(location.search).has("debug");

if (AGA.require()) {
  let all = [];
  let cat = "all";
  let onlyAvailable = false;

  // Each category gets a botanical tile treatment (a colored plate) so the grid
  // reads as intentional until real photos are added per plant.
  const TILE = {
    "Food crops": "tile-food",
    "Herbs": "tile-herb",
    "Flowers": "tile-flower",
    "Shrubs": "tile-shrub",
  };

  // Photos live in assets/seeds/ named after the catalog id. We try each
  // extension in turn; if none resolve, the img is dropped and the category
  // colour plate behind it shows through.
  const IMG_DIR = "assets/seeds/";
  const IMG_EXTS = [".jpg", ".png", ".webp", ".jpeg"];

  load();

  async function load() {
    try {
      const data = await AGA.authed("seedCatalog");
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : "Could not load the catalog.");
      all = data.seeds || [];
      $("#loading").hidden = true;
      $("#seed-filters").hidden = false;
      $("#seed-grid").hidden = false;
      wireFilters();
      render();
    } catch (e) {
      $("#loading").textContent = DEBUG ? e.message : "The seed library isn't loading. Try again in a moment.";
    }
  }

  function wireFilters() {
    $$(".chip").forEach(c => c.addEventListener("click", () => {
      $$(".chip").forEach(x => x.classList.remove("is-on"));
      c.classList.add("is-on");
      cat = c.dataset.cat;
      render();
    }));
    $("#only-available").addEventListener("change", e => {
      onlyAvailable = e.target.checked;
      render();
    });
  }

  function render() {
    const grid = $("#seed-grid");
    grid.innerHTML = "";
    let shown = all.filter(s => cat === "all" || s.category === cat);
    if (onlyAvailable) shown = shown.filter(s => s.availableFrom > 0);

    $("#seed-empty").hidden = shown.length > 0;

    shown.forEach(s => {
      const card = document.createElement("a");
      card.className = "seed-card";
      card.href = "seed.html?id=" + encodeURIComponent(s.id);

      const have = s.availableFrom > 0
        ? '<span class="have-badge">' + s.availableFrom + ' ' + (s.availableFrom === 1 ? "neighbor has it" : "neighbors have it") + '</span>'
        : '<span class="have-badge have-none">No one has it yet</span>';

      const stars = s.rating.count
        ? '<span class="seed-stars" title="' + s.rating.average + ' from ' + s.rating.count + '">' +
            "\u2605".repeat(Math.round(s.rating.average)) + '<span class="star-off">' +
            "\u2605".repeat(5 - Math.round(s.rating.average)) + '</span></span>'
        : "";

      card.innerHTML =
        '<div class="seed-tile ' + (TILE[s.category] || "tile-food") + '">' +
          '<img class="tile-img" alt="" loading="lazy" src="' +
            IMG_DIR + encodeURIComponent(s.id) + IMG_EXTS[0] + '" data-ext="0" data-sid="' + esc(s.id) + '">' +
        '</div>' +
        '<div class="seed-card-body">' +
          '<div class="seed-card-top">' +
            '<span class="seed-cat">' + esc(s.category) + '</span>' + stars +
          '</div>' +
          '<h2>' + esc(s.name) + '</h2>' +
          '<p class="seed-blurb">' + esc(s.blurb) + '</p>' +
          '<dl class="seed-quick">' +
            row("Plant", s.plantWhen) +
            row("Sun", s.sun) +
            row("Ready", s.daysToMaturity) +
          '</dl>' +
          have +
        '</div>';
      grid.appendChild(card);
      const img = card.querySelector(".tile-img");
      if (img) img.addEventListener("error", onImgError);
    });
  }

  // Walk the extension list; give up quietly once it is exhausted.
  function onImgError(e) {
    const img = e.currentTarget;
    const next = Number(img.dataset.ext) + 1;
    if (next >= IMG_EXTS.length) { img.remove(); return; }
    img.dataset.ext = String(next);
    img.src = IMG_DIR + encodeURIComponent(img.dataset.sid) + IMG_EXTS[next];
  }

  function row(label, val) {
    if (!val) return "";
    return '<div><dt>' + label + '</dt><dd>' + esc(val) + '</dd></div>';
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
}
