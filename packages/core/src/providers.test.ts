import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "./providers/claude.js";
import {
  createEmbeddingProvider,
  createModelProvider,
  loadProviderConfig,
} from "./providers/config.js";
import { LocalEmbeddingProvider } from "./providers/local-embedding.js";
import {
  OpenAICompatibleAdapter,
  OpenAICompatibleEmbeddingAdapter,
} from "./providers/openai-compatible.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Mock {
  url: string;
  close: () => Promise<void>;
}

async function startMock(body: unknown): Promise<Mock> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("mock server has no port");
  return {
    url: `http://127.0.0.1:${addr.port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("provider interface", () => {
  it("core uses the provider interface, not a vendor SDK", () => {
    // read all of core/src except the adapters and the tests, and confirm no
    // vendor SDK leaks into core logic.
    const entries = readdirSync(here, { recursive: true, encoding: "utf8" });
    const coreSource = entries
      .filter(
        (f) =>
          f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.split(/[\\/]/).includes("providers"),
      )
      .map((f) => readFileSync(join(here, f), "utf8"))
      .join("\n");
    expect(coreSource).not.toMatch(/@anthropic-ai\/sdk|from ["']openai["']/);
  });

  it("the openai-compatible adapter hits a configurable base url (the local path)", async () => {
    const mock = await startMock({ choices: [{ message: { content: "pong" } }] });
    try {
      const p = new OpenAICompatibleAdapter({ baseURL: mock.url, model: "local", apiKey: "x" });
      const out = await p.complete("ping");
      expect(out).toBeTypeOf("string");
      expect(out).toBe("pong");
    } finally {
      await mock.close();
    }
  });

  it("the default claude adapter concatenates content text from the messages api", async () => {
    const mock = await startMock({
      content: [{ text: "ma" }, { text: "gic" }],
      stop_reason: "end_turn",
    });
    try {
      const p = new ClaudeAdapter({ apiKey: "k", model: "claude-x", baseURL: mock.url });
      expect(await p.complete("hi")).toBe("magic");
    } finally {
      await mock.close();
    }
  });

  it("the claude adapter reports token usage only when both counts are present", async () => {
    const withUsage = await startMock({
      content: [{ text: "magic" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    try {
      const p = new ClaudeAdapter({ apiKey: "k", model: "claude-x", baseURL: withUsage.url });
      const result = await p.completeDetailed("hi");
      expect(result).toEqual({
        text: "magic",
        usage: { inputTokens: 12, outputTokens: 3 },
      });
    } finally {
      await withUsage.close();
    }

    const withoutCompleteUsage = await startMock({
      content: [{ text: "magic" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12 },
    });
    try {
      const p = new ClaudeAdapter({
        apiKey: "k",
        model: "claude-x",
        baseURL: withoutCompleteUsage.url,
      });
      const result = await p.completeDetailed("hi");
      expect(result).toEqual({ text: "magic" });
    } finally {
      await withoutCompleteUsage.close();
    }
  });

  it("the claude adapter fails loud when the response was truncated", async () => {
    const mock = await startMock({ content: [{ text: "{partial" }], stop_reason: "max_tokens" });
    try {
      const p = new ClaudeAdapter({ apiKey: "k", model: "claude-x", baseURL: mock.url });
      await expect(p.complete("hi", { maxTokens: 16 })).rejects.toThrow(/truncat|cap/i);
    } finally {
      await mock.close();
    }
  });

  it("the openai-compatible adapter fails loud when the response was truncated", async () => {
    const mock = await startMock({
      choices: [{ message: { content: "{partial" }, finish_reason: "length" }],
    });
    try {
      const p = new OpenAICompatibleAdapter({ baseURL: mock.url, model: "local", apiKey: "x" });
      await expect(p.complete("ping", { maxTokens: 16 })).rejects.toThrow(/truncat|cap/i);
    } finally {
      await mock.close();
    }
  });

  it("embed returns vectors with the model and the dim", async () => {
    const mock = await startMock({ data: [{ embedding: [0.1, 0.2, 0.3] }], model: "emb-1" });
    try {
      const e = new OpenAICompatibleEmbeddingAdapter({
        baseURL: mock.url,
        model: "emb-1",
        apiKey: "x",
      });
      const result = await e.embed(["hello world"]);
      expect(result.dim).toBe(3);
      expect(result.model).toBe("emb-1");
      expect(result.vectors[0]).toEqual([0.1, 0.2, 0.3]);
    } finally {
      await mock.close();
    }
  });

  it("switching provider only changes the adapter", () => {
    const claude = createModelProvider(
      loadProviderConfig({ MARROW_PROVIDER: "claude", MARROW_API_KEY: "k" }),
    );
    expect(claude).toBeInstanceOf(ClaudeAdapter);
    expect(claude.model).toBe("claude-sonnet-4-6"); // mid-tier default, not the priciest

    const local = createModelProvider(
      loadProviderConfig({
        MARROW_PROVIDER: "openai-compatible",
        MARROW_BASE_URL: "http://localhost:11434/v1",
        MARROW_MODEL: "llama3",
      }),
    );
    expect(local).toBeInstanceOf(OpenAICompatibleAdapter);
  });

  it("missing config fails loud, never a silent wrong default", () => {
    expect(() => loadProviderConfig({ MARROW_PROVIDER: "claude" })).toThrow(/MARROW_API_KEY/);
    expect(() => loadProviderConfig({ MARROW_PROVIDER: "openai-compatible" })).toThrow(
      /MARROW_BASE_URL/,
    );
    expect(() => loadProviderConfig({ MARROW_PROVIDER: "nonsense" })).toThrow(/MARROW_PROVIDER/);
  });

  it("embeddings fall back to the in-process local model when no endpoint is configured", () => {
    const config = loadProviderConfig({ MARROW_PROVIDER: "claude", MARROW_API_KEY: "k" });
    // claude has no embeddings API; instead of failing, distillation must still
    // be possible via a zero-config local embedder (kills the activation cliff).
    const provider = createEmbeddingProvider({ ...config, embeddingBaseURL: undefined });
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });
});
