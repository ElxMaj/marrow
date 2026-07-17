"use client";

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";

// The one scroll-reveal on the page, whitelisted to exhibit margins and pin
// cards; everything else renders still. Server HTML is always visible (the
// hiding rule is gated on html.js, which only exists once JS runs), so no-JS
// readers and crawlers get the finished document.
export function Reveal({
  as = "div",
  className,
  children,
}: {
  as?: "div" | "p";
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setPinned(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setPinned(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return createElement(
    as,
    { ref, className: pinned ? `${className} pinned` : className },
    children,
  );
}
