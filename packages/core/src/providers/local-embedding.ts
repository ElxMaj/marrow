import { type EmbeddingProvider, type EmbeddingResult } from "./types.js";

/** The bundled local embedding model. small (~25MB), runs in-process via
 *  @huggingface/transformers, good enough to make distillation work with zero
 *  embedding setup. Override with MARROW_LOCAL_EMBEDDING_MODEL. */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

// The transformers pipeline is typed loosely (optional dep, no ambient types in
// core), so we narrow exactly what we call here and nothing more.
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

/**
 * An in-process embedding provider. It removes the activation cliff: a user with
 * only a model key (e.g. Claude, which has no embeddings API) can distill with
 * no second endpoint. The model is downloaded once and cached by the transformers
 * runtime; the pipeline is built lazily and reused across calls.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private extractor: Promise<Extractor> | undefined;
  private announced = false;

  constructor(model: string = DEFAULT_LOCAL_EMBEDDING_MODEL) {
    this.model = model;
  }

  private load(): Promise<Extractor> {
    if (!this.extractor) {
      if (!this.announced) {
        this.announced = true;
        process.stderr.write(
          `marrow: loading local embedding model (${this.model}, one-time download)\n`,
        );
      }
      this.extractor = (async (): Promise<Extractor> => {
        let mod: { pipeline: (task: string, model: string) => Promise<unknown> };
        try {
          mod = (await import("@huggingface/transformers")) as typeof mod;
        } catch {
          throw new Error(
            "local embeddings need the optional @huggingface/transformers package. " +
              "install it, or set MARROW_EMBEDDING_BASE_URL to a remote/Ollama embedding endpoint.",
          );
        }
        return (await mod.pipeline("feature-extraction", this.model)) as Extractor;
      })();
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const extractor = await this.load();
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    const vectors = out.tolist();
    const first = vectors[0];
    return { vectors, model: this.model, dim: first?.length ?? 384 };
  }
}
