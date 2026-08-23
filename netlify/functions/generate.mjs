// Server-side proxy to the Kimi-Audio backend's /v1/generate.
//
// Use this mode when you want KIMI_API_KEY kept out of the browser.
// It inherits two Netlify limits the browser-direct mode does not have:
//   * 26s wall clock  (long audio-to-audio generations will exceed it)
//   * ~6MB request body (base64 audio inflates payloads ~33%)
// The console falls back to Direct mode when either bites.

import {
  resolveBackend,
  authHeaders,
  fetchWithBudget,
  errorResponse,
  PROXY_BUDGET_MS,
  NO_BACKEND,
} from "../lib/backend.mjs";

/** Netlify's request ceiling is 6MB; stop short so we fail with a real message. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const VALID_OUTPUT_TYPES = new Set(["text", "both"]);

export default async (req) => {
  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Use POST.");
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      "payload_too_large",
      `Request is ${(raw.length / 1024 / 1024).toFixed(1)}MB; the proxy accepts up to 5MB.`,
      "Switch the console to Direct mode (browser talks straight to your GPU box) or send shorter audio."
    );
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return errorResponse(400, "invalid_json", "Request body is not valid JSON.");
  }

  const { messages, output_type = "text", sampling_params = {}, backend } = payload;

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse(400, "invalid_messages", "`messages` must be a non-empty array.");
  }
  if (!VALID_OUTPUT_TYPES.has(output_type)) {
    return errorResponse(
      400,
      "invalid_output_type",
      `\`output_type\` must be one of: ${[...VALID_OUTPUT_TYPES].join(", ")}.`
    );
  }

  const { base, error, detail } = resolveBackend(backend);
  if (error === "no-backend") {
    return errorResponse(503, NO_BACKEND.code, NO_BACKEND.message, NO_BACKEND.hint);
  }
  if (error) {
    return errorResponse(400, error, detail);
  }

  const started = Date.now();
  try {
    const res = await fetchWithBudget(`${base}/v1/generate`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        accept: "application/json",
      }),
      body: JSON.stringify({ messages, output_type, sampling_params }),
    });

    const text = await res.text();
    if (!res.ok) {
      return errorResponse(
        502,
        "backend_error",
        `Backend returned HTTP ${res.status}: ${text.slice(0, 500)}`
      );
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return errorResponse(502, "backend_bad_response", "Backend did not return JSON.");
    }

    return Response.json(
      { ...result, elapsedMs: Date.now() - started, via: "netlify-proxy" },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    if (err?.name === "AbortError") {
      return errorResponse(
        504,
        "proxy_timeout",
        `Generation exceeded the ${PROXY_BUDGET_MS / 1000}s Netlify function budget.`,
        "Audio-to-audio generation usually needs longer. Switch the console to Direct mode, which has no such limit."
      );
    }
    return errorResponse(
      502,
      "backend_unreachable",
      `Could not reach the backend: ${err?.message || err}`
    );
  }
};

export const config = { path: "/api/generate" };
