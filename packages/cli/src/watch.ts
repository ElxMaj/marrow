import { createHash } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import { type Marrow } from "@marrowhq/core";

// transcript extensions we know how to ingest in a directory sweep.
const WATCHED_EXT = new Set([
  ".vtt",
  ".srt",
  ".json",
  ".txt",
  ".md",
  ".markdown",
  ".text",
  ".m4a",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".webm",
  ".flac",
  ".mp4",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

interface WatchOptions {
  folder: string;
  core: Marrow;
  distill: boolean;
  debounceMs: number;
  onEvent?: (message: string) => void;
  onIngested?: (path: string) => void;
}

function fileKey(path: string, mtime: number): string {
  return createHash("sha256").update(`${path}:${mtime}`).digest("hex");
}

async function* walkFiles(folder: string): AsyncGenerator<string> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile() && WATCHED_EXT.has(extname(entry.name).toLowerCase())) yield full;
  }
}

export async function watchFolder(options: WatchOptions): Promise<FSWatcher> {
  const { folder, core, distill, debounceMs } = options;
  const log = options.onEvent ?? ((m: string) => console.log(m));
  const processed = new Set<string>();

  const ingestFile = async (path: string): Promise<void> => {
    const s = await stat(path).catch(() => undefined);
    if (!s || !s.isFile()) return;
    const key = fileKey(path, s.mtimeMs);
    if (processed.has(key)) return;
    processed.add(key);

    const mediaType = (table: Record<string, string>, fallback: string): string =>
      table[extname(path).toLowerCase()] ?? fallback;

    try {
      const { readFileSync } = await import("node:fs");
      const bytes = readFileSync(path);
      const lower = path.toLowerCase();
      if (lower.match(/\.(m4a|mp3|wav|ogg|oga|webm|flac|mp4)$/)) {
        const id = await core.ingestAudio(
          new Uint8Array(bytes),
          path,
          mediaType(
            {
              ".m4a": "audio/m4a",
              ".mp3": "audio/mpeg",
              ".wav": "audio/wav",
              ".ogg": "audio/ogg",
              ".oga": "audio/ogg",
              ".webm": "audio/webm",
              ".flac": "audio/flac",
              ".mp4": "audio/mp4",
            },
            "audio/m4a",
          ),
        );
        if (distill) {
          await core.distill(id);
          await core.linkAndMerge(id);
        }
      } else if (lower.match(/\.(png|jpg|jpeg|gif|webp)$/)) {
        const id = await core.ingestImage(
          new Uint8Array(bytes),
          path,
          mediaType(
            {
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".webp": "image/webp",
            },
            "image/png",
          ),
        );
        if (distill) {
          await core.distill(id);
          await core.linkAndMerge(id);
        }
      } else {
        const text = bytes.toString("utf8");
        const { normalizeTranscript } = await import("@marrowhq/core");
        const norm = normalizeTranscript(text, { filename: path });
        if (distill && core.canDistill) {
          await core.ingestAndDistill({ text: norm.text, source: path });
        } else {
          await core.ingest({ text: norm.text, source: path });
        }
      }
      log(`Ingested ${path}`);
      options.onIngested?.(path);
    } catch (err) {
      log(`Failed to ingest ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const ingestUnseenFiles = async (): Promise<void> => {
    for await (const path of walkFiles(folder)) {
      if (await core.hasEvidenceSource(path)) continue;
      await ingestFile(path);
    }
  };

  // seed already-present files once, so starting the watcher does not miss
  // anything dropped into the folder before it booted. skip any file whose
  // source is already in the store, so a restart does not re-ingest the whole
  // folder as duplicate evidence (F-CLI-014). live edits below still re-ingest
  // via the mtime-keyed `processed` set.
  await ingestUnseenFiles();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();

  const flush = async (): Promise<void> => {
    timer = undefined;
    const batch = Array.from(pending);
    pending.clear();
    for (const path of batch) await ingestFile(path);
  };

  const onChange = (_eventType: string, filename: string | Buffer | null): void => {
    if (!filename) return;
    const path = join(folder, filename.toString());
    pending.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  // recursive watch is unsupported on some platforms (notably Linux) where
  // fs.watch throws synchronously; fall back to a non-recursive watch on the
  // top folder rather than letting the throw escape and crash the caller
  // (F-CLI-014).
  let watcher: FSWatcher;
  try {
    watcher = watch(folder, { recursive: true }, onChange);
  } catch {
    log(`recursive watch unavailable on this platform; watching ${folder} non-recursively`);
    watcher = watch(folder, onChange);
  }

  watcher.on("error", (err) => log(`Watch error: ${err.message}`));

  const catchUpTimer = setTimeout(() => {
    void ingestUnseenFiles();
  }, debounceMs);
  const close = watcher.close.bind(watcher);
  watcher.close = () => {
    if (timer) clearTimeout(timer);
    clearTimeout(catchUpTimer);
    return close();
  };

  return watcher;
}
