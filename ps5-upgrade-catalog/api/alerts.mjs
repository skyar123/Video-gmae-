/**
 * "Tell me when this gets cheaper."
 *
 * The wishlist itself never leaves the phone — it is localStorage and nothing
 * more. An alert cannot work that way, so this is the one piece of the app
 * that keeps something server-side: a way to reach you, the games being
 * watched, and the price each was at when it was added. Nothing else. No
 * name, no history, no analytics.
 *
 * Two ways to be reached, and a record can hold either or both:
 *
 *   - A push notification to this phone. Nothing to sign up for, so this is
 *     the one that works the moment the site is deployed.
 *   - An email. Better if you want it somewhere other than your phone, but it
 *     needs a sending account to exist first, so it stays hidden until one is
 *     configured rather than offering something that cannot be delivered.
 *
 * An address is confirmed before a single message goes to it, because anyone
 * can type anyone's address into a public form, and the person who owns that
 * address never asked us for anything. A push subscription needs no such step:
 * the browser already asked, and the phone can revoke it at any time. Both
 * carry a one-click way out that needs no password and no return visit.
 *
 * The nightly price job already reads every game's price. Alerts ride along on
 * that pass rather than adding a second one.
 *
 * Records are keyed by their own token rather than by address, because a
 * push-only subscriber has no address to be keyed by.
 */

import { loadBlob, saveBlob } from './history.mjs';
import { ALERTS_KEY } from './keys.mjs';
import { mailConfigured, sendMail, siteOrigin, wrap } from './mail.mjs';
import { publicKey as pushPublicKey, pushConfigured, sendPush } from './push.mjs';

/** A personal app, but a public form: both caps are here to bound abuse. */
const MAX_SUBSCRIBERS = 200;
const MAX_GAMES_EACH = 200;
/** Don't tell you about the same game twice during one rolling sale. */
const QUIET_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deliberately loose: the confirmation mail is the real check. */
const looksLikeEmail = (value) =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

const normaliseEmail = (value) => value.trim().toLowerCase();

const newToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');

const load = async () => (await loadBlob(ALERTS_KEY)) ?? {};
const save = (all) => saveBlob(ALERTS_KEY, all);

/** Records are keyed by token, so this is a lookup rather than a scan. */
const byToken = (all, token) => (token && all[token] ? all[token] : null);

const byEmail = (all, email) =>
  Object.values(all).find((row) => row.email === email) ?? null;

/** A fresh record, reachable by nothing until a channel is added to it. */
const blank = (token) => ({
  token,
  createdAt: new Date().toISOString(),
  email: null,
  emailConfirmed: false,
  push: null,
  minDiscount: 20,
  region: 'US',
  games: {},
});

/** What the browser is told about its own subscription. */
const view = (row) => ({
  ok: true,
  token: row.token,
  email: row.email,
  emailConfirmed: Boolean(row.emailConfirmed),
  pushEnabled: Boolean(row.push),
  // Kept for the callers written before push existed.
  confirmed: Boolean(row.emailConfirmed),
  watching: Object.keys(row.games ?? {}).length,
  minDiscount: row.minDiscount ?? 20,
});

const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/* ------------------------------------------------------------------ *
 * Subscribing
 * ------------------------------------------------------------------ */

/**
 * Adds an email address to a record, creating one if this browser has none.
 *
 * An address that is already confirmed is not mailed again just for adding a
 * game; only a new or unconfirmed one gets the confirmation note.
 */
export async function subscribe({ token, email, games = [], minDiscount, region = 'US' }) {
  if (!looksLikeEmail(email)) return { ok: false, error: 'That does not look like an email address.' };
  if (!mailConfigured()) {
    return {
      ok: false,
      error: 'Email is not switched on for this site yet, so nothing would arrive.',
      code: 'not-configured',
    };
  }

  const all = await load();
  const address = normaliseEmail(email);

  // Three ways in: this browser's own record, a record that already holds the
  // address, or a new one. Finding the address first means signing up twice
  // from two devices keeps one subscription rather than making two.
  const row = byToken(all, token) ?? byEmail(all, address) ?? blank(newToken());

  if (!all[row.token] && Object.keys(all).length >= MAX_SUBSCRIBERS) {
    return { ok: false, error: 'This site is at its limit for alert sign-ups.' };
  }

  // Changing the address means confirming the new one.
  if (row.email !== address) {
    row.email = address;
    row.emailConfirmed = false;
  }
  if (minDiscount !== undefined) row.minDiscount = clampDiscount(minDiscount);
  row.region = String(region || 'US').toUpperCase().slice(0, 2);
  row.games = mergeGames(row.games, games);

  all[row.token] = row;
  await save(all);

  if (!row.emailConfirmed) {
    const sent = await sendConfirmation(row);
    if (!sent.sent) return { ok: false, error: `Could not send the confirmation email (${sent.reason}).` };
  }
  return view(row);
}

