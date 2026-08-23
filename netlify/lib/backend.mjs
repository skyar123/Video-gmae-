// Shared helpers for talking to the Kimi-Audio GPU backend from
// Netlify Functions. Bundled into each function by esbuild.

/** Netlify caps synchronous functions at 26s; leave room to return a real error. */
export const PROXY_BUDGET_MS = 24_000;

export function resolveBackend(overrideUrl) {
  const raw = (overrideUrl || process.env.KIMI_BACKEND_URL || "").trim();
  if (!raw) return { error: "no-backend" };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "bad-url", detail: `Not a valid URL: ${raw}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "bad-url", detail: `Unsupported protocol: ${url.protocol}` };
  }
  // Normalise: strip a trailing slash so path joins are predictable.
  const base = url.toString().replace(/\/+$/, "");
  return { base };
}

export function authHeaders(extra = {}) {
  const key = (process.env.KIMI_API_KEY || "").trim();
  return key ? { ...extra, authorization: `Bearer ${key}` } : extra;
}

/** fetch() with a hard deadline, so a hung GPU box can't eat the whole budget. */
export async function fetchWithBudget(url, init = {}, budgetMs = PROXY_BUDGET_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function errorResponse(status, code, message, hint) {
  return Response.json(
    { error: code, message, ...(hint ? { hint } : {}) },
    { status, headers: { "cache-control": "no-store" } }
  );
}

export const NO_BACKEND = {
  code: "backend_not_configured",
  message:
    "No Kimi-Audio backend is configured for this deployment.",
  hint:
    "Set KIMI_BACKEND_URL in Netlify environment variables, or enter a backend URL in the console's Connection panel to call your GPU server directly from the browser.",
};
