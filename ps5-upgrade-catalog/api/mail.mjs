/**
 * Sending mail.
 *
 * One provider, Resend, because it is a single POST and needs no SDK.
 *
 * Only RESEND_API_KEY is required. MAIL_FROM is optional and defaults to the
 * sender Resend gives every account, which works with no domain and no DNS
 * records but will only deliver to the address that owns the Resend account.
 * For one person watching their own wishlist that is exactly right, and it
 * takes the setup down from "verify a domain" to "paste one key". Set
 * MAIL_FROM to an address on your own verified domain to mail anyone else.
 *
 * Without the key nothing is sent and every caller is told so plainly rather
 * than being allowed to report success. An alert that silently does not
 * arrive is worse than one that was never offered.
 */

/** Overridable so the flow can be exercised end to end against a stub. */
const endpoint = () => process.env.RESEND_ENDPOINT || 'https://api.resend.com/emails';

/** Resend's own sender, usable immediately and without a domain. */
const DEFAULT_FROM = 'onboarding@resend.dev';

export const mailFrom = () => process.env.MAIL_FROM || DEFAULT_FROM;

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY);

/** Where confirmation and unsubscribe links point. */
export const siteOrigin = () =>
  (process.env.SITE_URL || process.env.URL || 'http://localhost:8888').replace(/\/$/, '');

/**
 * Sends one message. Resolves to a reason rather than throwing, because the
 * nightly job must carry on for everyone else when one address bounces.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) return { sent: false, reason: 'not-configured' };

  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: mailFrom(), to: [to], subject, text, html }),
    });
    if (!response.ok) {
      return { sent: false, reason: `provider ${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: String(error?.message ?? error) };
  }
}

/** Keeps the two mails looking like the app rather than like a receipt. */
export function wrap(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 20px;font-size:14px;font-weight:700;letter-spacing:-.01em;color:#475569">PS<span style="color:#4f46e5">4&rarr;5</span> Catalog</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;letter-spacing:-.02em">${title}</h1>
${bodyHtml}
</div></body></html>`;
}
