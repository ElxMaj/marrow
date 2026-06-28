import { describe, expect, it } from "vitest";

import { MARROW_DOCS_URL } from "./views/Settings";

describe("Settings docs link", () => {
  it("points to repo docs instead of the marketing root", () => {
    expect(MARROW_DOCS_URL).toBe("https://github.com/ElxMaj/marrow#readme");
  });
});
