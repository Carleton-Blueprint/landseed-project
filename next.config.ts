/**
 * Next.js config. Currently sets a 10MB body size limit for server actions (e.g. uploads).
 * Add other options (images, redirects, env) here as needed.
 */
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../../.."),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "s3-bucket-blueprint.s3.ca-central-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
