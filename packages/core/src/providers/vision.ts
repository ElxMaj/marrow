import { z } from "zod";

import { type VisionProvider } from "./types.js";

export interface VisionAdapterConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const VISION_PROMPT =
  "Transcribe everything written or drawn in this image to plain text. Output only the text content, no commentary.";

const ClaudeResponseSchema = z
  .object({ content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional() })
  .passthrough();

/** Claude vision over plain fetch: an image block plus a transcribe prompt. */
export class ClaudeVisionAdapter implements VisionProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(config: VisionAdapterConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseURL = (config.baseURL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async describeImage(image: Uint8Array, mediaType = "image/png"): Promise<string> {
    const data = Buffer.from(image).toString("base64");
    const res = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: VISION_PROMPT },
            ],
          },
        ],
      }),
    });
    if (!res.ok)
      throw new Error(`vision (claude): request failed ${res.status} ${await res.text()}`);
    const parsed = ClaudeResponseSchema.parse(await res.json());
    return (parsed.content ?? []).map((b) => b.text ?? "").join("");
  }
}

const ChatResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.string().optional() }).passthrough().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

/** Vision via an OpenAI-shaped /chat/completions endpoint (image_url data URL),
 *  which also covers local multimodal servers. */
export class OpenAICompatibleVisionAdapter implements VisionProvider {
  readonly model: string;
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;

  constructor(config: { baseURL: string; model: string; apiKey?: string }) {
    this.model = config.model;
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async describeImage(image: Uint8Array, mediaType = "image/png"): Promise<string> {
    const data = Buffer.from(image).toString("base64");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `vision (openai-compatible): request failed ${res.status} ${await res.text()}`,
      );
    }
    const parsed = ChatResponseSchema.parse(await res.json());
    return parsed.choices?.[0]?.message?.content ?? "";
  }
}
