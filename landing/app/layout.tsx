import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { DEMO_URL, GITHUB_URL, NPM_URL, SITE_URL } from "@/content/links";
import "./globals.css";

// Variable fonts: the weight range declaration is load-bearing, without it
// the page's 540/560/620 weights would not resolve. Archivo also carries a
// width axis (62-125); the font-stretch descriptor unlocks it for CSS.
const archivo = localFont({
  src: "../fonts/archivo-latin-var-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-archivo",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});
const geist = localFont({
  src: "../fonts/geist-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist",
});
const geistMono = localFont({
  src: "../fonts/geist-mono-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Marrow · The product context layer for coding agents",
  description:
    "Marrow turns meetings, standups and notes into decided vs open product truth with provenance, then gives coding agents task-scoped context over MCP and CLI.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    // a named site so a Slack or iMessage share reads "Marrow", not the raw
    // vercel.app hostname.
    siteName: "Marrow",
    title: "Marrow · The product context layer for coding agents",
    description:
      "The decision layer between the product room and coding agents: task briefs, drift catches, truth maintenance, and provenance on every fact.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Marrow · The product context layer for coding agents",
    description:
      "The decision layer between the product room and coding agents: task briefs, drift catches, truth maintenance, and provenance on every fact.",
    images: ["/og.png"],
  },
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#08090b",
};

// Runs before first paint: adds the js class, the switch that arms every
// interactive rest state. Without JS the page stays a finished document: the
// loop already ran.
const PRE_PAINT = `document.documentElement.classList.add("js");`;

// The one DEMO_URL literal the launch preflight greps the served HTML for.
// Links in JSX come from content/links.ts; check-ids asserts they agree.
const DEMO_URL_SCRIPT = `var DEMO_URL = ${JSON.stringify(DEMO_URL)};`;

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Marrow",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      description:
        "The product context layer for coding agents. Open source, Apache 2.0, one Postgres.",
      url: SITE_URL,
      sameAs: [GITHUB_URL, NPM_URL],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@type": "Organization",
      name: "Marrow",
      url: SITE_URL,
      sameAs: [GITHUB_URL],
    },
  ],
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
        <script dangerouslySetInnerHTML={{ __html: DEMO_URL_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