/**
 * Registers this phone for push, creating a record if there is not one yet.
 *
 * No confirmation step: the browser's own permission prompt already asked,
 * and it can be taken away from the phone at any time without asking us.
 */
export async function subscribePush({ token, subscription, games = [], minDiscount, region = 'US' }) {
  if (!pushConfigured()) {
    return { ok: false, error: 'Push is not switched on for this site.', code: 'not-configured' };
  }
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { ok: false, error: 'That subscription is missing the keys a push needs.' };
  }

  const all = await load();
  const row = byToken(all, token) ?? blank(newToken());

  if (!all[row.token] && Object.keys(all).length >= MAX_SUBSCRIBERS) {
    return { ok: false, error: 'This site is at its limit for alert sign-ups.' };
  }

  row.push = {
    endpoint: String(subscription.endpoint).slice(0, 700),
    keys: {
      p256dh: String(subscription.keys.p256dh).slice(0, 200),
      auth: String(subscription.keys.auth).slice(0, 100),
    },
  };
  if (minDiscount !== undefined) row.minDiscount = clampDiscount(minDiscount);
  row.region = String(region || 'US').toUpperCase().slice(0, 2);
  row.games = mergeGames(row.games, games);

  all[row.token] = row;
  await save(all);
  return view(row);
}

/** Turns push off for this phone without touching an email on the same record. */
export async function unsubscribePush(token) {
  const all = await load();
  const row = byToken(all, token);
  if (!row) return { ok: false };

  row.push = null;
  // A record nobody can be reached through is just stored data; drop it.
  if (!row.email) delete all[token];
  else all[token] = row;
  await save(all);
  return { ok: true };
}

const clampDiscount = (value) => Math.min(Math.max(Number(value) || 0, 0), 90);

/**
 * Replaces the watched set, keeping the recorded baseline for games that were
 * already there. The baseline is what "cheaper" is measured against, so
 * re-syncing a wishlist must not quietly reset it.
 */
function mergeGames(current = {}, incoming = []) {
  const next = {};
  for (const entry of incoming.slice(0, MAX_GAMES_EACH)) {
    const id = String(entry?.id ?? '').slice(0, 80);
    if (!id) continue;
    next[id] = current[id] ?? {
      title: String(entry?.title ?? id).slice(0, 200),
      addedAt: new Date().toISOString(),
      basePrice: null,
      lastSentAt: null,
      lastSentFinal: null,
    };
    // A renamed catalog entry should still read correctly in the alert.
    if (entry?.title) next[id].title = String(entry.title).slice(0, 200);
  }
  return next;
}

/** Syncs the watched set for a browser that already holds a token. */
export async function syncWatchlist({ token, games = [], minDiscount, region }) {
  const all = await load();
  const row = byToken(all, token);
  if (!row) return { ok: false, error: 'That alert link is no longer active.' };

  row.games = mergeGames(row.games, games);
  if (minDiscount !== undefined) row.minDiscount = clampDiscount(minDiscount);
  if (region) row.region = String(region).toUpperCase().slice(0, 2);
  all[token] = row;
  await save(all);
  return view(row);
}

export async function statusFor(token) {
  const row = byToken(await load(), token);
  return row ? view(row) : { ok: false };
}

export async function confirm(token) {
  const all = await load();
  const row = byToken(all, token);
  if (!row?.email) return { ok: false };

  row.emailConfirmed = true;
  row.confirmedAt = new Date().toISOString();
  all[token] = row;
  await save(all);
  return { ok: true, email: row.email };
}

/** The unsubscribe link in an email: stops everything and deletes the record. */
export async function unsubscribe(token) {
  const all = await load();
  const row = byToken(all, token);
  if (!row) return { ok: false };

  delete all[token];
  await save(all);
  return { ok: true, email: row.email };
}

/* ------------------------------------------------------------------ *
 * The two messages
 * ------------------------------------------------------------------ */

function sendConfirmation(row) {
  const link = `${siteOrigin()}/api/alerts?confirm=${row.token}`;
  return sendMail({
    to: row.email,
    subject: 'Confirm your game price alerts',
    text:
      `Someone asked for price-drop alerts from the PS4 to PS5 catalog at this address.\n\n` +
      `If that was you, confirm here:\n${link}\n\n` +
      `If it was not, ignore this message. Nothing else will be sent, and the address is deleted automatically.`,
    html: wrap(
      'Confirm your price alerts',
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155">Someone asked for price-drop alerts at this address. If that was you, confirm below and you will get a note whenever something on your wishlist gets cheaper.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:9999px">Confirm alerts</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">If it was not you, ignore this. Nothing else will be sent.</p>`,
    ),
  });
}

