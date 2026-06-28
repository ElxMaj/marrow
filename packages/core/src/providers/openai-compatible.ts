import { z } from "zod";

import {
  type CompleteOptions,
  type CompletionResult,
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
} from "./types.js";

export interface OpenAICompatibleConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
}

const ChatResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.string().optional() }).passthrough().optional(),
          finish_reason: z.string().nullish(),
        }),
      )
      .optional(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const EmbeddingResponseSchema = z
  .object({
    data: z.array(z.object({ embedding: z.array(z.number()) })).optional(),
    model: z.string().optional(),
  })
  .passthrough();

function authHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

/**
 * Completion via an OpenAI-shaped `/chat/completions` endpoint. a configurable
 * baseURL makes this a first-class local path too: Ollama and LM Studio expose
 * exactly this shape, so pointing baseURL at `http://localhost:11434/v1` runs
 * Marrow fully offline.
 */
export class OpenAICompatibleAdapter implements ModelProvider {
  readonly model: string;
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;

  constructor(config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    return (await this.completeDetailed(prompt, opts)).text;
  }

  async completeDetailed(prompt: string, opts: CompleteOptions = {}): Promise<CompletionResult> {
    const messages = [
      ...(opts.system !== undefined ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: prompt },
    ];
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: authHeaders(this.apiKey),
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(
        `openai-compatible: request failed ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const data = ChatResponseSchema.parse(await res.json());
    // fail loud on truncation rather than returning a half-formed completion.
    if (data.choices?.[0]?.finish_reason === "length") {
      throw new Error(
        `openai-compatible: response hit the ${opts.maxTokens ?? "default"}-token output cap and was truncated. Raise maxTokens or split the input.`,
      );
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    const { prompt_tokens, completion_tokens } = data.usage ?? {};
    if (prompt_tokens !== undefined && completion_tokens !== undefined) {
      return { text, usage: { inputTokens: prompt_tokens, outputTokens: completion_tokens } };
    }
    return { text };
  }
}

/**
 * Embeddings via an OpenAI-shaped `/embeddings` endpoint. Returns the model and
 * dim so the store can persist them and detect a later provider switch.
 */
export class OpenAICompatibleEmbeddingAdapter implements EmbeddingProvider {
  readonly model: string;
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;

  constructor(config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const res = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: authHeaders(this.apiKey),
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(
        `openai-compatible: embeddings failed ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const data = EmbeddingResponseSchema.parse(await res.json());
    const vectors = (data.data ?? []).map((d) => d.embedding);
    const dim = vectors[0]?.length ?? 0;
    return { vectors, model: data.model ?? this.model, dim };
  }
}
