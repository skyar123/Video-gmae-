// Optional Groq proxy.
//
// The console calls Groq directly by default (Groq sends
// `access-control-allow-origin: *`), which avoids Netlify's limits entirely.
// This exists for the other deployment shape: a shared site where the owner
// supplies GROQ_API_KEY so visitors don't need their own key.
//
// It inherits Netlify's ~6MB request cap and 26s timeout, so it is only
// suitable for short clips.

const GROQ_BASE = "https://api.groq.com/openai/v1/audio";
const ALLOWED_ENDPOINTS = new Set(["transcriptions", "translations"]);
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const BUDGET_MS = 24_000;

const fail = (status, code, message, hint) =>
  Response.json({ error: code, message, ...(hint ? { hint } : {}) },
    { status, headers: { "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");

  const apiKey = (process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    return fail(503, "no_server_key",
      "This deployment has no GROQ_API_KEY configured.",
      "Set GROQ_API_KEY in Netlify environment variables, or let the console call Groq directly with the visitor's own key.");
  }

  const endpoint = new URL(req.url).searchParams.get("endpoint") || "transcriptions";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return fail(400, "bad_endpoint",
      `endpoint must be one of: ${[...ALLOWED_ENDPOINTS].join(", ")}.`);
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large",
      `Upload is ${(body.byteLength / 1024 / 1024).toFixed(1)}MB; this proxy accepts up to 5MB.`,
      "Use the console's direct-to-Groq mode, or the in-browser engine, for longer audio.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET_MS);

  try {
    const upstream = await fetch(`${GROQ_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        // Preserve the multipart boundary from the original request.
        "content-type": req.headers.get("content-type") || "multipart/form-data",
      },
      body,
      signal: controller.signal,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return fail(504, "proxy_timeout",
        `Groq did not respond within ${BUDGET_MS / 1000}s.`,
        "Netlify caps functions at 26s. Use direct mode or the in-browser engine for longer audio.");
    }
    return fail(502, "upstream_unreachable", `Could not reach Groq: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
};

export const config = { path: "/api/transcribe" };
