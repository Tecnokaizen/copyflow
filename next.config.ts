import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  async headers() {
    const operationalCache = {
      key: "Cache-Control",
      value: "private, no-store, max-age=0, must-revalidate",
    } as const;

    return [
      {
        source: "/invitations/accept",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/api/invitations/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/api/orders",
        headers: [operationalCache],
      },
      {
        source: "/api/orders/:path*",
        headers: [operationalCache],
      },
      {
        source: "/api/dashboard",
        headers: [operationalCache],
      },
    ];
  },
};

export default nextConfig;
