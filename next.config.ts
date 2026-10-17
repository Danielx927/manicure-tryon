import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Netlify sets NETLIFY=true during builds; its functions have no persistent
    // disk, so uploaded designs go to Netlify Blobs there instead.
    DESIGN_STORAGE: process.env.DESIGN_STORAGE || (process.env.NETLIFY ? "netlify" : "file"),
  },
};

export default nextConfig;
