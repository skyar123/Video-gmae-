/**
 * "Email me when this gets cheaper."
 *
 * The wishlist itself never leaves the phone — it is localStorage and nothing
 * more. An email alert cannot work that way, so this is the one piece of the
 * app that keeps something server-side: an address, the games it watches, and
 * the price each was at when it was added. Nothing else. No name, no history,
 * no analytics.
 *
 * Confirmation is required before a single message is sent, because anyone can
 * type any address into a public form, and the person who owns that address
 * never asked us for anything. Every alert carries a one-click unsubscribe
 * that needs no password and no return visit.
 *
 * The nightly price job already reads every game's price. Alerts ride along on
 * that pass rather than adding a second one.
 */

import { loadBlob, saveBlob } from './history.mjs';
import { ALERTS_KEY } from './keys.mjs';
import { mailConfigured, sendMail, siteOrigin, wrap } from './mail.mjs';

/** A personal app, but a public form: both caps are here to bound abuse. */
const MAX_SUBSCRIBERS = 200;
const MAX_GAMES_EACH = 200;
/** Don't mail about the same game twice in a week of a rolling sale. */
const QUIET_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deliberately loose: the confirmation mail is the real check. */
const looksLikeEmail = (value) =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

const normaliseEmail = (value) => value.trim().toLowerCase();

const newToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');

const load = async () => (await loadBlob(ALERTS_KEY)) ?? {};
const save = (all) => saveBlob(ALERTS_KEY, all);

const findByToken = (all, token) =>
  token ? Object.entries(all).find(([, row]) => row.token === token) : undefined;

const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/* ------------------------------------------------------------------ *
 * Subscribing
 * ------------------------------------------------------------------ */

/**
 * Creates or updates a subscription and returns a token the browser keeps, so
 * a later wishlist change can be synced without asking for the address again.
 *
 * An address that is already confirmed is not mailed again just for adding a
 * game; only a new or unconfirmed one gets the confirmation note.
 */
export async function subscribe({ email, games = [], minDiscount = 10, region = 'US' }) {
  if (!looksLikeEmail(email)) return { ok: false, error: 'That does not look like an email address.' };
  if (!mailConfigured()) {
    return {
      ok: false,
      error: 'Email is not switched on for this site yet, so nothing would arrive.',
      code: 'not-configured',
    };
  }

  const all = await load();
  const key = normaliseEmail(email);
  const existing = all[key];

  if (!existing && Object.keys(all).length >= MAX_SUBSCRIBERS) {
    return { ok: false, error: 'This site is at its limit for alert sign-ups.' };
  }

  const row = existing ?? {
    email: key,
    token: newToken(),
    confirmed: false,
    createdAt: new Date().toISOString(),
    games: {},
  };

  row.minDiscount = Math.min(Math.max(Number(minDiscount) || 0, 0), 90);
  row.region = String(region || 'US').toUpperCase().slice(0, 2);
  row.games = mergeGames(row.games, games);

  all[key] = row;
  await save(all);

  if (!row.confirmed) {
    const sent = await sendConfirmation(row);
    if (!sent.sent) return { ok: false, error: `Could not send the confirmation email (${sent.reason}).` };
    return { ok: true, token: row.token, confirmed: false, watching: Object.keys(row.games).length };
  }

  return { ok: true, token: row.token, confirmed: true, watching: Object.keys(row.games).length };
}

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
    // A renamed catalog entry should still read correctly in the mail.
    if (entry?.title) next[id].title = String(entry.title).slice(0, 200);
  }
  return next;
}

/** Syncs the watched set for a browser that already holds a token. */
export async function syncWatchlist({ token, games = [], minDiscount, region }) {
  const all = await load();
  const found = findByToken(all, token);
  if (!found) return { ok: false, error: 'That alert link is no longer active.' };

  const [key, row] = found;
  row.games = mergeGames(row.games, games);
  if (minDiscount !== undefined) row.minDiscount = Math.min(Math.max(Number(minDiscount) || 0, 0), 90);
  if (region) row.region = String(region).toUpperCase().slice(0, 2);
  all[key] = row;
  await save(all);

  return {
    ok: true,
    token: row.token,
    confirmed: Boolean(row.confirmed),
    watching: Object.keys(row.games).length,
    minDiscount: row.minDiscount,
  };
}

export async function statusFor(token) {
  const found = findByToken(await load(), token);
  if (!found) return { ok: false };
  const [, row] = found;
  return {
    ok: true,
    email: row.email,
    confirmed: Boolean(row.confirmed),
    watching: Object.keys(row.games ?? {}).length,
    minDiscount: row.minDiscount ?? 10,
  };
}

export async function confirm(token) {
  const all = await load();
  const found = findByToken(all, token);
  if (!found) return { ok: false };
  const [key, row] = found;
  row.confirmed = true;
  row.confirmedAt = new Date().toISOString();
  all[key] = row;
  await save(all);
  return { ok: true, email: row.email };
}

export async function unsubscribe(token) {
  const all = await load();
  const found = findByToken(all, token);
  if (!found) return { ok: false };
  const [key, row] = found;
  delete all[key];
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
  if (!mailConfigured()) return { skipped: 'mail-not-configured' };

  const all = await load();
  let mailed = 0;
  let drops = 0;
  let changed = false;

  for (const [key, row] of Object.entries(all)) {
    if (!row?.confirmed) continue;

    const found = [];
    for (const [id, watch] of Object.entries(row.games ?? {})) {
      const drop = evaluate(watch, pricesById.get(id), row.minDiscount ?? 10, now);
      changed = true;
      if (drop) found.push({ ...drop, id });
    }
    if (found.length === 0) continue;

    found.sort((a, b) => b.discountPercent - a.discountPercent);
    const result = await sendDigest(row, found);
    if (!result.sent) {
      console.error(`Alert to ${key} failed: ${result.reason}`);
      continue;
    }

    // Only a delivered message moves the baseline, so a provider outage means
    // a late alert rather than a lost one.
    const stamp = new Date(now).toISOString();
    for (const drop of found) {
      row.games[drop.id].lastSentAt = stamp;
      row.games[drop.id].lastSentFinal = drop.now;
    }
    mailed += 1;
    drops += found.length;
  }

  if (changed) await save(all);
  return { mailed, drops, subscribers: Object.keys(all).length };
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

  if (method === 'GET') return json(200, { configured: mailConfigured() });

  if (method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const action = body?.action;
  if (action === 'sync') return json(200, await syncWatchlist(body));
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
