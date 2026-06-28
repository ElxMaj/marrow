import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaudeVisionAdapter, OpenAICompatibleVisionAdapter } from "./vision.js";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("ClaudeVisionAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a base64 image block and returns concatenated text blocks", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ content: [{ text: "whiteboard: " }, {}, { text: "magic links" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new ClaudeVisionAdapter({
      apiKey: "anthropic-key",
      model: "claude-vision-test",
      baseURL: "https://anthropic.test/",
    });
    const text = await adapter.describeImage(new Uint8Array([1, 2, 3]), "image/jpeg");

    expect(text).toBe("whiteboard: magic links");
    const call = fetchMock.mock.calls[0];
    if (!call?.[1]) throw new Error("expected a fetch call");
    const [url, init] = call;
    expect(String(url)).toBe("https://anthropic.test/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-vision-test");
    expect(body.max_tokens).toBe(2048);
    expect(body.messages[0].content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AQID" },
    });
    expect(body.messages[0].content[1].text).toContain("Transcribe");
  });

  it("throws with provider status and body on non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad image", { status: 500 })),
    );
    const adapter = new ClaudeVisionAdapter({ apiKey: "k", model: "m" });

    await expect(adapter.describeImage(new Uint8Array([1]))).rejects.toThrow(
      /vision \(claude\): request failed 500 bad image/,
    );
  });
});

describe("OpenAICompatibleVisionAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts an image_url data URL and returns the first message content", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "whiteboard text" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAICompatibleVisionAdapter({
      apiKey: "openai-key",
      model: "gpt-vision-test",
      baseURL: "https://openai-compatible.test/v1/",
    });
    const text = await adapter.describeImage(new Uint8Array([4, 5]), "image/png");

    expect(text).toBe("whiteboard text");
    const call = fetchMock.mock.calls[0];
    if (!call?.[1]) throw new Error("expected a fetch call");
    const [url, init] = call;
    expect(String(url)).toBe("https://openai-compatible.test/v1/chat/completions");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer openai-key",
    });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-vision-test");
    expect(body.messages[0].content[0].text).toContain("Transcribe");
    expect(body.messages[0].content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,BAU=" },
    });
  });

  it("throws with provider status and body on non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no vision", { status: 502 })),
    );
    const adapter = new OpenAICompatibleVisionAdapter({
      baseURL: "https://local.test",
      model: "m",
    });

    await expect(adapter.describeImage(new Uint8Array([1]))).rejects.toThrow(
      /vision \(openai-compatible\): request failed 502 no vision/,
    );
  });
});
