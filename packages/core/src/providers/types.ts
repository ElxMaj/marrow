// The model and embeddings sit behind these two thin interfaces. Core depends
// only on the interfaces; the concrete vendor lives in an adapter file and is
// chosen by config. This is what lets a self-hoster bring their own keys or run
// fully local without touching any core logic.

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Token usage for one completion, when the provider reports it. */
export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A completion plus optional usage. Usage is omitted when the provider does
 *  not surface it (a scripted demo model, some local servers). */
export interface CompletionResult {
  text: string;
  usage?: CompletionUsage;
}

export interface ModelProvider {
  readonly model: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
  /**
   * Optional: like complete, but also returns token usage when the provider
   * surfaces it. Used for observability and cost accounting. Providers that
   * cannot report usage omit this; callers then fall back to complete() and an
   * estimate, never a fabricated exact count.
   */
  completeDetailed?(prompt: string, opts?: CompleteOptions): Promise<CompletionResult>;
}

export interface EmbeddingResult {
  vectors: number[][];
  /** The model that produced the vectors, stored alongside them in PR-02. */
  model: string;
  /** The dimension of each vector, surfaced from the provider, never assumed. */
  dim: number;
}

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<EmbeddingResult>;
}

/** Optional. Turns a non-text artifact (whiteboard photo, voice memo) into the
 *  evidence text the rest of the pipeline already understands. Behind the
 *  provider interface so it stays optional and swappable. */
export interface VisionProvider {
  readonly model: string;
  describeImage(image: Uint8Array, mediaType?: string): Promise<string>;
}

export interface TranscriptionProvider {
  readonly model: string;
  transcribe(audio: Uint8Array, mediaType?: string): Promise<string>;
}
