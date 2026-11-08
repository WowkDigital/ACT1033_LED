// Admin page: password login against the Worker, then list / create / rotate / delete panels. All state lives in the Worker.
const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "act1033-admin"; // non-secret (Worker URL) in localStorage
const SESSION_KEY = "act1033-admin-session"; // short-lived session token, sessionStorage only (gone when the tab closes)

let session = null;

function base() {
  const u = $("worker").value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) throw new Error("Enter the Worker URL (https://…)");
  return u;
}

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

class ApiError extends Error {
  constructor(status, message) {
    super(`${status}: ${message}`);
    this.status = status;
  }
}

async function api(method, path, body, auth = true) {
  const headers = {};
  if (auth) headers.Authorization = "Bearer " + session;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(base() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no JSON body */
  }
  if (!res.ok) {
    if (auth && res.status === 401) signedOut("Session expired – sign in again.");
    throw new ApiError(res.status, data?.error || res.statusText);
  }
  return data;
}

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
}

const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : "never");

function show(which) {
  $("sec-setup").hidden = which !== "setup";
  $("sec-login").hidden = which !== "login";
  $("dash").hidden = which !== "dash";
}

function signedOut(msg = "") {
  session = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  hideTokens();
  show("login");
  setStatus($("login-status"), msg, msg ? "err" : "");
}

function signedIn(out) {
  session = out.session;
  try {
    sessionStorage.setItem(SESSION_KEY, session);
  } catch {
    /* ignore */
  }
  for (const id of ["s-token", "s-pass", "s-pass2", "l-pass", "p-old", "p-new"]) $(id).value = "";
  show("dash");
  return refresh();
}

// ---------------------------------------------------------------- tokens box
function hideTokens() {
  $("tok-list").replaceChildren();
  $("tok-box").hidden = true;
}

function tokenField(label, value) {
  return el("label", {}, label, el("input", { value, readOnly: true, onfocus: (e) => e.target.select() }));
}

function showTokens(title, items) {
  $("tok-title").textContent = title;
  $("tok-list").replaceChildren(
    ...items.map((o) => {
      const box = el("div", { className: "panel-item" }, tokenField("Panel ID", o.id));
      if (o.write_token) box.append(tokenField("Write token", o.write_token));
      if (o.read_token) box.append(tokenField("Read token", o.read_token));
      box.dataset.text = [`panel_id: ${o.id}`, o.write_token && `write_token: ${o.write_token}`, o.read_token && `read_token: ${o.read_token}`].filter(Boolean).join("\n");
      return box;
    }),
  );
  setStatus($("copy-status"), "");
  $("tok-box").hidden = false;
  $("tok-box").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------------------------------------------------------------- panels
async function refresh() {
  setStatus($("list-status"), "Loading…");
  const { panels } = await api("GET", "/admin/panels");
  setStatus($("list-status"), panels.length ? `${panels.length} panel(s)` : "No panels yet – create one above.");
  $("panels").replaceChildren(
    ...panels.map((p) => {
      const msg = el("p", { className: "status" });
      const act = async (fn) => {
        try {
          await fn();
        } catch (e) {
          setStatus(msg, e.message, "err");
        }
      };
      const rotate = (which, label) =>
        el("button", {
          type: "button",
          className: "secondary",
          textContent: label,
          onclick: () =>
            act(async () => {
              if (!confirm(`Rotate the ${which} token of "${p.id}"? The old one stops working immediately.`)) return;
              const out = await api("POST", `/admin/panels/${encodeURIComponent(p.id)}/rotate`, { which });
              showTokens(`New ${which} token(s) for "${p.id}"`, [out]);
            }),
        });
      return el(
        "div",
        { className: "panel-item" },
        el("div", {}, el("b", { textContent: p.id }), " ", el("span", { className: "hint", textContent: p.name !== p.id ? p.name : "" })),
        el("p", { className: "hint", textContent: `${p.has_image ? p.size + " B" : "no image"} · updated ${fmt(p.updated_at)} · created ${fmt(p.created_at)}${p.mpk_enabled ? " · departures on" : ""}` }),
        el(
          "div",
          { className: "row actions" },
          el("span", {}, rotate("write", "Rotate write"), " ", rotate("read", "Rotate read"), " ", rotate("both", "Rotate both")),
          el("button", {
            type: "button",
            className: "danger",
            textContent: "Delete",
            onclick: () =>
              act(async () => {
                if (prompt(`Delete panel "${p.id}" and its image? Type the ID to confirm.`) !== p.id) return;
                await api("DELETE", `/admin/panels/${encodeURIComponent(p.id)}`);
                await refresh();
              }),
          }),
        ),
        msg,
      );
    }),
  );
}

// ---------------------------------------------------------------- connect / login / setup
async function connect() {
  const st = $("conn-status");
  try {
    base();
    setStatus(st, "Connecting…");
    const status = await api("GET", "/admin/status", null, false);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ worker: $("worker").value.trim() }));
    } catch {
      /* ignore */
    }
    if (!status.configured) {
      setStatus(st, status.setup_available ? "Worker reached. Set the admin password." : "Worker reached, but it has no SETUP_TOKEN secret.", status.setup_available ? "ok" : "err");
      show(status.setup_available ? "setup" : null);
      return;
    }
    setStatus(st, "Worker reached.", "ok");
    let saved = null;
    try {
      saved = sessionStorage.getItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    if (saved) {
      session = saved;
      try {
        await signedIn({ session: saved });
        return;
      } catch {
        /* signedOut() already switched to the login form */
      }
    }
    show("login");
    $("l-pass").focus();
  } catch (e) {
    show(null);
    setStatus(st, e.message, "err");
  }
}

