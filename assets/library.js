/* Tool library: your tools, requests on them, and active loans. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CATEGORIES = ["Hand tools","Power tools","Digging and soil","Pruning and cutting",
  "Watering","Carts and hauling","Ladders","Harvest and food prep","Seed starting","Other"];

let library = [];
let editingId = null;
let confirmAction = null;

if (AGA.require()) init();

function init() {
  const sel = $("#t-cat");
  CATEGORIES.forEach(c => {
    const o = document.createElement("option");
    o.textContent = c;
    sel.appendChild(o);
  });

  $("#add-tool").addEventListener("click", () => openTool());
  $("#add-first").addEventListener("click", () => openTool());
  $("#save-tool").addEventListener("click", saveTool);
  $("#confirm-go").addEventListener("click", () => { if (confirmAction) confirmAction(); });
  $$("[data-close]").forEach(b => b.addEventListener("click", closeModals));
  $$(".modal-veil").forEach(v => v.addEventListener("click", e => { if (e.target === v) closeModals(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModals(); });

  load();
}

async function load() {
  try {
    const data = await AGA.authed("myLibrary");
    if (!data) return;
    if (!data.ok) throw new Error(data.error || "Couldn't load your library.");
    library = data.tools;
    render();
  } catch (err) {
    console.error(err);
    $("#loading").textContent = AGA.debug ? err.message : "Something went wrong. Try a refresh.";
  }
}

function render() {
  $("#loading").hidden = true;
  const grid = $("#tool-grid");

  if (!library.length) {
    grid.hidden = true;
    $("#empty-lib").hidden = false;
    return;
  }
  $("#empty-lib").hidden = true;
  grid.hidden = false;
  grid.innerHTML = "";

  library.forEach(t => grid.appendChild(toolCard(t)));
}

function toolCard(t) {
  const card = document.createElement("div");
  card.className = "tool-card status-" + t.status.replace(/\s+/g, "-");

  const rating = t.rating.count
    ? '<span class="tc-rating">' + stars(t.rating.average) + " " + t.rating.average +
      " (" + t.rating.count + ")</span>"
    : '<span class="tc-rating none">No reviews yet</span>';

  let head =
    '<div class="tc-head">' +
      '<div><h3>' + esc(t.tool) + "</h3>" +
        '<p class="tc-cat">' + esc(t.category || "Other") + "</p></div>" +
      '<span class="tc-badge badge-' + t.status.replace(/\s+/g, "-") + '">' + statusLabel(t.status) + "</span>" +
    "</div>";

  let body = "";
  if (t.notes) body += '<p class="tc-notes">' + esc(t.notes) + "</p>";
  body += '<div class="tc-meta">' + rating + "</div>";

  // current loan
  if (t.currentLoan) {
    const l = t.currentLoan;
    body +=
      '<div class="tc-loan">' +
        "<p><strong>Out with " + esc(l.borrowerName) + "</strong></p>" +
        (l.start ? "<p>Pickup " + fmtWhen(l.start) + "</p>" : "") +
        (l.due ? "<p>Due back " + fmtWhen(l.due) + "</p>" : "") +
        (l.borrowerAddress ? '<p class="tc-addr">' + esc(l.borrowerAddress) + "</p>" : "") +
        '<button type="button" class="btn btn-teal sm" data-return="' + l.id + '">Mark returned</button>' +
      "</div>";
  }

  // pending requests
  if (t.pendingRequests.length) {
    body += '<div class="tc-requests"><p class="tc-req-label">' +
      t.pendingRequests.length + " " + (t.pendingRequests.length === 1 ? "request" : "requests") + "</p>";
    t.pendingRequests.forEach(l => {
      body +=
        '<div class="tc-req">' +
          "<p><strong>" + esc(l.borrowerName) + "</strong>" +
            (l.due ? " &middot; wants until " + fmtDate(l.due) : "") + "</p>" +
          (l.message ? '<p class="tc-req-msg">' + esc(l.message) + "</p>" : "") +
          '<div class="tc-req-actions">' +
            '<button type="button" class="btn btn-teal sm" data-approve="' + l.id + '">Approve</button>' +
            '<button type="button" class="btn btn-outline sm" data-decline="' + l.id + '">Decline</button>' +
            '<a class="linky sm" href="mailto:' + esc(l.borrowerEmail) + '">Email</a>' +
          "</div>" +
        "</div>";
    });
    body += "</div>";
  }

  // owner controls
  let foot = '<div class="tc-foot">';
  if (t.status !== "on loan") {
    foot += '<button type="button" class="linky" data-edit="' + t.id + '">Edit</button>';
    foot += t.status === "paused"
      ? '<button type="button" class="linky" data-resume="' + t.id + '">Make available</button>'
      : '<button type="button" class="linky" data-pause="' + t.id + '">Pause</button>';
    foot += '<button type="button" class="linky danger" data-delete="' + t.id + '">Remove</button>';
  } else {
    foot += '<span class="tc-locked">Editing paused while it is out</span>';
  }
  foot += "</div>";

  card.innerHTML = head + body + foot;

  $$("[data-approve]", card).forEach(b => b.addEventListener("click", () => decide(b.dataset.approve, true)));
  $$("[data-decline]", card).forEach(b => b.addEventListener("click", () => decide(b.dataset.decline, false)));
  $$("[data-return]", card).forEach(b => b.addEventListener("click", () => confirmReturn(b.dataset.return, t.tool)));
  $$("[data-edit]", card).forEach(b => b.addEventListener("click", () => openTool(t)));
  $$("[data-pause]", card).forEach(b => b.addEventListener("click", () => setStatus(t.id, "paused")));
  $$("[data-resume]", card).forEach(b => b.addEventListener("click", () => setStatus(t.id, "available")));
  $$("[data-delete]", card).forEach(b => b.addEventListener("click", () => confirmDelete(t)));

  return card;
}

/* ---------- add / edit ---------- */

