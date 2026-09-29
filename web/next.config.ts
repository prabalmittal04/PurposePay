import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
};

export default nextConfig;
