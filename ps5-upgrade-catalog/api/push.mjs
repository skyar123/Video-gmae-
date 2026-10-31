/**
 * Push notifications, with nobody in the middle.
 *
 * Email needs an account with a sending service before a single message can
 * leave, which is a real barrier for a personal app: the feature sits there
 * switched off until somebody goes and signs up for something. Web push has
 * no such step. The credential is an ordinary ECDSA keypair generated once
 * and kept in the environment, and the message goes straight to the push
 * service the phone already talks to — Apple's on an iPhone, Google's on
 * Android. No provider, no API key, no cost, nothing to sign up for.
 *
 * The catch is iOS, where this only works once the site has been added to the
 * Home Screen. The app is already a standalone PWA, so that is one tap, and
 * the UI says so rather than letting the button fail silently.
 */

import webpush from 'web-push';

/** A mailto: the push services can complain to; they require a subject. */
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@ps5-upgrade-catalog.netlify.app';

export const pushConfigured = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/** The browser needs this to subscribe; it is public by design. */
export const publicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let ready = false;

function arm() {
  if (ready || !pushConfigured()) return pushConfigured();
  webpush.setVapidDetails(SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  ready = true;
  return true;
}

/**
 * Sends one notification.
 *
 * Resolves to a reason rather than throwing, and says when a subscription is
 * dead: a phone that reinstalled the app, revoked permission or simply went
 * away answers 404 or 410, and that record should be dropped rather than
 * retried nightly forever.
 */
export async function sendPush(subscription, payload) {
  if (!arm()) return { sent: false, reason: 'not-configured' };

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
    return { sent: true };
  } catch (error) {
    const status = error?.statusCode ?? 0;
    return { sent: false, gone: status === 404 || status === 410, reason: `push ${status || error?.message}` };
  }
}