/** One digest per person, however many games dropped. */
function sendDigest(row, drops) {
  const stop = `${siteOrigin()}/api/alerts?unsubscribe=${row.token}`;
  const lead =
    drops.length === 1
      ? `${drops[0].title} is cheaper.`
      : `${drops.length} games on your wishlist are cheaper.`;

  const line = (drop) => {
    const saved = money(drop.was - drop.now, drop.currency);
    const ends = drop.saleEndsAt
      ? `, ends ${new Date(drop.saleEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';
    return `${drop.title} — ${money(drop.now, drop.currency)}, down from ${money(drop.was, drop.currency)} (${drop.discountPercent}% off, save ${saved}${ends})`;
  };

  const row_ = (drop) => {
    const ends = drop.saleEndsAt
      ? `<span style="color:#b45309"> · ends ${new Date(drop.saleEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`
      : '';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0">
<div style="font-size:15px;font-weight:600">${escapeHtml(drop.title)}</div>
<div style="margin-top:4px;font-size:14px;color:#334155"><strong style="color:#047857">${money(drop.now, drop.currency)}</strong> <span style="color:#94a3b8;text-decoration:line-through">${money(drop.was, drop.currency)}</span> · ${drop.discountPercent}% off · save ${money(drop.was - drop.now, drop.currency)}${ends}</div>
</td></tr>`;
  };

  return sendMail({
    to: row.email,
    subject: drops.length === 1 ? `${drops[0].title} is ${drops[0].discountPercent}% off` : lead,
    text: `${lead}\n\n${drops.map(line).join('\n')}\n\nOpen the catalog: ${siteOrigin()}\nStop these emails: ${stop}\n`,
    html: wrap(
      lead,
      `<table style="width:100%;border-collapse:collapse">${drops.map(row_).join('')}</table>
<p style="margin:24px 0 0"><a href="${siteOrigin()}/?wishlist=1" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:9999px">Open your wishlist</a></p>
<p style="margin:28px 0 0;font-size:13px;color:#64748b">Prices are from the PlayStation Store and can change again at any time. <a href="${stop}" style="color:#64748b">Stop these emails</a>.</p>`,
    ),
  });
}

/**
 * The same news, as a notification.
 *
 * A phone notification is one line read at a glance, so it says the thing
 * itself — what it costs now and what that saves — rather than a subject line
 * that has to be opened to mean anything. Tapping it opens the wishlist.
 */
function sendDropPush(row, drops) {
  const top = drops[0];
  const title =
    drops.length === 1
      ? `${top.title} is ${top.discountPercent}% off`
      : `${drops.length} wishlist games are cheaper`;

  const body =
    drops.length === 1
      ? `${money(top.now, top.currency)}, down from ${money(top.was, top.currency)}. You save ${money(top.was - top.now, top.currency)}.`
      : drops
          .slice(0, 3)
          .map((drop) => `${drop.title} ${money(drop.now, drop.currency)}`)
          .join(' · ');

  return sendPush(row.push, {
    title,
    body,
    // Replaces last night's notification rather than stacking another one up.
    tag: 'price-drop',
    url: '/?wishlist=1',
  });
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/* ------------------------------------------------------------------ *
 * The nightly pass
 * ------------------------------------------------------------------ */

/**
 * Decides whether one watched game is worth an email, and records the baseline
 * the next decision will be measured against.
 *
 * A first sighting only sets the baseline: joining while a sale is already on
 * should not fire an alert about a price that was there all along. After that
 * the test is a real drop below both the baseline and whatever was last sent,
 * at or past the discount the reader asked for, and not within the quiet
 * window, so a sale that rolls over night after night is mailed once.
 */
function evaluate(watch, price, minDiscount, now) {
  if (!price || price.isFree || typeof price.final !== 'number') return null;

  const first = watch.basePrice == null;
  if (first) {
    watch.basePrice = price.initial ?? price.final;
    watch.baseFinal = price.final;
    return null;
  }

  const reference = Math.min(watch.baseFinal ?? watch.basePrice, watch.lastSentFinal ?? Infinity);
  if (price.final >= reference) return null;
  if ((price.discountPercent ?? 0) < minDiscount) return null;

  if (watch.lastSentAt && now - new Date(watch.lastSentAt).getTime() < QUIET_DAYS * DAY_MS) {
    return null;
  }

  return {
    title: watch.title,
    was: watch.baseFinal ?? watch.basePrice,
    now: price.final,
    currency: price.currency ?? 'USD',
    discountPercent: price.discountPercent ?? 0,
    saleEndsAt: price.saleEndsAt ?? null,
  };
}

/**
 * Runs every confirmed subscription against tonight's prices.
 *
 * `pricesById` maps a catalog game id to the price object the nightly sweep
 * just read, so this adds no store traffic of its own.
 */
export async function runAlerts(pricesById, now = Date.now()) {
  if (!mailConfigured() && !pushConfigured()) return { skipped: 'no-channel-configured' };

  const all = await load();
  let notified = 0;
  let drops = 0;
  let changed = false;

  for (const [token, row] of Object.entries(all)) {
    const canMail = Boolean(row?.email && row.emailConfirmed && mailConfigured());
    const canPush = Boolean(row?.push && pushConfigured());
    if (!canMail && !canPush) continue;

    const found = [];
    for (const [id, watch] of Object.entries(row.games ?? {})) {
      const drop = evaluate(watch, pricesById.get(id), row.minDiscount ?? 20, now);
      // evaluate() records the baseline on first sighting, so the store has
      // changed whether or not anything is worth sending.
      changed = true;
      if (drop) found.push({ ...drop, id });
    }
    if (found.length === 0) continue;

    found.sort((a, b) => b.discountPercent - a.discountPercent);

    // Both channels are tried; either one arriving counts. A phone that has
    // gone away is dropped rather than retried every night from here on.
    let delivered = false;

    if (canPush) {
      const result = await sendDropPush(row, found);
      if (result.sent) delivered = true;
      else if (result.gone) {
        row.push = null;
        if (!row.email) delete all[token];
      } else {
        console.error(`Push for ${token.slice(0, 8)} failed: ${result.reason}`);
      }
    }

    if (canMail) {
      const result = await sendDigest(row, found);
      if (result.sent) delivered = true;
      else console.error(`Email for ${token.slice(0, 8)} failed: ${result.reason}`);
    }

    // Only a delivered alert moves the baseline, so an outage at one of the
    // push services means a late notification rather than a lost one.
    if (!delivered) continue;

    const stamp = new Date(now).toISOString();
    for (const drop of found) {
      if (!row.games[drop.id]) continue;
      row.games[drop.id].lastSentAt = stamp;
      row.games[drop.id].lastSentFinal = drop.now;
    }
    notified += 1;
    drops += found.length;
  }

  if (changed) await save(all);
  return { notified, drops, subscribers: Object.keys(all).length };
}

/* ------------------------------------------------------------------ *
 * The endpoint, shared by the Netlify function and the dev server
 * ------------------------------------------------------------------ */

/** Confirm and unsubscribe are links in an email, so they answer in HTML. */
const page = (heading, body) => ({
  status: 200,
  type: 'text/html; charset=utf-8',
  body: wrap(heading, `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155">${body}</p>
<p style="margin:0"><a href="${siteOrigin()}/" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:9999px">Back to the catalog</a></p>`),
});

const json = (status, payload) => ({
  status,
  type: 'application/json; charset=utf-8',
  body: JSON.stringify(payload),
});

/**
 * One handler for every alert route.
 *
 * `url` is a URL, `method` the verb, `body` the parsed JSON for a POST.
 * Returns `{status, type, body}` so the caller only has to write it out.
 */
export async function handleAlertsRequest({ method, url, body }) {
  const confirmToken = url.searchParams.get('confirm');
  if (confirmToken) {
    const result = await confirm(confirmToken);
    return result.ok
      ? page('Alerts are on', 'You will get an email when something on your wishlist gets cheaper. Every message has a one-click way out.')
      : page('That link has expired', 'Nothing is subscribed at this address. You can set alerts up again from the catalog.');
  }

  const stopToken = url.searchParams.get('unsubscribe');
  if (stopToken) {
    const result = await unsubscribe(stopToken);
    return result.ok
      ? page('Unsubscribed', 'Your address and the games it watched have been deleted. Nothing further will be sent.')
      : page('Already unsubscribed', 'There is nothing stored for that link.');
  }

  const statusToken = url.searchParams.get('status');
  if (statusToken) return json(200, await statusFor(statusToken));

  if (method === 'GET') {
    return json(200, {
      configured: mailConfigured(),
      email: mailConfigured(),
      push: pushConfigured(),
      // The browser needs this to subscribe. It is public by design.
      vapidPublicKey: pushPublicKey(),
    });
  }

  if (method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const action = body?.action;
  if (action === 'sync') return json(200, await syncWatchlist(body));
  if (action === 'subscribe-push') {
    const result = await subscribePush(body ?? {});
    return json(result.ok ? 200 : 400, result);
  }
  if (action === 'unsubscribe-push') return json(200, await unsubscribePush(body?.token));
  if (action === 'unsubscribe') {
    const result = await unsubscribe(body?.token);
    return json(200, { ok: result.ok });
  }
  if (action === 'subscribe') {
    const result = await subscribe(body ?? {});
    return json(result.ok ? 200 : 400, result);
  }
  return json(400, { ok: false, error: 'Unknown action' });
}
