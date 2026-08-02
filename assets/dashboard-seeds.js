/* "My seeds" on the dashboard: list what you're sharing, add more, log
   giveaways (which tick the count down and auto-delist at zero), remove. */

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const DEBUG = new URLSearchParams(location.search).has("debug");

  if (!window.AGA || !AGA.session()) return;

  let catalog = [];   // for the add dropdown
  let mine = [];      // my seed rows
  let giveRow = null; // the row being given from

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (!$("#my-seeds")) return;
    wire();
    await Promise.all([loadCatalog(), loadMine()]);
  }

  async function loadCatalog() {
    try {
      const data = await AGA.authed("seedCatalog");
      if (data && data.ok) {
        catalog = data.seeds || [];
        const sel = $("#s-catalog");
        sel.innerHTML = "";
        // group by category for a tidy dropdown
        const cats = {};
        catalog.forEach(s => { (cats[s.category] = cats[s.category] || []).push(s); });
        Object.keys(cats).forEach(c => {
          const g = document.createElement("optgroup");
          g.label = c;
          cats[c].forEach(s => {
            const o = document.createElement("option");
            o.value = s.id; o.textContent = s.name;
            g.appendChild(o);
          });
          sel.appendChild(g);
        });
      }
    } catch (e) { if (DEBUG) console.warn(e); }
  }

  async function loadMine() {
    const box = $("#my-seeds");
    try {
      const data = await AGA.authed("mySeeds");
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : "load failed");
      mine = data.seeds || [];
      paint();
    } catch (e) {
      box.innerHTML = '<p class="muted">' + (DEBUG ? e.message : "Couldn't load your seeds.") + "</p>";
    }
  }

  function paint() {
    const box = $("#my-seeds");
    box.innerHTML = "";
    const live = mine.filter(s => s.quantity > 0);

    if (!live.length) {
      box.innerHTML = '<p class="muted">You\u2019re not sharing any seeds yet.</p>';
      return;
    }
    const list = document.createElement("ul");
    list.className = "my-seed-list";
    live.forEach(s => {
      const qty = s.quantity + " " + (s.form === "pouch"
        ? (s.quantity === 1 ? "pouch" : "pouches")
        : (s.quantity === 1 ? "seed" : "seeds"));
      const li = document.createElement("li");
      li.innerHTML =
        '<div class="ms-main">' +
          '<span class="ms-name">' + esc(s.name) + '</span>' +
          '<span class="ms-qty">' + esc(qty) + '</span>' +
        '</div>' +
        '<div class="ms-actions">' +
          '<button type="button" class="link-btn" data-give="' + s.id + '">Log a giveaway</button>' +
          '<button type="button" class="link-btn link-danger" data-remove="' + s.id + '">Remove</button>' +
        '</div>';
      list.appendChild(li);
    });
    box.appendChild(list);

    $$("[data-give]", box).forEach(b => b.addEventListener("click", () => openGive(b.dataset.give)));
    $$("[data-remove]", box).forEach(b => b.addEventListener("click", () => removeSeed(b.dataset.remove)));
  }

  function wire() {
    $("#add-seed").addEventListener("click", openAdd);
    $("#save-seed").addEventListener("click", saveSeed);
    $$("[data-close-seed]").forEach(b => b.addEventListener("click", () => $("#seed-modal").hidden = true));
    $("#seed-modal").addEventListener("click", e => { if (e.target.id === "seed-modal") $("#seed-modal").hidden = true; });

    $("#confirm-give").addEventListener("click", confirmGive);
    $$("[data-close-give]").forEach(b => b.addEventListener("click", () => $("#give-modal").hidden = true));
    $("#give-modal").addEventListener("click", e => { if (e.target.id === "give-modal") $("#give-modal").hidden = true; });
  }

  function openAdd() {
    $("#seed-modal-title").textContent = "Add seeds to share";
    $("#s-qty").value = 20;
    $("#s-form").value = "seeds";
    $("#s-notes").value = "";
    setErr("#seed-error", "");
    $("#seed-modal").hidden = false;
  }

  async function saveSeed() {
    const catalogId = $("#s-catalog").value;
    const quantity = parseInt($("#s-qty").value, 10);
    if (!catalogId) { setErr("#seed-error", "Pick a seed."); return; }
    if (!(quantity >= 1)) { setErr("#seed-error", "Enter how many you have."); return; }
    $("#save-seed").disabled = true;
    try {
      const data = await AGA.authed("saveSeed", {
        catalogId, quantity, form: $("#s-form").value, notes: $("#s-notes").value.trim(),
      });
      if (!data || !data.ok) { setErr("#seed-error", data && data.error ? data.error : "Couldn't save."); $("#save-seed").disabled = false; return; }
      $("#seed-modal").hidden = true;
      $("#save-seed").disabled = false;
      await loadMine();
    } catch (e) {
      setErr("#seed-error", DEBUG ? e.message : "Couldn't reach the server.");
      $("#save-seed").disabled = false;
    }
  }

  function openGive(rowId) {
    giveRow = mine.find(s => s.id === rowId);
    if (!giveRow) return;
    const unit = giveRow.form === "pouch" ? "pouches" : "seeds";
    $("#give-body").textContent = "How many " + unit + " of " + giveRow.name + " did you hand over?";
    $("#give-count").value = 1;
    $("#give-count").max = giveRow.quantity;
    $("#give-hint").textContent = "You have " + giveRow.quantity + " " + unit + " listed. Reaching zero removes the listing.";
    setErr("#give-error", "");
    $("#give-modal").hidden = false;
  }

  async function confirmGive() {
    if (!giveRow) return;
    const given = parseInt($("#give-count").value, 10);
    if (!(given >= 1)) { setErr("#give-error", "Enter at least 1."); return; }
    $("#confirm-give").disabled = true;
    try {
      const data = await AGA.authed("giveSeeds", { memberSeedId: giveRow.id, given });
      if (!data || !data.ok) { setErr("#give-error", data && data.error ? data.error : "Couldn't log that."); $("#confirm-give").disabled = false; return; }
      $("#give-modal").hidden = true;
      $("#confirm-give").disabled = false;
      await loadMine();
    } catch (e) {
      setErr("#give-error", DEBUG ? e.message : "Couldn't reach the server.");
      $("#confirm-give").disabled = false;
    }
  }

  async function removeSeed(rowId) {
    const row = mine.find(s => s.id === rowId);
    if (!row) return;
    if (!confirm("Remove your " + row.name + " listing? Neighbors will no longer see you have it.")) return;
    try {
      const data = await AGA.authed("removeSeed", { id: rowId });
      if (data && data.ok) await loadMine();
    } catch (e) { if (DEBUG) console.warn(e); }
  }

  function setErr(sel, msg) {
    const el = $(sel);
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
