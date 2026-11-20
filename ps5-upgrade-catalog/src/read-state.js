/**
 * Which stories you have already opened.
 *
 * The feed carries up to 280 things and turns over through the day, so
 * somebody who checks it three times before lunch spends most of the second
 * and third visits re-reading headlines to find out which ones are new to
 * them. The panel already marks what was *published* since the last visit,
 * which is a different question and not the one being asked: a story can be
 * six hours old and still unread, and the one you opened an hour ago is not
 * new however recently it was filed.
 *
 * Kept by link, because a story has no id of its own and the link is the one
 * thing every source agrees on. That also means a story read as a Bluesky
 * post and then met again as a headline counts as unread, which is right:
 * they are different pieces of writing.
 */

/**
 * Comfortably more than a feed, so nothing still on screen can fall off the
 * end and come back looking unread. At 280 stories a feed this is several
 * days of them, and anything older is long gone from the feed anyway.
 */
export const READ_MAX = 1200;

/** Storage is a shared, editable space: treat whatever comes back as hostile. */
export function parseRead(raw) {
  try {
    const rows = JSON.parse(raw ?? '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter((link) => typeof link === 'string' && link.length > 0).slice(-READ_MAX);
  } catch {
    return [];
  }
}

/**
 * Opening a story again moves it to the end rather than adding it twice, so
 * the thing you keep going back to is the last to be forgotten.
 */
export function markRead(links, link) {
  if (typeof link !== 'string' || !link) return links;
  const without = links.filter((held) => held !== link);
  if (without.length === links.length - 1 && links[links.length - 1] === link) return links;
  return [...without, link].slice(-READ_MAX);
}
