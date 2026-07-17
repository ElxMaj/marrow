// JS mirror of the motion tokens in app/globals.css. The CSS file is the
// source of truth; scripts/check-ids.mjs asserts the two never drift.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_MARKER = [0.65, 0, 0.35, 1] as const;
export const EASE_SPRING = [0.34, 1.45, 0.6, 1] as const;

export const DUR = {
  press: 0.14,
  base: 0.2,
  settle: 0.32,
  rise: 0.36,
  sweep: 0.46,
  lift: 0.56,
  spring: 0.7,
  relight: 1.84,
} as const;

export const STAGGER = 0.06;