function openTool(t) {
  editingId = t ? t.id : null;
  $("#tool-modal-title").textContent = t ? "Edit tool" : "Add a tool";
  $("#t-name").value = t ? t.tool : "";
  $("#t-cat").value = t && t.category ? t.category : "Hand tools";
  $("#t-notes").value = t ? t.notes : "";
  setError("#tool-error", "");
  $("#tool-modal").hidden = false;
  $("#t-name").focus();
}

async function saveTool() {
  const tool = $("#t-name").value.trim();
  if (!tool) { setError("#tool-error", "Give the tool a name."); return; }

  const btn = $("#save-tool");
  btn.disabled = true;
  try {
    const data = await AGA.authed("saveTool", {
      id: editingId, tool, category: $("#t-cat").value, notes: $("#t-notes").value.trim()
    });
    if (!data.ok) { setError("#tool-error", data.error || "Couldn't save."); return; }
    closeModals();
    await load();
  } catch (err) {
    setError("#tool-error", AGA.debug ? err.message : "Couldn't reach the server.");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- actions ---------- */

async function decide(loanId, approve) {
  const data = await AGA.authed("decideLoan", { loanId, approve });
  if (!data.ok) { alert(data.error || "Couldn't do that."); return; }
  await load();
}

async function setStatus(id, status) {
  const data = await AGA.authed("setToolStatus", { id, status });
  if (!data.ok) { alert(data.error || "Couldn't do that."); return; }
  await load();
}

function confirmReturn(loanId, name) {
  askConfirm("Mark the " + name + " returned?",
    "Do this once it's back in your hands. Both of you can then leave a review.",
    "Yes, it's back", async () => {
      const data = await AGA.authed("markReturned", { loanId });
      if (!data.ok) { alert(data.error || "Couldn't do that."); return; }
      closeModals(); await load();
    });
}

function confirmDelete(t) {
  askConfirm("Remove the " + t.tool + "?",
    "It'll come off your library and the map. Past loans and reviews stay.",
    "Remove it", async () => {
      const data = await AGA.authed("deleteTool", { id: t.id });
      if (!data.ok) { alert(data.error || "Couldn't remove it."); return; }
      closeModals(); await load();
    });
}

function askConfirm(title, body, go, action) {
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  $("#confirm-go").textContent = go;
  confirmAction = action;
  $("#confirm-modal").hidden = false;
}

/* ---------- shared ---------- */

function closeModals() {
  $$(".modal-veil").forEach(v => v.hidden = true);
  confirmAction = null;
  editingId = null;
}

function setError(sel, msg) {
  const el = $(sel);
  el.textContent = msg || "";
  el.hidden = !msg;
}

function statusLabel(s) {
  return s === "on loan" ? "On loan" : s === "paused" ? "Paused" : "Available";
}
function stars(n) {
  const full = Math.round(n);
  return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
}
function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hasTime = d.getHours() || d.getMinutes();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    (hasTime ? " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
