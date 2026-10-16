import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: '/embed/:path*', headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }] },
      {
        source: '/((?!embed/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] },
    ];
  },
};

export default nextConfig;
