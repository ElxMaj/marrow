import { z } from "zod";

import { type TranscriptionProvider } from "./types.js";

export interface TranscriptionAdapterConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
}

const ResponseSchema = z.object({ text: z.string() }).passthrough();

/**
 * Transcription via an OpenAI-shaped `/audio/transcriptions` endpoint (Whisper),
 * which also covers local transcription servers. Anthropic has no audio API, so
 * transcription always goes through this shape, behind the provider interface.
 */
export class OpenAICompatibleTranscriptionAdapter implements TranscriptionProvider {
  readonly model: string;
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;

  constructor(config: TranscriptionAdapterConfig) {
    this.model = config.model;
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async transcribe(audio: Uint8Array, mediaType = "audio/m4a"): Promise<string> {
    // copy into a fresh ArrayBuffer-backed view so Blob accepts it under both
    // the node and DOM lib type definitions (consumers typecheck this source).
    const bytes = new Uint8Array(audio.byteLength);
    bytes.set(audio);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mediaType }), "audio");
    form.append("model", this.model);
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.baseURL}/audio/transcriptions`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      throw new Error(`transcription: request failed ${res.status} ${await res.text()}`);
    }
    return ResponseSchema.parse(await res.json()).text;
  }
}
