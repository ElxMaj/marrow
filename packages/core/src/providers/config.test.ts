import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmbeddingProvider,
  createTranscriptionProvider,
  createVisionProvider,
  loadProviderConfig,
  type ProviderConfig,
} from "./config.js";
import { DEFAULT_LOCAL_EMBEDDING_MODEL, LocalEmbeddingProvider } from "./local-embedding.js";
import { OpenAICompatibleEmbeddingAdapter } from "./openai-compatible.js";
import { OpenAICompatibleTranscriptionAdapter } from "./transcription.js";
import { ClaudeVisionAdapter, OpenAICompatibleVisionAdapter } from "./vision.js";

// WHY: a user with only a model key (MARROW_API_KEY for Claude, which has NO
// embeddings API) used to get embedding=undefined and canDistill=false, so
// distillation was impossible without standing up a SECOND endpoint. That
// activation cliff is the bug. embeddings must now default to a zero-config
// in-process local model so a model-key-only user can distill out of the box,
// while a configured remote/Ollama endpoint still wins.

const claudeOnly = (): ProviderConfig =>
  loadProviderConfig({ MARROW_PROVIDER: "claude", MARROW_API_KEY: "k" });

describe("createEmbeddingProvider zero-config fallback", () => {
  it("uses the configured remote/Ollama endpoint when one is set, so an explicit endpoint still wins", () => {
    const config: ProviderConfig = {
      ...claudeOnly(),
      embeddingBaseURL: "http://localhost:11434/v1",
    };
    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(OpenAICompatibleEmbeddingAdapter);
  });

  it("falls back to the in-process local embedder when no endpoint is set, killing the activation cliff", () => {
    // claude has no embeddings API and no MARROW_EMBEDDING_BASE_URL was given.
    // before this fix that threw; now a model-key-only user can distill.
    const config: ProviderConfig = { ...claudeOnly(), embeddingBaseURL: undefined };
    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
    expect(provider.model).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
  });
});

describe("loadProviderConfig: local embedding model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults localEmbeddingModel to the bundled MiniLM model so distillation needs zero extra setup", () => {
    const config = loadProviderConfig({ MARROW_PROVIDER: "claude", MARROW_API_KEY: "k" });
    expect(config.localEmbeddingModel).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
  });

  it("honors MARROW_LOCAL_EMBEDDING_MODEL so a self-hoster can swap the local model", () => {
    const config = loadProviderConfig({
      MARROW_PROVIDER: "claude",
      MARROW_API_KEY: "k",
      MARROW_LOCAL_EMBEDDING_MODEL: "Xenova/bge-small-en-v1.5",
    });
    expect(config.localEmbeddingModel).toBe("Xenova/bge-small-en-v1.5");
  });

  it("names the configured local model in the one-time load notice", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    vi.doMock("@huggingface/transformers", () => ({
      pipeline: async () => async () => ({ tolist: () => [[0.1, 0.2, 0.3]] }),
    }));

    const provider = new LocalEmbeddingProvider("Xenova/bge-small-en-v1.5");
    const result = await provider.embed(["hello"]);

    expect(result.model).toBe("Xenova/bge-small-en-v1.5");
    expect(writes.join("")).toContain("Xenova/bge-small-en-v1.5");
    expect(writes.join("")).not.toContain(DEFAULT_LOCAL_EMBEDDING_MODEL);
  });
});

describe("optional artifact provider factories", () => {
  it("creates vision providers only when the configured provider can support image input", () => {
    const claude = claudeOnly();
    expect(createVisionProvider({ ...claude, apiKey: undefined })).toBeUndefined();
    expect(createVisionProvider(claude)).toBeInstanceOf(ClaudeVisionAdapter);

    const openaiCompatible: ProviderConfig = {
      ...claude,
      provider: "openai-compatible",
      model: "local-vision",
      apiKey: undefined,
      baseURL: undefined,
    };
    expect(createVisionProvider(openaiCompatible)).toBeUndefined();
    expect(
      createVisionProvider({ ...openaiCompatible, baseURL: "http://localhost:11434/v1" }),
    ).toBeInstanceOf(OpenAICompatibleVisionAdapter);
  });

  it("creates transcription providers only when an OpenAI-shaped audio endpoint is configured", () => {
    const config = claudeOnly();
    expect(createTranscriptionProvider({ ...config, baseURL: undefined })).toBeUndefined();

    const provider = createTranscriptionProvider({
      ...config,
      baseURL: "http://localhost:11434/v1",
      transcriptionModel: "whisper-1",
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleTranscriptionAdapter);
    expect(provider?.model).toBe("whisper-1");

    const custom = createTranscriptionProvider({
      ...config,
      baseURL: "http://localhost:11434/v1",
      transcriptionModel: "whisper-large-v3",
    });
    expect(custom?.model).toBe("whisper-large-v3");
  });
});
