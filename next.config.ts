import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*"],
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
