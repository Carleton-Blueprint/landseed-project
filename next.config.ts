/**
 * Next.js config. Currently sets a 10MB body size limit for server actions (e.g. uploads).
 * Add other options (images, redirects, env) here as needed.
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
};

export default nextConfig;
