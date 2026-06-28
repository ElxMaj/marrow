export {
  type CompleteOptions,
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
  type VisionProvider,
  type TranscriptionProvider,
} from "./types.js";
export { ClaudeVisionAdapter, OpenAICompatibleVisionAdapter } from "./vision.js";
export { OpenAICompatibleTranscriptionAdapter } from "./transcription.js";
export { ClaudeAdapter, type ClaudeAdapterConfig } from "./claude.js";
export {
  OpenAICompatibleAdapter,
  OpenAICompatibleEmbeddingAdapter,
  type OpenAICompatibleConfig,
} from "./openai-compatible.js";
export { LocalEmbeddingProvider, DEFAULT_LOCAL_EMBEDDING_MODEL } from "./local-embedding.js";
export {
  loadProviderConfig,
  createModelProvider,
  createEmbeddingProvider,
  createVisionProvider,
  createTranscriptionProvider,
  type ProviderConfig,
  type ProviderName,
} from "./config.js";
