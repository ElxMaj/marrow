// Pure, IO-free normalizer for meeting transcripts. The product room arrives as
// raw exports in many shapes (Zoom VTT, SRT recordings, Otter/various JSON,
// freeform notes). This turns any of them into clean, speaker-attributed
// evidence text so spans and provenance point at meaning, not at cue numbers,
// timestamps or markup. No provider, no network, no filesystem: just a string
// in, a normalized string out.

export type TranscriptFormat = "vtt" | "srt" | "json" | "text";

export interface NormalizedTranscript {
  text: string;
  format: TranscriptFormat;
  speakers: string[];
  turns: number;
}

/** One parsed line of talk before collapsing: a speaker (or undefined when the
 *  format gives no attribution) and the spoken text. */
interface RawTurn {
  speaker: string | undefined;
  text: string;
}

const SRT_HEAD = /^\s*\d+\s*\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/;

/**
 * Decide the transcript format. extension wins when the file already tells us
 * its kind; otherwise sniff the content. order matters: WEBVTT header, then the
 * SRT index+comma-timestamp shape, then a JSON opener, else plain text.
 */
export function detectTranscriptFormat(raw: string, filename?: string): TranscriptFormat {
  if (filename) {
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (ext === ".vtt") return "vtt";
    if (ext === ".srt") return "srt";
    if (ext === ".json") return "json";
    if (ext === ".txt" || ext === ".md") return "text";
  }
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("WEBVTT")) return "vtt";
  if (SRT_HEAD.test(raw)) return "srt";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "text";
}

/**
 * Normalize a raw transcript into speaker-attributed evidence text. parses per
 * format, strips cue numbers/timestamps/markup, collapses consecutive turns by
 * the same speaker, and emits each block as `Speaker: text` (or just the text
 * when the format gives no speaker). Never throws: an unrecognized JSON shape
 * degrades to text rather than failing ingest.
 */
export function normalizeTranscript(
  raw: string,
  opts: { filename?: string; format?: TranscriptFormat } = {},
): NormalizedTranscript {
  const format = opts.format ?? detectTranscriptFormat(raw, opts.filename);

  let rawTurns: RawTurn[];
  switch (format) {
    case "vtt":
      rawTurns = parseVtt(raw);
      break;
    case "srt":
      rawTurns = parseSrt(raw);
      break;
    case "json":
      rawTurns = parseJson(raw);
      break;
    case "text":
      rawTurns = parseText(raw);
      break;
  }

  return assemble(rawTurns, format);
}

// ---------------------------------------------------------------------------
// shared helpers

/** Trim and collapse internal whitespace so "Alice " and "Alice  B" normalize. */
function cleanSpeaker(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Collapse internal whitespace within a line of spoken text. */
function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Pull a leading `Speaker: text` prefix off a line, if present. Only a short,
 *  single-line-looking name counts, so a sentence with a mid colon is not eaten. */
function splitSpeakerPrefix(line: string): { speaker: string | undefined; text: string } {
  const m = /^([^:\n]{1,60}?):\s*(.*)$/.exec(line);
  if (m && m[1] !== undefined && m[2] !== undefined && !/[.?!]/.test(m[1])) {
    return { speaker: cleanSpeaker(m[1]), text: m[2] };
  }
  return { speaker: undefined, text: line };
}

/**
 * Turn parsed raw turns into the final result: drop empties, collapse
 * consecutive same-speaker turns into one block, render `Speaker: text` lines,
 * and report unique speakers in first-seen order plus the block count.
 */
function assemble(rawTurns: RawTurn[], format: TranscriptFormat): NormalizedTranscript {
  const blocks: RawTurn[] = [];
  for (const turn of rawTurns) {
    const text = cleanText(turn.text);
    if (text === "") continue;
    const speaker = turn.speaker ? cleanSpeaker(turn.speaker) : undefined;
    const prev = blocks[blocks.length - 1];
    if (prev && prev.speaker === speaker && speaker !== undefined) {
      prev.text = `${prev.text} ${text}`;
    } else {
      blocks.push({ speaker, text });
    }
  }

  const speakers: string[] = [];
  for (const b of blocks) {
    if (b.speaker !== undefined && !speakers.includes(b.speaker)) speakers.push(b.speaker);
  }

  const text = blocks
    .map((b) => (b.speaker !== undefined ? `${b.speaker}: ${b.text}` : b.text))
    .join("\n");

  return { text, format, speakers, turns: blocks.length };
}

// ---------------------------------------------------------------------------
// VTT

function parseVtt(raw: string): RawTurn[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const turns: RawTurn[] = [];
  let skipBlock = false;
  // true once a cue's timing line has been seen, until the next blank: the lines
  // that follow are spoken payload, so a payload line that happens to begin with
  // NOTE/STYLE/WEBVTT is text, not a comment block, and must not be dropped.
  let inCue = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    i += 1;

    if (trimmed === "") {
      skipBlock = false;
      inCue = false;
      continue;
    }
    // header and NOTE/STYLE blocks: skip to the next blank line, but only
    // between cues, never inside a cue's spoken payload.
    if (
      !inCue &&
      (trimmed.startsWith("WEBVTT") || trimmed.startsWith("NOTE") || trimmed.startsWith("STYLE"))
    ) {
      skipBlock = true;
    }
    if (skipBlock) continue;
    // cue timing line: skip it and enter the cue's payload.
    if (trimmed.includes("-->")) {
      inCue = true;
      continue;
    }
    // a bare numeric or identifier line that is the cue id, when the next line
    // is the timing line: skip it (only before the cue's payload begins).
    if (!inCue && /^[\w-]+$/.test(trimmed) && (lines[i] ?? "").includes("-->")) continue;

    const { speaker, text } = extractVttLine(line);
    if (cleanText(text) !== "") turns.push({ speaker, text });
  }
  return turns;
}

