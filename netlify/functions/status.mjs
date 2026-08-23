// Reports how this deployment is configured, so the console can
// self-configure instead of making the user paste a URL by hand.
//
// Set KIMI_BACKEND_URL (and optionally KIMI_API_KEY) in
// Netlify → Site configuration → Environment variables.

export default async () => {
  const backend = (process.env.KIMI_BACKEND_URL || "").trim();

  return Response.json(
    {
      // Never echo KIMI_API_KEY — only whether one is present.
      backendConfigured: Boolean(backend),
      backendUrl: backend || null,
      apiKeyConfigured: Boolean((process.env.KIMI_API_KEY || "").trim()),
      proxyAvailable: Boolean(backend),
      // Netlify's synchronous function ceiling. Inference longer than this
      // must go browser -> backend directly.
      proxyTimeoutSeconds: 26,
      deployedAt: process.env.DEPLOY_TIME || null,
      commit: process.env.COMMIT_REF ? process.env.COMMIT_REF.slice(0, 7) : null,
    },
    { headers: { "cache-control": "no-store" } }
  );
};

export const config = { path: "/api/status" };
