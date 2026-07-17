import type { NextConfig } from "next";

// Static export: the page ships as plain HTML so check-ids and the launch
// preflight keep parsing a real file, and the Vercel deploy stays static.
// Security headers live in the root vercel.json (next.config headers are a
// no-op under export).
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: false,
  // next/image optimization needs a server; nothing on the page uses images
  // above the fold, so anything added later must be pre-compressed.
  images: { unoptimized: true },
};

export default nextConfig;
