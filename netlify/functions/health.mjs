// Pings the Kimi-Audio backend and relays what it reports:
// model id, device, whether the detokenizer (audio output) is loaded.

import {
  resolveBackend,
  authHeaders,
  fetchWithBudget,
  errorResponse,
  NO_BACKEND,
} from "../lib/backend.mjs";

export default async (req) => {
  const override = new URL(req.url).searchParams.get("backend");
  const { base, error, detail } = resolveBackend(override);

  if (error === "no-backend") {
    return errorResponse(503, NO_BACKEND.code, NO_BACKEND.message, NO_BACKEND.hint);
  }
  if (error) {
    return errorResponse(400, error, detail);
  }

  const started = Date.now();
  try {
    const res = await fetchWithBudget(
      `${base}/health`,
      { headers: authHeaders({ accept: "application/json" }) },
      8_000
    );
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return errorResponse(
        502,
        "backend_unhealthy",
        `Backend returned HTTP ${res.status} from /health.`,
        "Check that the Kimi-Audio service in ./server is running and reachable."
      );
    }

    const body = await res.json().catch(() => ({}));
    return Response.json(
      { ok: true, latencyMs, backend: base, ...body },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    return errorResponse(
      504,
      timedOut ? "backend_timeout" : "backend_unreachable",
      timedOut
        ? "Backend did not answer /health within 8s."
        : `Could not reach the backend: ${err?.message || err}`,
      "Confirm the URL is publicly reachable over HTTPS and that CORS is enabled."
    );
  }
};

export const config = { path: "/api/health" };
