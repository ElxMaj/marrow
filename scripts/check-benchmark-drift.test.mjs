import assert from "node:assert/strict";
import { test } from "node:test";

import { firstDifference, stripNondeterministic } from "./check-benchmark-drift.mjs";

test("stripNondeterministic drops latency and wall-clock fields at every depth", () => {
  const stripped = stripNondeterministic({
    ratio: 2.9,
    marrow: {
      avgLatencyMs: 3.1,
      questions: [{ question: "q", tokens: 10, latencyMs: 4 }],
    },
    evals: { write: { ingestionReadyP95Ms: 12, falseMemoryRate: 0 } },
  });
  assert.deepEqual(stripped, {
    ratio: 2.9,
    marrow: { questions: [{ question: "q", tokens: 10 }] },
    evals: { write: { falseMemoryRate: 0 } },
  });
});

test("firstDifference names the exact drifted path and passes on equal reports", () => {
  const committed = { ratio: 2.9, evals: { write: { falseMemoryRate: 0 } } };
  const same = { ratio: 2.9, evals: { write: { falseMemoryRate: 0 } } };
  assert.equal(firstDifference(committed, same), null);

  const drifted = { ratio: 3.4, evals: { write: { falseMemoryRate: 0 } } };
  assert.match(firstDifference(committed, drifted), /report\.ratio: committed 2\.9/);

  const missing = { evals: { write: { falseMemoryRate: 0 } } };
  assert.match(firstDifference(committed, missing), /report\.ratio/);
});