$("connect").onclick = connect;

$("setup").onclick = async () => {
  const st = $("setup-status");
  try {
    if ($("s-pass").value !== $("s-pass2").value) throw new Error("The passwords differ");
    setStatus(st, "Saving…");
    await signedIn(await api("POST", "/admin/setup", { password: $("s-pass").value, setup_token: $("s-token").value.trim() }, false));
  } catch (e) {
    setStatus(st, e.message, "err");
  }
};

async function doLogin() {
  const st = $("login-status");
  try {
    setStatus(st, "Signing in…");
    await signedIn(await api("POST", "/admin/login", { password: $("l-pass").value }, false));
  } catch (e) {
    setStatus(st, e.message, "err");
  }
}
$("login").onclick = doLogin;
$("l-pass").onkeydown = (e) => e.key === "Enter" && doLogin();

// ---------------------------------------------------------------- dashboard actions
$("create").onclick = async () => {
  const st = $("create-status");
  try {
    const body = {};
    const id = $("n-id").value.trim().toLowerCase();
    const name = $("n-name").value.trim();
    if (id) body.id = id;
    if (name) body.name = name;
    setStatus(st, "Creating…");
    const out = await api("POST", "/admin/panels", body);
    setStatus(st, `Panel "${out.id}" created.`, "ok");
    $("n-id").value = "";
    $("n-name").value = "";
    showTokens(`Tokens for new panel "${out.id}"`, [out]);
    await refresh();
  } catch (e) {
    setStatus(st, e.message, "err");
  }
};

$("tok-close").onclick = hideTokens;

$("copy-all").onclick = async () => {
  const text = [...document.querySelectorAll("#tok-list .panel-item")].map((d) => d.dataset.text).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    setStatus($("copy-status"), "Copied to the clipboard.", "ok");
  } catch {
    setStatus($("copy-status"), "Clipboard unavailable – select the fields and copy manually.", "err");
  }
};

$("logout").onclick = () => signedOut();

$("logout-all").onclick = async () => {
  try {
    await api("POST", "/admin/logout-all", {});
    signedOut("Signed out everywhere.");
  } catch (e) {
    setStatus($("acct-status"), e.message, "err");
  }
};

$("change-pass").onclick = async () => {
  const st = $("acct-status");
  try {
    const out = await api("POST", "/admin/password", { old_password: $("p-old").value, new_password: $("p-new").value });
    session = out.session;
    sessionStorage.setItem(SESSION_KEY, session);
    $("p-old").value = $("p-new").value = "";
    setStatus(st, "Password changed. All other sessions were signed out.", "ok");
  } catch (e) {
    setStatus(st, e.message, "err");
  }
};

$("reset-tokens").onclick = async () => {
  const st = $("reset-status");
  try {
    if (prompt("This replaces the tokens of EVERY panel. Type ROTATE to continue.") !== "ROTATE") return;
    const out = await api("POST", "/admin/reset", { mode: "tokens" });
    setStatus(st, `Rotated ${out.panels.length} panel(s).`, "ok");
    showTokens("New tokens for all panels", out.panels);
  } catch (e) {
    setStatus(st, e.message, "err");
  }
};

$("reset-all").onclick = async () => {
  const st = $("reset-status");
  try {
    if (prompt("This DELETES every panel with its image. Type DELETE to continue.") !== "DELETE") return;
    await api("POST", "/admin/reset", { mode: "all" });
    hideTokens();
    setStatus(st, "All panels deleted.", "ok");
    await refresh();
  } catch (e) {
    setStatus(st, e.message, "err");
  }
};

// restore the non-secret setting; a link may pre-fill it: …/admin/#worker=https://…
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  const main = JSON.parse(localStorage.getItem("act1033-led") || "{}");
  $("worker").value = new URLSearchParams(location.hash.slice(1)).get("worker") || saved.worker || main.worker || "";
} catch {
  /* ignore */
}
if ($("worker").value) connect();
