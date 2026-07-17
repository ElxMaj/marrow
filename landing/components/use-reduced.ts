"use client";

import { useEffect, useState } from "react";

// One signal, read once per component: the visitor's reduced-motion setting.
// Server renders assume motion is fine; the hook corrects before anything
// animates (every animated device is also behind the CSS media query).
export function useReduced(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
