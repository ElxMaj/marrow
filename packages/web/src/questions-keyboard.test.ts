import { describe, expect, it } from "vitest";

import { questionInputKeyIntent, questionKeyboardIntent } from "./views/Questions";

describe("questionKeyboardIntent", () => {
  it("ignores shortcuts while typing, with modifier keys, or when the source panel is open", () => {
    expect(
      questionKeyboardIntent({ key: "j", typing: true, cardCount: 2, currentIndex: 0 }),
    ).toEqual({ action: "none" });
    expect(
      questionKeyboardIntent({ key: "j", metaKey: true, cardCount: 2, currentIndex: 0 }),
    ).toEqual({ action: "none" });
    expect(
      questionKeyboardIntent({ key: "j", sourcePanelOpen: true, cardCount: 2, currentIndex: 0 }),
    ).toEqual({ action: "none" });
  });

  it("moves focus with j/k and clamps to the available card range", () => {
    expect(questionKeyboardIntent({ key: "j", cardCount: 3, currentIndex: 0 })).toEqual({
      action: "focus-card",
      index: 1,
    });
    expect(questionKeyboardIntent({ key: "j", cardCount: 3, currentIndex: 2 })).toEqual({
      action: "focus-card",
      index: 2,
    });
    expect(questionKeyboardIntent({ key: "k", cardCount: 3, currentIndex: 0 })).toEqual({
      action: "focus-card",
      index: 0,
    });
    expect(questionKeyboardIntent({ key: "k", cardCount: 3, currentIndex: 2 })).toEqual({
      action: "focus-card",
      index: 1,
    });
  });

  it("focuses the first answer input with slash", () => {
    expect(questionKeyboardIntent({ key: "/", cardCount: 2, currentIndex: 0 })).toEqual({
      action: "focus-first-answer",
    });
  });

  it("focuses a question answer on Enter and traces a node on t", () => {
    expect(
      questionKeyboardIntent({
        key: "Enter",
        activeCardKind: "question",
        cardCount: 2,
        currentIndex: 0,
      }),
    ).toEqual({ action: "focus-active-answer" });
    expect(
      questionKeyboardIntent({
        key: "t",
        activeCardKind: "node",
        cardCount: 2,
        currentIndex: 1,
      }),
    ).toEqual({ action: "trace-active-node" });
  });
});

describe("questionInputKeyIntent", () => {
  it("answers on Enter and blurs on Escape", () => {
    expect(questionInputKeyIntent("Enter")).toBe("answer");
    expect(questionInputKeyIntent("Escape")).toBe("blur");
    expect(questionInputKeyIntent("j")).toBe("none");
  });
});
