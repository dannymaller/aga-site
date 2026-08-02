/* Borrowing and lending lists, plus the reciprocal review flow. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let reviewLoanId = null;
let reviewStars = 0;

if (AGA.require()) init();

function init() {
  $$("[data-close]").forEach(b => b.addEventListener("click", closeReview));
  $("#review-modal").addEventListener("click", e => { if (e.target === $("#review-modal")) closeReview(); });
  $("#review-send").addEventListener("click", sendReview);
  $$("#star-input button").forEach(b => {
    b.addEventListener("click", () => setStars(Number(b.dataset.star)));
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeReview(); });
  load();
}

async function load() {
  try {
    const data = await AGA.authed("myLoans");
    if (!data) return;
    if (!data.ok) throw new Error(data.error || "Couldn't load your loans.");
    render(data.borrowing, data.lending);
  } catch (err) {
    console.error(err);
    $("#loading").textContent = AGA.debug ? err.message : "Something went wrong. Try a refresh.";
  }
}

function render(borrowing, lending) {
  $("#loading").hidden = true;
  $("#loans-wrap").hidden = false;

  fill($("#borrowing"), borrowing, "borrower",
    "Nothing yet. Find a tool on the map and ask to borrow it.");
  fill($("#lending"), lending, "owner",
    "No one has borrowed your tools yet.");
}

function fill(host, loans, youAre, emptyMsg) {
  host.innerHTML = "";
  if (!loans.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = emptyMsg;
    host.appendChild(p);
    return;
  }
  loans
    .sort((a, b) => new Date(b.requested) - new Date(a.requested))
    .forEach(l => host.appendChild(loanRow(l, youAre)));
}

function loanRow(l, youAre) {
  const row = document.createElement("div");
  row.className = "loan-row";

  const other = youAre === "borrower" ? l.ownerName : l.borrowerName;
  const otherEmail = youAre === "borrower" ? l.ownerEmail : l.borrowerEmail;
  const otherId = youAre === "borrower" ? l.ownerId : l.borrowerId;
  const otherLink = otherId
    ? '<a class="profile-link" href="member.html?id=' + esc(otherId) + '">' + esc(other) + "</a>"
    : esc(other);
  const whoLabel = (youAre === "borrower" ? "From " : "To ") + otherLink;

  let when = "Asked " + fmtDate(l.requested);
  if (l.status === "approved") {
    const bits = [];
    if (l.start) bits.push("pickup " + fmtWhen(l.start));
    if (l.due) bits.push("due back " + fmtWhen(l.due));
    if (bits.length) when = bits.join(" \u00b7 ");
  }
  if (l.status === "returned") when = "Returned " + fmtDate(l.returned);

  let left =
    "<div><h3>" + esc(l.toolName) + "</h3>" +
    '<p class="who">' + whoLabel + "</p>" +
    '<p class="when">' + when + "</p>";

  // borrower sees address once approved (owner manages returns in the library)
  if (youAre === "borrower" && l.borrowerAddress && false) { /* borrower already knows own address */ }
  left += "</div>";

  const right =
    '<span class="loan-status ls-' + l.status + '">' + statusLabel(l.status) + "</span>";

  row.innerHTML = left + right;

  // review area
  if (l.status === "returned") {
    const rev = document.createElement("div");
    rev.className = "loan-review";
    if (l.myReviewLeft) {
      rev.innerHTML = '<p class="muted">You left a review. Thanks.</p>';
    } else if (l.canReview) {
      const subject = youAre === "borrower" ? l.ownerName : l.borrowerName;
      const btn = document.createElement("button");
      btn.className = "btn btn-teal sm";
      btn.textContent = "Review " + subject;
      btn.addEventListener("click", () => openReview(l.id, subject));
      rev.appendChild(btn);
    } else {
      rev.innerHTML = '<p class="muted">The 7 day review window has closed.</p>';
    }
    row.appendChild(rev);
  }

  // borrower can cancel a pending request
  if (youAre === "borrower" && l.status === "pending") {
    const rev = document.createElement("div");
    rev.className = "loan-review";
    const btn = document.createElement("button");
    btn.className = "linky danger";
    btn.textContent = "Cancel request";
    btn.addEventListener("click", async () => {
      const data = await AGA.authed("cancelLoan", { loanId: l.id });
      if (!data.ok) { alert(data.error || "Couldn't cancel."); return; }
      load();
    });
    rev.appendChild(btn);
    row.appendChild(rev);
  }

  return row;
}

/* ---------- reviews ---------- */

function openReview(loanId, subject) {
  reviewLoanId = loanId;
  reviewStars = 0;
  paintStars();
  $("#review-sub").textContent = "How was your experience with " + subject + "?";
  $("#review-comment").value = "";
  $("#review-error").hidden = true;
  $("#review-modal").hidden = false;
}

function setStars(n) {
  reviewStars = n;
  paintStars();
}

function paintStars() {
  $$("#star-input button").forEach(b => {
    const on = Number(b.dataset.star) <= reviewStars;
    b.textContent = on ? "\u2605" : "\u2606";
    b.classList.toggle("on", on);
  });
}

async function sendReview() {
  if (!reviewStars) {
    const e = $("#review-error");
    e.textContent = "Pick a star rating first.";
    e.hidden = false;
    return;
  }
  const btn = $("#review-send");
  btn.disabled = true;
  try {
    const data = await AGA.authed("leaveReview", {
      loanId: reviewLoanId,
      rating: reviewStars,
      comment: $("#review-comment").value.trim()
    });
    if (!data) return;
    if (!data.ok) {
      const e = $("#review-error");
      e.textContent = data.error || "Couldn't post that.";
      e.hidden = false;
      return;
    }
    closeReview();
    load();
  } catch (err) {
    const e = $("#review-error");
    e.textContent = AGA.debug ? err.message : "Couldn't reach the server.";
    e.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function closeReview() {
  $("#review-modal").hidden = true;
  reviewLoanId = null;
}

/* ---------- shared ---------- */

function statusLabel(s) {
  return { pending: "Pending", approved: "Out now", returned: "Returned",
    declined: "Declined", cancelled: "Cancelled" }[s] || s;
}
function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hasTime = d.getHours() || d.getMinutes();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    (hasTime ? " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