/** Extract speaker and text from a VTT payload line: a `<v Speaker>...</v>`
 *  voice tag, or a leading `Speaker:` prefix, then strip any remaining tags. */
function extractVttLine(line: string): RawTurn {
  let speaker: string | undefined;
  let body = line;

  const voice = /<v\s+([^>]+)>/i.exec(body);
  if (voice && voice[1] !== undefined) {
    speaker = cleanSpeaker(voice[1]);
  }
  // strip all markup tags (<v ...>, </v>, <c>, <00:00:00.000> etc).
  body = body.replace(/<[^>]*>/g, "");

  if (speaker === undefined) {
    const split = splitSpeakerPrefix(body);
    speaker = split.speaker;
    body = split.text;
  }
  return { speaker, text: body };
}

// ---------------------------------------------------------------------------
// SRT

function parseSrt(raw: string): RawTurn[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const turns: RawTurn[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.includes("-->")) continue;
    // bare index line directly before a timing line: skip.
    if (/^\d+$/.test(trimmed) && (lines[i + 1] ?? "").includes("-->")) continue;

    const { speaker, text } = splitSpeakerPrefix(line);
    if (cleanText(text) !== "") turns.push({ speaker, text });
  }
  return turns;
}

// ---------------------------------------------------------------------------
// JSON

function parseJson(raw: string): RawTurn[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return parseText(raw);
  }

  const fromArray = (arr: unknown[]): RawTurn[] => {
    const turns: RawTurn[] = [];
    for (const item of arr) {
      const turn = entryToTurn(item);
      if (turn && cleanText(turn.text) !== "") turns.push(turn);
    }
    return turns;
  };

  if (Array.isArray(data)) {
    const turns = fromArray(data);
    return turns.length > 0 ? turns : parseText(stringify(data, raw));
  }

  if (isRecord(data)) {
    // (b) Otter-style monologues, (c) generic segment containers.
    for (const key of ["monologues", "segments", "transcript", "results"] as const) {
      const value = data[key];
      if (Array.isArray(value)) {
        const turns = fromArray(value);
        if (turns.length > 0) return turns;
      }
    }
    // (d) a single plain-string transcript blob. It can still carry inline
    // `Speaker:` prefixes, so parse those rather than treat it as opaque.
    if (typeof data.transcript === "string") {
      return parseSpeakerLines(data.transcript);
    }
  }

  // Unrecognized shape: never throw, fall back to readable text.
  return parseText(stringify(data, raw));
}

/** Map one JSON entry to a turn. Supports {text|content} and Otter elements. */
function entryToTurn(item: unknown): RawTurn | undefined {
  if (typeof item === "string") return { speaker: undefined, text: item };
  if (!isRecord(item)) return undefined;

  const speaker = typeof item.speaker === "string" ? item.speaker : undefined;

  let text: string | undefined;
  if (typeof item.text === "string") {
    text = item.text;
  } else if (typeof item.content === "string") {
    text = item.content;
  } else if (Array.isArray(item.elements)) {
    text = item.elements
      .map((el) => (isRecord(el) && typeof el.text === "string" ? el.text : ""))
      .join("");
  }

  if (text === undefined) return undefined;
  return { speaker, text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pretty-print structured data for the text fallback, preferring the original
 *  raw string when it is already readable. */
function stringify(data: unknown, raw: string): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// text

/** Parse a plain transcript blob line by line, recognizing leading `Speaker:`
 *  prefixes. used for a JSON `{transcript: "..."}` string that still carries
 *  inline attribution. */
function parseSpeakerLines(raw: string): RawTurn[] {
  return parseText(raw).map((t) => {
    const { speaker, text } = splitSpeakerPrefix(t.text);
    return { speaker, text };
  });
}

function parseText(raw: string): RawTurn[] {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));

  // drop leading and trailing blank lines, keep interior structure.
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "") === "") start += 1;
  while (end > start && (lines[end - 1] ?? "") === "") end -= 1;

  const turns: RawTurn[] = [];
  for (let i = start; i < end; i += 1) {
    const line = lines[i] ?? "";
    turns.push({ speaker: undefined, text: line });
  }
  return turns;
}
