import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:5052"] },
  },
};

export default nextConfig;
