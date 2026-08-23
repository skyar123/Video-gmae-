/** Transcript serialisers: plain text, SRT, WebVTT, Markdown, JSON. */

const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, "0");

function clock(seconds, msSeparator) {
  const total = Math.max(0, seconds || 0);
  const ms = Math.round((total % 1) * 1000);
  return (
    `${pad(total / 3600)}:${pad((total % 3600) / 60)}:${pad(total % 60)}` +
    `${msSeparator}${pad(ms, 3)}`
  );
}

/** A segment whose end timestamp is missing (final chunk) falls back to start. */
const endOf = (seg) => (seg.end ?? seg.start ?? 0);

export function toText(result) {
  return (result.text || "").trim();
}

export function toParagraphs(result) {
  if (!result.segments?.length) return toText(result);
  // Break where the speaker pauses for more than a beat.
  const paras = [];
  let current = [];
  let previousEnd = null;

  for (const seg of result.segments) {
    if (previousEnd !== null && seg.start - previousEnd > 1.5 && current.length) {
      paras.push(current.join(" ").trim());
      current = [];
    }
    current.push(seg.text.trim());
    previousEnd = endOf(seg);
  }
  if (current.length) paras.push(current.join(" ").trim());
  return paras.filter(Boolean).join("\n\n");
}

export function toSrt(result) {
  if (!result.segments?.length) return toText(result);
  return result.segments
    .map((seg, i) =>
      [
        i + 1,
        `${clock(seg.start, ",")} --> ${clock(endOf(seg), ",")}`,
        seg.text.trim(),
        "",
      ].join("\n")
    )
    .join("\n");
}

export function toVtt(result) {
  if (!result.segments?.length) return `WEBVTT\n\n${toText(result)}`;
  const cues = result.segments
    .map((seg) => `${clock(seg.start, ".")} --> ${clock(endOf(seg), ".")}\n${seg.text.trim()}`)
    .join("\n\n");
  return `WEBVTT\n\n${cues}\n`;
}

export function toMarkdown(result, meta = {}) {
  const lines = ["# Transcript", ""];
  const facts = [
    meta.filename && `**Source:** ${meta.filename}`,
    meta.duration && `**Duration:** ${meta.duration}`,
    meta.engine && `**Engine:** ${meta.engine}`,
    meta.model && `**Model:** ${meta.model}`,
    meta.language && `**Language:** ${meta.language}`,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join("  \n"), "");

  if (result.segments?.length) {
    for (const seg of result.segments) {
      lines.push(`**[${clock(seg.start, ".").slice(0, 8)}]** ${seg.text.trim()}`, "");
    }
  } else {
    lines.push(toText(result));
  }
  return lines.join("\n");
}

export function toJson(result, meta = {}) {
  return JSON.stringify({ ...meta, text: toText(result), segments: result.segments || [] }, null, 2);
}

export const FORMATS = {
  txt: { label: "Plain text", ext: "txt", mime: "text/plain", render: toText },
  paragraphs: { label: "Paragraphs", ext: "txt", mime: "text/plain", render: toParagraphs },
  srt: { label: "SubRip (.srt)", ext: "srt", mime: "application/x-subrip", render: toSrt },
  vtt: { label: "WebVTT (.vtt)", ext: "vtt", mime: "text/vtt", render: toVtt },
  md: { label: "Markdown", ext: "md", mime: "text/markdown", render: toMarkdown },
  json: { label: "JSON", ext: "json", mime: "application/json", render: toJson },
};
