/* Member dashboard. Everything here needs a session. */

const $ = (s, r = document) => r.querySelector(s);

if (AGA.require()) load();

$("#sign-out").addEventListener("click", () => AGA.signOut());

async function load() {
  try {
    const data = await AGA.authed("me");
    if (!data || !data.ok || !data.profile) {
      $("#greeting").textContent = "We couldn't find your record";
      $("#pin-status").textContent = "Try signing in again, or email us and we'll sort it out.";
      return;
    }
    paint(data.profile);
  } catch (err) {
    console.error(err);
    $("#greeting").textContent = "Something went wrong";
    $("#pin-status").textContent = AGA.debug ? err.message : "Try a refresh in a moment.";
  }
}

function paint(p) {
  const name = [p.first, p.last].filter(Boolean).join(" ");

  $("#greeting").textContent = "Hello, " + (p.first || "neighbor");
  $("#joined").textContent = p.joined
    ? new Date(p.joined).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "a while back";

  $("#pin-status").textContent = p.onMap
    ? "You're on the map, right where you should be."
    : "You're not on the map yet. That usually means we couldn't place your address, so drop us a line and we'll fix it.";
  $("#pin-status").className = "lede " + (p.onMap ? "good" : "warn");

  $("#d-name").textContent = name || "Not set";
  $("#d-address").textContent = [
    [p.street, p.unit].filter(Boolean).join(" "),
    [p.city, p.state].filter(Boolean).join(", "),
    p.zip
  ].filter(Boolean).join("  ") || "Not set";
  $("#d-email").textContent = p.email || "Not set";
  $("#d-phone").textContent = p.phone || "Not given";

  const chips = $("#interests");
  chips.innerHTML = "";
  if (p.interests.length) {
    p.interests.forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      chips.appendChild(li);
    });
  } else {
    chips.innerHTML = '<li class="muted">Nothing picked yet</li>';
  }

  $("#about").textContent = p.about || "";

  const tools = $("#tools");
  tools.innerHTML = "";
  if (p.toolSharing && p.tools.length) {
    const ul = document.createElement("ul");
    ul.className = "tool-list";
    p.tools.forEach(t => {
      const li = document.createElement("li");
      li.innerHTML = "<strong>" + esc(t.tool) + "</strong>" +
        (t.category ? '<span class="cat">' + esc(t.category) + "</span>" : "") +
        (t.notes ? '<span class="tnote">' + esc(t.notes) + "</span>" : "");
      ul.appendChild(li);
    });
    tools.appendChild(ul);
    if (p.toolNotes) {
      const note = document.createElement("p");
      note.className = "fineprint";
      note.textContent = "Pickup: " + p.toolNotes;
      tools.appendChild(note);
    }
  } else {
    tools.innerHTML = '<p class="muted">You\'re not lending anything out right now. ' +
      'Add tools from <a href="membership.html">your details</a> and neighbors can ask to borrow them.</p>';
  }
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
