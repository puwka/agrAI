import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": [
      "./public/uploads/generations/**/*",
      "./public/uploads/voice-previews/**/*",
    ],
  },
};

export default nextConfig;
