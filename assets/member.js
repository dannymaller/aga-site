/* A member's public profile: who they are, what they lend, what neighbors say. */

const $ = (s, r = document) => r.querySelector(s);

const memberId = new URLSearchParams(location.search).get("id");

if (AGA.require()) {
  if (!memberId) {
    location.replace("map.html");
  } else {
    load();
  }
}

async function load() {
  try {
    const data = await AGA.authed("memberProfile", { memberId });
    if (!data) return;
    if (!data.ok) {
      $("#loading").textContent = data.error || "Couldn't find that member.";
      return;
    }
    paint(data.profile);
  } catch (err) {
    console.error(err);
    $("#loading").textContent = AGA.debug ? err.message : "Something went wrong. Try a refresh.";
  }
}

function paint(p) {
  document.title = p.name + " | Avondale Gardening Alliance";
  $("#loading").hidden = true;
  $("#profile-wrap").hidden = false;

  $("#m-name").textContent = p.name;

  const bits = [];
  if (p.joined) bits.push("Member since " + new Date(p.joined).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  if (p.completedLoans) bits.push(p.completedLoans + (p.completedLoans === 1 ? " completed loan" : " completed loans"));
  $("#m-sub").textContent = bits.join(" \u00b7 ") || "Neighborhood member";

  if (p.email && !p.isMe) {
    const btn = $("#m-email");
    btn.hidden = false;
    btn.href = "mailto:" + encodeURIComponent(p.email) +
      "?subject=" + encodeURIComponent("Hello from the AGA member map");
  }

  // about
  if (p.interests.length || p.about) {
    $("#about-section").hidden = false;
    const chips = $("#m-interests");
    chips.innerHTML = "";
    p.interests.forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      chips.appendChild(li);
    });
    $("#m-about").textContent = p.about || "";
  }

  // tools
  const lendable = p.tools.filter(t => t.status !== "paused");
  if (lendable.length) {
    $("#tools-section").hidden = false;
    $("#m-toolnotes").textContent = p.toolNotes ? "Pickup: " + p.toolNotes : "";
    const grid = $("#m-tools");
    grid.innerHTML = "";
    lendable.forEach(t => {
      const card = document.createElement("div");
      card.className = "tool-card";
      card.innerHTML =
        '<div class="tc-head"><div><h3>' + esc(t.tool) + "</h3>" +
          '<p class="tc-cat">' + esc(t.category || "Other") + "</p></div>" +
          '<span class="tc-badge badge-' + t.status.replace(/\s+/g, "-") + '">' +
            (t.status === "on loan" ? "On loan" : "Available") + "</span></div>" +
        (t.notes ? '<p class="tc-notes">' + esc(t.notes) + "</p>" : "") +
        '<div class="tc-meta">' + (t.rating.count
          ? '<span class="tc-rating">' + stars(t.rating.average) + " " + t.rating.average + " (" + t.rating.count + ")</span>"
          : '<span class="tc-rating none">No reviews yet</span>') + "</div>" +
        (p.isMe ? "" : (t.status === "available"
          ? '<button type="button" class="btn btn-teal sm" style="margin-top:12px" data-ask="' + esc(t.id) +
            '" data-toolname="' + esc(t.tool) + '" data-owner="' + esc(p.name) + '">Ask to borrow</button>'
          : ""));
      grid.appendChild(card);
    });
  }

  // reviews
  const total = p.asOwner.count + p.asBorrower.count;
  if (!total) {
    $("#m-no-reviews").hidden = false;
    $("#m-review-summary").textContent = "";
  } else {
    const parts = [];
    if (p.asOwner.count) parts.push(stars(p.asOwner.average) + " " + p.asOwner.average + " as a lender (" + p.asOwner.count + ")");
    if (p.asBorrower.count) parts.push(stars(p.asBorrower.average) + " " + p.asBorrower.average + " as a borrower (" + p.asBorrower.count + ")");
    $("#m-review-summary").textContent = parts.join("   \u00b7   ");

    fillReviews("#m-owner-reviews-wrap", "#m-owner-reviews", p.asOwner.reviews);
    fillReviews("#m-borrower-reviews-wrap", "#m-borrower-reviews", p.asBorrower.reviews);
  }
}

function fillReviews(wrapSel, hostSel, reviews) {
  if (!reviews.length) return;
  $(wrapSel).hidden = false;
  const host = $(hostSel);
  host.innerHTML = "";
  reviews.forEach(r => {
    const row = document.createElement("div");
    row.className = "review-row";
    row.innerHTML =
      '<p class="rr-head">' + stars(r.rating) + " <strong>" + esc(r.reviewerName) + "</strong>" +
        '<span class="rr-date">' + fmtDate(r.created) + "</span></p>" +
      (r.comment ? '<p class="rr-comment">' + esc(r.comment) + "</p>" : "");
    host.appendChild(row);
  });
}

/* borrow straight from the profile, reusing the map's modal machinery is not
   loaded here, so route through the map with the popup target instead */
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-ask]");
  if (!btn) return;
  // simplest reliable path: send them to the map with a borrow intent
  location.href = "map.html?borrow=" + encodeURIComponent(btn.dataset.ask) +
    "&tool=" + encodeURIComponent(btn.dataset.toolname) +
    "&owner=" + encodeURIComponent(btn.dataset.owner);
});

function stars(n) {
  const full = Math.round(n);
  return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
