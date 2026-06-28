import { ClaudeAdapter } from "./claude.js";
import { DEFAULT_LOCAL_EMBEDDING_MODEL, LocalEmbeddingProvider } from "./local-embedding.js";
import { OpenAICompatibleAdapter, OpenAICompatibleEmbeddingAdapter } from "./openai-compatible.js";
import { OpenAICompatibleTranscriptionAdapter } from "./transcription.js";
import {
  type EmbeddingProvider,
  type ModelProvider,
  type TranscriptionProvider,
  type VisionProvider,
} from "./types.js";
import { ClaudeVisionAdapter, OpenAICompatibleVisionAdapter } from "./vision.js";

export type ProviderName = "claude" | "openai-compatible";

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string | undefined;
  baseURL: string | undefined;
  embeddingModel: string;
  embeddingBaseURL: string | undefined;
  embeddingApiKey: string | undefined;
  localEmbeddingModel: string;
  transcriptionModel: string;
}

// Mid tier on purpose: distillation runs in bulk, so the default is not the
// most expensive model. Override with MARROW_MODEL.
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

type Env = Record<string, string | undefined>;

/**
 * Read provider config from the environment and fail loud on anything missing,
 * never silently default to a wrong provider. Supported env:
 *   MARROW_PROVIDER         claude | openai-compatible (default claude)
 *   MARROW_MODEL            model id (default mid-tier Claude)
 *   MARROW_API_KEY          required for claude
 *   MARROW_BASE_URL         required for openai-compatible (e.g. local Ollama)
 *   MARROW_EMBEDDING_MODEL  embedding model id
 *   MARROW_EMBEDDING_BASE_URL / MARROW_EMBEDDING_API_KEY  embedding endpoint
 */
export function loadProviderConfig(env: Env = process.env): ProviderConfig {
  const provider = env.MARROW_PROVIDER ?? "claude";
  if (provider !== "claude" && provider !== "openai-compatible") {
    throw new Error(`unknown MARROW_PROVIDER "${provider}". Use "claude" or "openai-compatible".`);
  }

  const apiKey = env.MARROW_API_KEY;
  const baseURL = env.MARROW_BASE_URL;
  const model = env.MARROW_MODEL ?? (provider === "claude" ? DEFAULT_CLAUDE_MODEL : undefined);

  if (provider === "claude" && !apiKey) {
    throw new Error(
      "MARROW_API_KEY is required for the claude provider. Set it, or switch MARROW_PROVIDER to openai-compatible.",
    );
  }
  if (provider === "openai-compatible" && !baseURL) {
    throw new Error(
      "MARROW_BASE_URL is required for the openai-compatible provider (e.g. http://localhost:11434/v1 for Ollama).",
    );
  }
  if (!model) {
    throw new Error("MARROW_MODEL is required for the openai-compatible provider.");
  }

  return {
    provider,
    model,
    apiKey,
    baseURL,
    embeddingModel: env.MARROW_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    embeddingBaseURL: env.MARROW_EMBEDDING_BASE_URL ?? baseURL,
    embeddingApiKey: env.MARROW_EMBEDDING_API_KEY ?? apiKey,
    localEmbeddingModel: env.MARROW_LOCAL_EMBEDDING_MODEL ?? DEFAULT_LOCAL_EMBEDDING_MODEL,
    transcriptionModel: env.MARROW_TRANSCRIPTION_MODEL ?? "whisper-1",
  };
}

/** Pick the model adapter from config. Core never names a vendor; this does. */
export function createModelProvider(config: ProviderConfig): ModelProvider {
  if (config.provider === "claude") {
    return new ClaudeAdapter({
      apiKey: config.apiKey ?? "",
      model: config.model,
      ...(config.baseURL !== undefined ? { baseURL: config.baseURL } : {}),
    });
  }
  return new OpenAICompatibleAdapter({
    baseURL: config.baseURL ?? "",
    model: config.model,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
  });
}

/** Embeddings default to a zero-config in-process local model so a user with
 *  only a model key (Claude has no embeddings API) can distill with no second
 *  endpoint, killing the activation cliff. Setting MARROW_EMBEDDING_BASE_URL
 *  (e.g. an Ollama endpoint) overrides the local model with that remote, which
 *  goes through an OpenAI-shaped endpoint. */
export function createEmbeddingProvider(config: ProviderConfig): EmbeddingProvider {
  if (!config.embeddingBaseURL) {
    return new LocalEmbeddingProvider(config.localEmbeddingModel);
  }
  return new OpenAICompatibleEmbeddingAdapter({
    baseURL: config.embeddingBaseURL,
    model: config.embeddingModel,
    ...(config.embeddingApiKey !== undefined ? { apiKey: config.embeddingApiKey } : {}),
  });
}

/** Optional vision provider, reusing the model provider's config (a
 *  vision-capable model). Returns undefined when nothing is configured, so
 *  image ingestion fails loud rather than guessing. */
export function createVisionProvider(config: ProviderConfig): VisionProvider | undefined {
  if (config.provider === "claude") {
    if (!config.apiKey) return undefined;
    return new ClaudeVisionAdapter({
      apiKey: config.apiKey,
      model: config.model,
      ...(config.baseURL !== undefined ? { baseURL: config.baseURL } : {}),
    });
  }
  if (!config.baseURL) return undefined;
  return new OpenAICompatibleVisionAdapter({
    baseURL: config.baseURL,
    model: config.model,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
  });
}

/** Optional transcription provider. Needs an OpenAI-shaped audio endpoint
 *  (Anthropic has no audio API), so it returns undefined unless a base url is
 *  configured; audio ingestion then fails loud rather than guessing. */
export function createTranscriptionProvider(
  config: ProviderConfig,
): TranscriptionProvider | undefined {
  if (!config.baseURL) return undefined;
  return new OpenAICompatibleTranscriptionAdapter({
    baseURL: config.baseURL,
    model: config.transcriptionModel,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
  });
}
