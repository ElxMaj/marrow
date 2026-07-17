"use client";

import { type Citation, refLabel, spanAttr } from "@/content/citations";
import { DEMO_URL } from "@/content/links";

// A citation is a control: every span on this page can be looked up. The
// button scrolls to its mark and relights it; the anchor variant leaves for
// the live demo and says so (the ↗ comes from CSS).
export function CiteButton({
  cite,
  sep = "space",
  className = "cite",
}: {
  cite: Citation;
  sep?: "space" | "dot";
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      data-ev={cite.ev}
      data-span={spanAttr(cite)}
      onClick={(e) => {
        const btn = e.currentTarget;
        const sel = `[data-ev="${cite.ev}"][data-span="${spanAttr(cite)}"]`;
        let target: Element | null = null;
        document.querySelectorAll(sel).forEach((el) => {
          if (el !== btn && (el.tagName === "MARK" || el.classList.contains("hl-c"))) target = el;
        });
        if (!target) return;
        document.querySelectorAll(".relit").forEach((el) => el.classList.remove("relit"));
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        (target as HTMLElement).scrollIntoView({
          behavior: reduce ? "auto" : "smooth",
          block: "center",
        });
        void (target as HTMLElement).offsetWidth;
        (target as HTMLElement).classList.add("relit");
      }}
    >
      {refLabel(cite, sep)}
    </button>
  );
}

export function CiteDemoLink({ cite, sep = "space" }: { cite: Citation; sep?: "space" | "dot" }) {
  return (
    <a className="cite" href={DEMO_URL} data-demo-link data-ev={cite.ev} data-span={spanAttr(cite)}>
      {refLabel(cite, sep)}
    </a>
  );
}
