// The one page-level truth propagation: Exhibit A's promote flips the slice
// row, the colophon tally and the live announcement. A 20-line store instead
// of context wrapping the page; the terminal's promote deliberately does NOT
// write here (it is recorded in the reenactment only).
let decided = false;
const subs = new Set<() => void>();

export function promoteDecided() {
  if (decided) return;
  decided = true;
  subs.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export const getDecided = () => decided;
export const getServerDecided = () => false;
