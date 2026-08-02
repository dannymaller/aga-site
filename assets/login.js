/* Sign in with an emailed code. Two steps, no passwords. */

const $ = (s, r = document) => r.querySelector(s);

const nextPage = new URLSearchParams(location.search).get("next") || "dashboard.html";
let email = "";

// Already signed in? Skip the whole screen.
if (AGA.session()) location.replace(nextPage);

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
      $("#unknown-email").textContent = value;
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

  try {
    const data = await AGA.call("verifyCode", { email: email, code: code });

    if (!data.ok) {
      setError("#code-error", data.error || "That code did not work.");
      $("#code").select();
      return;
    }

    AGA.save({ token: data.token, expires: data.expires, email: email });
    location.href = nextPage;
  } catch (err) {
    console.error(err);
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
