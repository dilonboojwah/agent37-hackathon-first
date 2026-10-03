import type { NextConfig } from "next";

const config: NextConfig = {
  // Seeds are read from disk at runtime; keep them out of the client bundle.
  serverExternalPackages: [],
};

export default config;
