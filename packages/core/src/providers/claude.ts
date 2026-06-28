import { z } from "zod";

import { type CompleteOptions, type CompletionResult, type ModelProvider } from "./types.js";

export interface ClaudeAdapterConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

// lenient: validate only what we read, never reject extra fields the API adds.
const ClaudeResponseSchema = z
  .object({
    content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
    stop_reason: z.string().nullish(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * The default model adapter. talks to the Anthropic Messages API over plain
 * fetch, so there is no vendor SDK imported anywhere in core. Claude is the
 * default, never hardcoded into core logic: swap it by config.
 */
export class ClaudeAdapter implements ModelProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(config: ClaudeAdapterConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseURL = (config.baseURL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    return (await this.completeDetailed(prompt, opts)).text;
  }

  async completeDetailed(prompt: string, opts: CompleteOptions = {}): Promise<CompletionResult> {
    const res = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.system !== undefined ? { system: opts.system } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      // bound the upstream body: enough to debug, not the whole response echoed
      // into logs and error surfaces.
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`claude: request failed ${res.status} ${detail}`);
    }
    const data = ClaudeResponseSchema.parse(await res.json());
    // fail loud on truncation: a silently cut-off response yields invalid or
    // partial JSON downstream, which is worse than a clear error (Rule 7).
    if (data.stop_reason === "max_tokens") {
      throw new Error(
        `claude: response hit the ${opts.maxTokens ?? 1024}-token output cap and was truncated. Raise maxTokens or split the input.`,
      );
    }
    const text = (data.content ?? []).map((block) => block.text ?? "").join("");
    const { input_tokens, output_tokens } = data.usage ?? {};
    if (input_tokens !== undefined && output_tokens !== undefined) {
      return { text, usage: { inputTokens: input_tokens, outputTokens: output_tokens } };
    }
    return { text };
  }
}
