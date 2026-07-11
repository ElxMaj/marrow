import { normalizeTitle } from "./link.js";

// Graph-hygiene helpers, kept pure so they are testable in isolation. lint is a
// read-only sweep: it reports duplicates, contradictions, and dead edges so a
// human can clean the graph. It never resolves or deletes a distilled fact.

/**
 * Group nodes that share a normalized title (a likely duplicate). Returns only
 * the groups with more than one node. Nodes with an empty normalized title are
 * ignored (nothing distinctive to dedupe on).
 */
export function findDuplicateTitles<T extends { id: string }>(
  nodes: T[],
  titleOf: (node: T) => string,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const node of nodes) {
    const key = normalizeTitle(titleOf(node));
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
