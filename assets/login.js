/* Sign in with an emailed code. Two steps, no passwords. */

const $ = (s, r = document) => r.querySelector(s);

const nextPage = new URLSearchParams(location.search).get("next") || "dashboard.html";
let email = "";

// Already signed in? Skip the whole screen.
if (AGA.session()) location.replace(nextPage);

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Covers the card while the script does its round trip. */
function waiting(on, message) {
  const veil = $("#waiting");
  if (!veil) return;
  if (message) $("#waiting-text").textContent = message;
  veil.hidden = !on;
}

function show(step) {
  ["step-email", "step-code", "step-nomember"].forEach(id => {
    $("#" + id).hidden = id !== step;
  });
}

function setError(el, message) {
  const node = $(el);
  node.textContent = message || "";
  node.hidden = !message;
}

function busy(btn, on, label) {
  btn.disabled = on;
  btn.textContent = on ? label : btn.dataset.label;
}

/* ---------- sign in with Google ----------
   Google hands the browser an ID token. We pass it to the Apps Script, which
   asks Google to vouch for it before trusting anything in it. */

const CLIENT_ID = (window.AGA_CONFIG || {}).GOOGLE_CLIENT_ID || "";

if (CLIENT_ID) waitForGoogle();

function waitForGoogle(tries) {
  tries = tries || 0;
  if (window.google && google.accounts && google.accounts.id) return initGoogle();
  if (tries > 40) return;                 // gave it ten seconds, carry on without it
  setTimeout(() => waitForGoogle(tries + 1), 250);
}

function initGoogle() {
  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: onGoogleCredential,
    cancel_on_tap_outside: true
  });
  google.accounts.id.renderButton($("#google-btn"), {
    theme: "outline",
    size: "large",
    shape: "rectangular",
    text: "continue_with",
    width: 340,
    logo_alignment: "center"
  });
  $("#google-wrap").hidden = false;
  $("#or-line").hidden = false;
}

async function onGoogleCredential(response) {
  setError("#google-error", "");
  waiting(true, "Signing you in...");
  try {
    const data = await AGA.call("googleSignIn", { credential: response.credential });

    if (!data.ok) {
      waiting(false);
      setError("#google-error", data.error || "That did not work. Try the emailed code instead.");
      return;
    }
    if (!data.member) {
      waiting(false);

      // Google vouched for who they are, they are just not a member yet. Keep
      // the credential so the form can finish the job and sign them in.
      try {
        sessionStorage.setItem("aga_pending_google", response.credential);
      } catch (e) { /* private browsing, they will sign in after joining */ }

      const params = new URLSearchParams({ email: data.email || "" });
      if (data.first) params.set("first", data.first);
      if (data.last) params.set("last", data.last);

      $("#nomember-title").textContent = "Almost there";
      $("#nomember-body").innerHTML =
        "You're signed in with Google as <strong>" + escapeHtml(data.email || "") + "</strong>, " +
        "but you're not a member yet. Fill in a few details and you're on the map.";
      $("#join-link").textContent = "Finish joining";
      $("#join-link").href = "membership.html?" + params.toString();
      show("step-nomember");
      return;
    }

    AGA.save({ token: data.token, expires: data.expires, email: data.profile.email, profile: data.profile });
    location.href = nextPage;
  } catch (err) {
    console.error(err);
    waiting(false);
    setError("#google-error", AGA.debug ? err.message : "We couldn't reach the sign-in service. Try again in a moment.");
  }
}

/* ---------- step one ---------- */

$("#send-code").dataset.label = "Email me a code";
$("#send-code").addEventListener("click", sendCode);
$("#email").addEventListener("keydown", e => { if (e.key === "Enter") sendCode(); });

async function sendCode() {
  const value = $("#email").value.trim().toLowerCase();
  setError("#email-error", "");

  if (!value || value.indexOf("@") < 1) {
    setError("#email-error", "Enter the email address you joined with.");
    $("#email").focus();
    return;
  }

  const btn = $("#send-code");
  busy(btn, true, "Sending...");

  try {
    const data = await AGA.call("requestCode", { email: value });

    if (!data.ok) {
      setError("#email-error", data.error || "Something went wrong. Try again in a moment.");
      return;
    }
    if (!data.member) {
      email = value;
      $("#nomember-title").textContent = "We don't have that one";
      $("#nomember-body").innerHTML =
        "No member is signed up with <strong>" + escapeHtml(value) + "</strong>. " +
        "Joining takes about two minutes and it's free.";
      $("#join-link").textContent = "Sign up now";
      $("#join-link").href = "membership.html?email=" + encodeURIComponent(value);
      show("step-nomember");
      return;
    }

    email = value;
    $("#sent-to").textContent = value;
    show("step-code");
    $("#code").focus();
  } catch (err) {
    console.error(err);
    setError("#email-error", AGA.debug ? err.message : "We couldn't reach the sign-in service. Try again in a moment.");
  } finally {
    busy(btn, false);
  }
}

/* ---------- step two ---------- */

$("#verify").dataset.label = "Sign in";
$("#verify").addEventListener("click", verify);
$("#code").addEventListener("keydown", e => { if (e.key === "Enter") verify(); });
$("#code").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  setError("#code-error", "");
  if (e.target.value.length === 6) verify();
});

async function verify() {
  const code = $("#code").value.replace(/\D/g, "");
  if (code.length !== 6) {
    setError("#code-error", "The code is six digits.");
    return;
  }

  const btn = $("#verify");
  busy(btn, true, "Checking...");
  waiting(true, "Signing you in...");

  try {
    const data = await AGA.call("verifyCode", { email: email, code: code });

    if (!data.ok) {
      waiting(false);
      setError("#code-error", data.error || "That code did not work.");
      $("#code").select();
      return;
    }

    AGA.save({ token: data.token, expires: data.expires, email: email, profile: data.profile });
    location.href = nextPage;
  } catch (err) {
    console.error(err);
    waiting(false);
    setError("#code-error", AGA.debug ? err.message : "We couldn't reach the sign-in service. Try again in a moment.");
  } finally {
    busy(btn, false);
  }
}

/* ---------- getting unstuck ---------- */

$("#resend").addEventListener("click", async () => {
  setError("#code-error", "");
  const data = await AGA.call("requestCode", { email: email });
  setError("#code-error", data.throttled
    ? "Give it a minute, the last code was just sent."
    : "");
  if (!data.throttled) {
    const note = $("#code-error");
    note.textContent = "Sent. Check your inbox again.";
    note.className = "note";
    note.hidden = false;
  }
});

$("#back").addEventListener("click", () => {
  $("#code").value = "";
  setError("#code-error", "");
  show("step-email");
  $("#email").focus();
});

$("#try-again").addEventListener("click", () => {
  $("#email").value = "";
  show("step-email");
  $("#email").focus();
});
