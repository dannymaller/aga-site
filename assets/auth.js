/* Session handling, shared by every signed-in page.
   Load this before any page script that needs a member. */

(function () {
  const KEY = "aga_session";
  const CFG = window.AGA_CONFIG || {};
  const URL_ = CFG.APPS_SCRIPT_URL || "";

  const AGA = {
    debug: new URLSearchParams(location.search).has("debug"),

    /** The stored session, or null if there isn't one or it has lapsed. */
    session() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s.token) return null;
        if (s.expires && new Date(s.expires) < new Date()) {
          localStorage.removeItem(KEY);
          return null;
        }
        return s;
      } catch (e) {
        return null;
      }
    },

    token() {
      const s = this.session();
      return s ? s.token : "";
    },

    save(session) {
      localStorage.setItem(KEY, JSON.stringify(session));
    },

    forget() {
      localStorage.removeItem(KEY);
    },

    /**
     * Calls the Apps Script. text/plain keeps it a simple request so the
     * browser never sends a preflight, which Apps Script cannot answer.
     */
    async call(action, payload) {
      if (!URL_.startsWith("http")) throw new Error("APPS_SCRIPT_URL is not set in assets/config.js");

      const body = Object.assign({ action: action }, payload || {});
      const res = await fetch(URL_, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      });

      const raw = await res.text();
      if (AGA.debug) console.log(action, "->", raw.slice(0, 300));

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Error("The script returned a page instead of data. Check that the deployment is open to Anyone.");
      }
      return data;
    },

    /** Same, with the session token attached. Bounces to login if it lapsed. */
    async authed(action, payload) {
      const token = this.token();
      if (!token) return this.toLogin();

      const data = await this.call(action, Object.assign({ token: token }, payload || {}));
      if (!data.ok && data.error === "signed out") {
        this.forget();
        return this.toLogin();
      }
      return data;
    },

    toLogin() {
      const back = location.pathname.split("/").pop() || "dashboard.html";
      location.href = "login.html?next=" + encodeURIComponent(back);
      return new Promise(() => {}); // stop the caller while the page changes
    },

    /** Call at the top of a members-only page. */
    require() {
      if (!this.session()) {
        this.toLogin();
        return false;
      }
      return true;
    },

    async signOut() {
      const token = this.token();
      this.forget();
      try {
        if (token) await this.call("signOut", { token: token });
      } catch (e) {
        /* the local session is already gone, that is what matters */
      }
      location.href = "index.html";
    }
  };

  window.AGA = AGA;

  /**
   * One Membership tab for everybody. The markup points it at the login card,
   * which is what a signed-out visitor should see. When a session is found it
   * gets repointed at the dashboard, so members skip the login screen. If the
   * browser has forgotten the session, they land back on the card and sign in
   * again.
   */
  function pointAccountLinks() {
    if (!AGA.session()) return;
    document.querySelectorAll("[data-account-link]").forEach(function (a) {
      a.href = "dashboard.html";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pointAccountLinks);
  } else {
    pointAccountLinks();
  }
})();
