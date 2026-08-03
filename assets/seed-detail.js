/* Seed detail: full growing info, neighbors who have it, reviews. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const DEBUG = new URLSearchParams(location.search).has("debug");

const TILE = {
  "Food crops": "tile-food",
  "Herbs": "tile-herb",
  "Flowers": "tile-flower",
  "Shrubs": "tile-shrub",
};
const HAS_PHOTO = new Set([
  "cat_cherry_tomato","cat_bush_bean","cat_lettuce","cat_kale","cat_cucumber",
  "cat_zucchini","cat_pepper","cat_carrot","cat_pea","cat_basil","cat_cilantro","cat_dill",
  "cat_chives","cat_parsley","cat_marigold","cat_sunflower","cat_zinnia",
  "cat_nasturtium","cat_cosmos","cat_blackeyed_susan","cat_coneflower","cat_milkweed",
    "cat_elderberry","cat_serviceberry","cat_ninebark"
]);

if (AGA.require()) {
  const catalogId = new URLSearchParams(location.search).get("id");
  let seed = null;
  let reviewStars = 0;
  let reviewGiverId = null;

  if (!catalogId) {
    $("#loading").textContent = "No seed chosen.";
  } else {
    load();
  }

  async function load() {
    try {
      const data = await AGA.authed("seedDetail", { catalogId });
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : "Could not load this seed.");
      seed = data.seed;
      paint();
    } catch (e) {
      $("#loading").textContent = DEBUG ? e.message : "This seed isn't loading. Try again in a moment.";
    }
  }

  function paint() {
    document.title = seed.name + " | Avondale Gardening Alliance";
    $("#loading").hidden = true;
    $("#detail").hidden = false;

    const tile = $("#detail-tile");
    if (HAS_PHOTO.has(seed.id)) {
      tile.className = "detail-tile has-photo";
      tile.style.backgroundImage = "url(assets/seeds/" + seed.id.replace("cat_", "") + ".jpg)";
    } else {
      tile.className = "detail-tile " + (TILE[seed.category] || "tile-food");
    }
    $("#detail-tile-name").textContent = seed.name;
    $("#detail-cat").textContent = seed.category;
    $("#detail-name").textContent = seed.name;
    $("#detail-blurb").textContent = seed.blurb;

    if (seed.rating.count) {
      const s = $("#detail-stars");
      s.hidden = false;
      s.innerHTML = stars(seed.rating.average) +
        ' <span class="rating-count">' + seed.rating.average + " from " +
        seed.rating.count + (seed.rating.count === 1 ? " review" : " reviews") + "</span>";
    }

    // growing info
    const grid = $("#grow-grid");
    grid.innerHTML = "";
    [
      ["When to plant", seed.plantWhen],
      ["Sun", seed.sun],
      ["Soil", seed.soil],
      ["Water", seed.water],
      ["Ready in", seed.daysToMaturity],
      ["Spacing", seed.spacing],
      ["Plant it near", seed.pairsWith],
    ].forEach(([k, v]) => {
      if (!v) return;
      const d = document.createElement("div");
      d.innerHTML = "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>";
      grid.appendChild(d);
    });

    paintGivers();
    paintReviews();
    wireReviewModal();
  }

  function paintGivers() {
    const list = $("#giver-list");
    const none = $("#givers-none");
    list.innerHTML = "";
    const givers = seed.givers || [];

    $("#givers-title").textContent = givers.length
      ? (givers.length === 1 ? "1 neighbor is sharing this seed" : givers.length + " neighbors are sharing this seed")
      : "Neighbors sharing this seed";

    if (!givers.length) {
      none.hidden = false;
      $("#jump-givers").textContent = "No one has it yet";
      return;
    }
    none.hidden = true;

    givers.forEach(g => {
      const li = document.createElement("li");
      li.className = "giver-card";

      const qty = g.quantity + " " + (g.form === "pouch"
        ? (g.quantity === 1 ? "pouch" : "pouches")
        : (g.quantity === 1 ? "seed" : "seeds"));

      const actions = g.isMe
        ? '<span class="giver-you">This is you</span>'
        : '<a class="btn btn-outline" href="mailto:' + esc(g.email) +
            '?subject=' + encodeURIComponent("AGA seeds: " + seed.name) +
            '&body=' + encodeURIComponent("Hi " + g.name + ", I saw on the AGA seed library that you have " + seed.name + " seeds to share. Could I get some? Thanks!") +
          '">Email them</a>' +
          '<button type="button" class="btn btn-teal review-btn" data-giver="' + esc(g.id) + '">Leave a review</button>';

      li.innerHTML =
        '<div class="giver-main">' +
          '<a class="giver-name" href="member.html?id=' + esc(g.id) + '">' + esc(g.name) + '</a>' +
          '<span class="giver-qty">' + esc(qty) + ' available</span>' +
          (g.notes ? '<p class="giver-notes">' + esc(g.notes) + '</p>' : '') +
        '</div>' +
        '<div class="giver-actions">' + actions + '</div>';
      list.appendChild(li);
    });
  }

  function paintReviews() {
    const wrap = $("#seed-reviews");
    const list = $("#review-list");
    const revs = seed.reviews || [];
    if (!revs.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    list.innerHTML = "";
    revs.forEach(r => {
      const li = document.createElement("li");
      li.className = "review-item";
      li.innerHTML =
        '<div class="review-top">' +
          '<span class="review-stars">' + stars(r.rating) + '</span>' +
          '<span class="review-name">' + esc(r.reviewerName) + '</span>' +
        '</div>' +
        (r.comment ? '<p class="review-comment">' + esc(r.comment) + '</p>' : '');
      list.appendChild(li);
    });
  }

  function wireReviewModal() {
    $$(".review-btn").forEach(b => b.addEventListener("click", () => openReview(b.dataset.giver)));
    $$(".star-picker button").forEach(b => b.addEventListener("click", () => setStars(+b.dataset.star)));
    $$("[data-close-review]").forEach(b => b.addEventListener("click", closeReview));
    $("#review-modal").addEventListener("click", e => { if (e.target.id === "review-modal") closeReview(); });
    $("#submit-review").addEventListener("click", submitReview);
  }

  function openReview(giverId) {
    reviewGiverId = giverId;
    reviewStars = 0;
    setStars(0);
    $("#review-comment").value = "";
    setReviewError("");
    $("#review-modal").hidden = false;
  }
  function closeReview() { $("#review-modal").hidden = true; }

  function setStars(n) {
    reviewStars = n;
    $$(".star-picker button").forEach(b => b.classList.toggle("lit", +b.dataset.star <= n));
    $("#submit-review").disabled = n < 1;
  }

  async function submitReview() {
    if (reviewStars < 1) return;
    $("#submit-review").disabled = true;
    try {
      const data = await AGA.authed("reviewSeedGiver", {
        giverId: reviewGiverId, catalogId, rating: reviewStars,
        comment: $("#review-comment").value.trim(),
      });
      if (!data || !data.ok) {
        setReviewError(data && data.error ? data.error : "Couldn't post that.");
        $("#submit-review").disabled = false;
        return;
      }
      closeReview();
      load(); // refresh to show the new review + rating
    } catch (e) {
      setReviewError(DEBUG ? e.message : "Couldn't reach the server.");
      $("#submit-review").disabled = false;
    }
  }

  function setReviewError(msg) {
    const el = $("#review-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function stars(avg) {
    const n = Math.round(avg);
    return '<span class="stars">' + "\u2605".repeat(n) +
      '<span class="star-off">' + "\u2605".repeat(5 - n) + "</span></span>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
}
