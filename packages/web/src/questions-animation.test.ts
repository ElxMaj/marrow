import { describe, expect, it } from "vitest";

import {
  glidePromoteSiblings,
  promoteLeaveDelayMs,
  promoteSettleDelayMs,
  promoteToastMessage,
  runPromoteTravel,
  shouldRunPromoteTravel,
} from "./views/Questions";

function rect(left: number, top: number, width = 100, height = 40): DOMRect {
  return { left, top, width, height } as DOMRect;
}

class FakeElement {
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  removed = false;
  animations: { frames: unknown; options: unknown }[] = [];

  constructor(
    private readonly box: DOMRect,
    private readonly clone?: FakeElement,
    private readonly finished: () => Promise<void> = () => Promise.resolve(),
  ) {}

  getBoundingClientRect(): DOMRect {
    return this.box;
  }

  cloneNode(): FakeElement {
    return this.clone ?? new FakeElement(this.box);
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  animate(frames: unknown, options: unknown): { finished: Promise<void> } {
    this.animations.push({ frames, options });
    return { finished: this.finished() };
  }

  remove(): void {
    this.removed = true;
  }
}

function asElement(el: FakeElement): HTMLElement {
  return el as unknown as HTMLElement;
}

function bodyFor(appended: FakeElement[]): { appendChild(node: Node): Node } {
  return {
    appendChild(node: Node): Node {
      appended.push(node as unknown as FakeElement);
      return node;
    },
  };
}

describe("shouldRunPromoteTravel", () => {
  it("runs only when there is a source rect, motion is allowed, and the viewport is wide", () => {
    expect(
      shouldRunPromoteTravel({ hasFromRect: true, reduceMotion: false, viewportWidth: 821 }),
    ).toBe(true);
    expect(
      shouldRunPromoteTravel({ hasFromRect: false, reduceMotion: false, viewportWidth: 1200 }),
    ).toBe(false);
    expect(
      shouldRunPromoteTravel({ hasFromRect: true, reduceMotion: true, viewportWidth: 1200 }),
    ).toBe(false);
    expect(
      shouldRunPromoteTravel({ hasFromRect: true, reduceMotion: false, viewportWidth: 820 }),
    ).toBe(false);
  });
});

describe("promote animation timing", () => {
  it("keeps the leave and settle delays unless reduced motion is active", () => {
    expect(promoteLeaveDelayMs(false)).toBe(360);
    expect(promoteSettleDelayMs(false)).toBe(1100);
    expect(promoteLeaveDelayMs(true)).toBe(0);
    expect(promoteSettleDelayMs(true)).toBe(0);
  });
});

describe("promoteToastMessage", () => {
  it("names promoted and answered outcomes for saved and sandbox modes", () => {
    expect(promoteToastMessage({ promotedCount: 1, readOnly: false })).toBe(
      "Decided · traced to your answer",
    );
    expect(promoteToastMessage({ promotedCount: 1, readOnly: true })).toBe(
      "Decided · sandbox, nothing saved",
    );
    expect(promoteToastMessage({ promotedCount: 0, readOnly: false })).toBe(
      "Answered · recorded as evidence",
    );
    expect(promoteToastMessage({ promotedCount: 0, readOnly: true })).toBe(
      "Answered · sandbox, nothing saved",
    );
  });
});

describe("runPromoteTravel", () => {
  it("appends a ghost, runs the travel animation, then reveals the real card", async () => {
    const ghost = new FakeElement(rect(100, 200, 300, 120));
    const node = new FakeElement(rect(100, 200, 300, 120), ghost);
    const appended: FakeElement[] = [];

    await runPromoteTravel({
      nodeId: "dec_1",
      from: rect(20, 80),
      cards: new Map([["dec_1", asElement(node)]]),
      body: bodyFor(appended),
      reduceMotion: false,
      viewportWidth: 1200,
      waitForFrame: async () => {},
    });

    expect(appended).toEqual([ghost]);
    expect(ghost.attrs["aria-hidden"]).toBe("true");
    expect(ghost.style).toMatchObject({
      position: "fixed",
      left: "100px",
      top: "200px",
      width: "300px",
      height: "120px",
      pointerEvents: "none",
    });
    expect(node.style.opacity).toBe("");
    expect(ghost.removed).toBe(true);
    expect(ghost.animations).toEqual([
      {
        frames: [
          { transform: "translate(-80px, -120px)", opacity: 0.4 },
          { transform: "translate(0, 0)", opacity: 1 },
        ],
        options: { duration: 420, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
      },
    ]);
  });

  it("still removes the ghost and reveals the card when animation is interrupted", async () => {
    const ghost = new FakeElement(rect(100, 200, 300, 120), undefined, () =>
      Promise.reject(new Error("interrupted")),
    );
    const node = new FakeElement(rect(100, 200, 300, 120), ghost);

    await runPromoteTravel({
      nodeId: "dec_1",
      from: rect(20, 80),
      cards: new Map([["dec_1", asElement(node)]]),
      body: bodyFor([]),
      reduceMotion: false,
      viewportWidth: 1200,
      waitForFrame: async () => {},
    });

    expect(ghost.removed).toBe(true);
    expect(node.style.opacity).toBe("");
  });
});

describe("glidePromoteSiblings", () => {
  it("FLIPs displaced sibling cards and skips the promoted node", () => {
    const promoted = new FakeElement(rect(0, 0));
    const sibling = new FakeElement(rect(0, 150));
    const unchanged = new FakeElement(rect(0, 300));

    glidePromoteSiblings({
      before: new Map([
        ["dec_promoted", rect(0, 0)],
        ["dec_sibling", rect(0, 200)],
        ["dec_unchanged", rect(0, 301)],
      ]),
      cards: new Map([
        ["dec_promoted", asElement(promoted)],
        ["dec_sibling", asElement(sibling)],
        ["dec_unchanged", asElement(unchanged)],
      ]),
      skip: new Set(["dec_promoted"]),
      reduceMotion: false,
    });

    expect(promoted.animations).toEqual([]);
    expect(unchanged.animations).toEqual([]);
    expect(sibling.animations).toEqual([
      {
        frames: [{ transform: "translateY(50px)" }, { transform: "translateY(0)" }],
        options: { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      },
    ]);
  });
});
