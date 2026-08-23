// Tells the console how this particular deployment is configured.

export default async () => Response.json(
  {
    // Never echo the key itself — only whether one is present.
    serverKeyConfigured: Boolean((process.env.GROQ_API_KEY || "").trim()),
    proxyTimeoutSeconds: 26,
    proxyMaxUploadMb: 5,
    commit: process.env.COMMIT_REF ? process.env.COMMIT_REF.slice(0, 7) : null,
  },
  { headers: { "cache-control": "no-store" } }
);

export const config = { path: "/api/status" };
