import { expect, test } from "@playwright/test";

// The pre-launch gate for the exported page: the scanline reads the room
// sheet, the terminal waits on the human, the promote ceremony propagates,
// and the no-JS document is already finished. WebKit is the iOS Safari bar.

test.describe("the room", () => {
  test("the scanline reads the sheet and leaves the span lit", async ({ page }) => {
    await page.goto("/");
    await page.locator("#room .room-sheet").scrollIntoViewIfNeeded();
    await expect(page.locator("#room .room-sheet")).toHaveClass(/scanned/, { timeout: 5000 });
    // the mark develops after the pass: gold wash, readable ink.
    await expect
      .poll(
        () =>
          page
            .locator("#room .room-sheet mark")
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        { timeout: 5000 },
      )
      .not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("the terminal", () => {
  test("gates on the human, then finishes the promoted run", async ({ page }) => {
    await page.goto("/");
    await page.locator("#run").scrollIntoViewIfNeeded();
    const advance = page.locator(".term-advance");
    await advance.click(); // run: types the command
    await expect(page.locator(".term-log")).toContainText("Ingested interviews/design-partner.md", {
      timeout: 5000,
    });
    await advance.click(); // distill
    await expect(page.locator(".term-log")).toContainText("Distilled 1 decision");
    await advance.click(); // question
    await expect(page.locator(".term-prompt")).toBeVisible();
    await expect(advance).toBeDisabled(); // the run waits on the visitor

    await page.locator(".term-prompt .btn-promote").click();
    await expect(page.locator(".term-log")).toContainText("Confidence 1.00 (human)");
    await advance.click(); // prepare_task
    await expect(page.locator(".term-log")).toContainText("4 task-scoped results", {
      timeout: 5000,
    });
    await expect(page.locator(".term-log")).toContainText("Still open: 1 question.");
    await expect(page.locator(".term-log")).toContainText("Star the repo");
  });

  test("respects leave it open", async ({ page }) => {
    await page.goto("/");
    await page.locator("#run").scrollIntoViewIfNeeded();
    const advance = page.locator(".term-advance");
    await advance.click();
    await expect(page.locator(".term-log")).toContainText("Ingested", { timeout: 5000 });
    await advance.click();
    await expect(page.locator(".term-log")).toContainText("Distilled");
    await advance.click();
    await page.locator(".btn-leave").click();
    await expect(page.locator(".term-log")).toContainText("Left open");
    await advance.click();
    await expect(page.locator(".term-log")).toContainText("Still open: 2 questions.", {
      timeout: 5000,
    });
  });
});

test.describe("the ceremony", () => {
  test("the visitor's promote propagates to the slice and the tally", async ({ page }) => {
    await page.goto("/");
    await page.locator("#promote .sheet").first().scrollIntoViewIfNeeded();
    const promote = page.locator("#promote .btn-promote");
    await expect(promote).toBeVisible({ timeout: 6000 });
    await page.locator("#promote .answer-input").fill("yes, links only");
    await promote.click();
    await expect(page.locator("#promote")).toHaveAttribute("data-stage", "decided");
    await expect(page.locator("#promote .pill-live")).toHaveText("decided");
    await expect(page.locator("#slice .fact-row").first()).toContainText("decided");
    await expect(page.locator("#slice")).toContainText("You decided this, just now");
    await expect(page.locator("#tally")).toContainText("2 decided");
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the page is a finished document", async ({ page }) => {
    await page.goto("/");
    // the loop already ran: decided fact at human confidence, transcript done.
    await expect(page.locator("#promote .conf-final")).toBeVisible();
    await expect(page.locator("#promote .pill-final")).toBeVisible();
    await expect(page.locator("#promote .answer-row")).toBeHidden();
    await expect(page.locator(".term-log")).toContainText("4 task-scoped results");
    await expect(page.locator(".term-controls")).toBeHidden();
    // the room's span is lit without any scanline running.
    await expect(page.locator("#room .room-sheet mark")).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the ceremony still lands, without the theater", async ({ page }) => {
    await page.goto("/");
    await page.locator("#promote .sheet").first().scrollIntoViewIfNeeded();
    const promote = page.locator("#promote .btn-promote");
    await expect(promote).toBeVisible({ timeout: 6000 });
    await promote.click();
    await expect(page.locator("#promote")).toHaveAttribute("data-stage", "decided");
    await expect(page.locator("#promote .conf")).toHaveText("1.00");
  });
});
