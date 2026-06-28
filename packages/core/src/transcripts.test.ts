import { describe, expect, it } from "vitest";

import {
  detectTranscriptFormat,
  normalizeTranscript,
  type TranscriptFormat,
} from "./transcripts.js";

// WHY: the product room arrives as raw exports from Zoom (VTT), Granola/various
// tools (SRT), Otter (JSON), and plain notes. each must ingest as clean
// speaker-attributed evidence text so spans and provenance point at meaning, not
// at cue numbers, timestamps or markup noise.

describe("detectTranscriptFormat", () => {
  it("decides by extension first, because a file we received already knows its kind", () => {
    expect(detectTranscriptFormat("anything", "meeting.vtt")).toBe<TranscriptFormat>("vtt");
    expect(detectTranscriptFormat("anything", "meeting.srt")).toBe<TranscriptFormat>("srt");
    expect(detectTranscriptFormat("anything", "export.json")).toBe<TranscriptFormat>("json");
    expect(detectTranscriptFormat("anything", "notes.txt")).toBe<TranscriptFormat>("text");
    expect(detectTranscriptFormat("anything", "notes.md")).toBe<TranscriptFormat>("text");
  });

  it("sniffs WEBVTT content so a Zoom paste with no filename still parses right", () => {
    expect(
      detectTranscriptFormat("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi"),
    ).toBe<TranscriptFormat>("vtt");
  });

  it("sniffs the SRT cue pattern so a numbered/comma-timestamp paste is not mistaken for text", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nhello";
    expect(detectTranscriptFormat(srt)).toBe<TranscriptFormat>("srt");
  });

  it("sniffs a leading [ or { as json so an Otter array paste parses structurally", () => {
    expect(detectTranscriptFormat('[{"speaker":"A","text":"hi"}]')).toBe<TranscriptFormat>("json");
    expect(detectTranscriptFormat('{"transcript":"hi"}')).toBe<TranscriptFormat>("json");
  });

  it("falls back to text when nothing else matches, so freeform notes still ingest", () => {
    expect(detectTranscriptFormat("just some standup notes")).toBe<TranscriptFormat>("text");
  });
});

describe("normalizeTranscript: VTT", () => {
  it("turns a Zoom WEBVTT export with <v> voice tags and Bob: cues into clean speaker turns, timestamps gone", () => {
    const raw = [
      "WEBVTT",
      "",
      "NOTE this is a Zoom export",
      "",
      "1",
      "00:00:01.000 --> 00:00:03.500",
      "<v Alice>We should ship magic links.</v>",
      "",
      "2",
      "00:00:04.000 --> 00:00:06.000",
      "Bob: I agree, no shared passwords.",
      "",
    ].join("\n");

    const r = normalizeTranscript(raw, { filename: "zoom.vtt" });

    expect(r.format).toBe<TranscriptFormat>("vtt");
    expect(r.speakers).toEqual(["Alice", "Bob"]);
    expect(r.turns).toBe(2);
    expect(r.text).toBe("Alice: We should ship magic links.\nBob: I agree, no shared passwords.");
    // the noise the model must never see:
    expect(r.text).not.toMatch(/-->/);
    expect(r.text).not.toMatch(/<v /);
    expect(r.text).not.toMatch(/WEBVTT|NOTE/);
  });

  it("collapses consecutive same-speaker cues into one block, so a long monologue reads as one turn", () => {
    const raw = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "<v Alice>First point.</v>",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "<v Alice>Second point.</v>",
      "",
    ].join("\n");

    const r = normalizeTranscript(raw);
    expect(r.speakers).toEqual(["Alice"]);
    expect(r.turns).toBe(1);
    expect(r.text).toBe("Alice: First point. Second point.");
  });
});

describe("normalizeTranscript: SRT", () => {
  it("strips index lines and comma timestamps from a numbered SRT, keeping the words intact", () => {
    const raw = [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "Alice: We need re-auth between shifts.",
      "",
      "2",
      "00:00:04,000 --> 00:00:05,500",
      "Bob: Once per shift is enough.",
      "",
    ].join("\n");

    const r = normalizeTranscript(raw, { filename: "rec.srt" });
    expect(r.format).toBe<TranscriptFormat>("srt");
    expect(r.speakers).toEqual(["Alice", "Bob"]);
    expect(r.turns).toBe(2);
    expect(r.text).toBe("Alice: We need re-auth between shifts.\nBob: Once per shift is enough.");
    expect(r.text).not.toMatch(/-->/);
    expect(r.text).not.toMatch(/^\s*\d+\s*$/m);
  });
});

describe("normalizeTranscript: JSON", () => {
  it("parses an Otter-style {monologues:[{speaker, elements:[{text}]}]} export, joining element fragments", () => {
    const raw = JSON.stringify({
      monologues: [
        { speaker: "Alice", elements: [{ text: "We ship " }, { text: "magic links." }] },
        { speaker: "Bob", text: "Agreed." },
      ],
    });

    const r = normalizeTranscript(raw, { filename: "otter.json" });
    expect(r.format).toBe<TranscriptFormat>("json");
    expect(r.speakers).toEqual(["Alice", "Bob"]);
    expect(r.turns).toBe(2);
    expect(r.text).toBe("Alice: We ship magic links.\nBob: Agreed.");
  });

  it("parses a generic [{speaker,text}] array, the shape most tools dump", () => {
    const raw = JSON.stringify([
      { speaker: "Alice", text: "Question one." },
      { speaker: "Bob", text: "Answer one." },
    ]);
    const r = normalizeTranscript(raw);
    expect(r.speakers).toEqual(["Alice", "Bob"]);
    expect(r.text).toBe("Alice: Question one.\nBob: Answer one.");
  });

  it("parses a {transcript:'...'} string wrapper, a common single-blob export", () => {
    const raw = JSON.stringify({ transcript: "Alice: just one line of talk." });
    const r = normalizeTranscript(raw, { format: "json" });
    expect(r.text).toBe("Alice: just one line of talk.");
    expect(r.speakers).toEqual(["Alice"]);
  });

  it("parses a {segments:[{speaker,text}]} wrapper without throwing on the unknown top key", () => {
    const raw = JSON.stringify({
      segments: [
        { speaker: "Alice", text: "Segment a." },
        { speaker: "Alice", text: "Segment b." },
      ],
    });
    const r = normalizeTranscript(raw);
    // same speaker collapses
    expect(r.turns).toBe(1);
    expect(r.text).toBe("Alice: Segment a. Segment b.");
  });

  it("never throws on an unrecognized json shape, it degrades to text so ingest never hard-fails", () => {
    const raw = JSON.stringify({ weird: { nested: 1 } });
    const r = normalizeTranscript(raw, { format: "json" });
    expect(typeof r.text).toBe("string");
    expect(r.text.length).toBeGreaterThan(0);
  });
});

describe("normalizeTranscript: text", () => {
  it("passes plain standup notes through, only trimming trailing space and edge blank lines", () => {
    const raw = "\n\nstandup: shipped auth   \nblocked on billing  \n\n";
    const r = normalizeTranscript(raw, { filename: "notes.txt" });
    expect(r.format).toBe<TranscriptFormat>("text");
    expect(r.text).toBe("standup: shipped auth\nblocked on billing");
  });
});

describe("normalizeTranscript: edges", () => {
  it("returns empty text and zero turns on empty input, so an empty file is a no-op not a crash", () => {
    const r = normalizeTranscript("");
    expect(r.text).toBe("");
    expect(r.turns).toBe(0);
    expect(r.speakers).toEqual([]);
  });
});
