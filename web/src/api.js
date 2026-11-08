// fetch() wrapper for calls to the user's Worker. Keeps a short in-memory log of what this page sent (method, path, status, time)
// for the Debug tab. Headers and bodies are never logged, so tokens cannot leak into the log or a copied report.
export const requestLog = [];
const MAX_LOG = 100;
let onLog = () => {};
export const setLogListener = (fn) => (onLog = fn);

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? "?…" : "");
  } catch {
    return String(url).slice(0, 80);
  }
}

/** opts.quiet: do not log (background polling that would only add noise). */
export async function api(url, init = {}, opts = {}) {
  const t0 = performance.now();
  let status = "ERR";
  try {
    const res = await fetch(url, init);
    status = res.status;
    return res;
  } finally {
    if (!opts.quiet) {
      requestLog.unshift({ at: Date.now(), method: init.method || "GET", path: shortUrl(url), status, ms: Math.round(performance.now() - t0) });
      if (requestLog.length > MAX_LOG) requestLog.length = MAX_LOG;
      onLog();
    }
  }
}

export function clearLog() {
  requestLog.length = 0;
  onLog();
}
