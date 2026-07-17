"use client";

import { useEffect } from "react";

// One observer for every [data-reveal] element on the page: each settles in
// once, on first sight, with its own --reveal-delay. The hidden rest state
// only exists under html.js, so crawlers, no-JS readers and reduced-motion
// visitors always get the finished document.
export function RevealField() {
  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("revealed"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
