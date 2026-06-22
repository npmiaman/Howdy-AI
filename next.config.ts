import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` (node-postgres) is a Node-only driver for the dual-write mirror DB;
  // keep it external so Turbopack doesn't try to bundle it.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
