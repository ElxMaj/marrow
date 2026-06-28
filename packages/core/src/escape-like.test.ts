import { describe, expect, it } from "vitest";

import { escapeLike } from "./store.js";

// Search wraps the user query in %...% for ILIKE. Without escaping, a query
// containing % or _ would act as a wildcard (e.g. "100%" matching everything).
describe("escapeLike", () => {
  it("escapes the LIKE wildcards % and _", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes a literal backslash so the escape char itself is literal", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("magic links")).toBe("magic links");
  });
});
