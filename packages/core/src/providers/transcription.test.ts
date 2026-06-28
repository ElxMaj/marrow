import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleTranscriptionAdapter } from "./transcription.js";

describe("OpenAICompatibleTranscriptionAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts multipart audio bytes and returns transcript text", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ text: "hello from the standup" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAICompatibleTranscriptionAdapter({
      apiKey: "transcribe-key",
      model: "whisper-test",
      baseURL: "https://openai-compatible.test/v1/",
    });
    const text = await adapter.transcribe(new Uint8Array([1, 2, 3]), "audio/wav");

    expect(text).toBe("hello from the standup");
    const call = fetchMock.mock.calls[0];
    if (!call?.[1]) throw new Error("expected a fetch call");
    const [url, init] = call;
    expect(String(url)).toBe("https://openai-compatible.test/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer transcribe-key" });
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-test");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("audio/wav");
    expect([...new Uint8Array(await (file as Blob).arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("throws with provider status and body on non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad audio", { status: 503 })),
    );
    const adapter = new OpenAICompatibleTranscriptionAdapter({
      baseURL: "https://openai-compatible.test/v1",
      model: "whisper-test",
    });

    await expect(adapter.transcribe(new Uint8Array([1]))).rejects.toThrow(
      /transcription: request failed 503 bad audio/,
    );
  });
});
