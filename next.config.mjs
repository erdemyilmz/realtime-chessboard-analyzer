const staticHost = process.env.NEXT_PUBLIC_STATIC_HOST === "true";
export default {
  ...(staticHost ? { output: "export", trailingSlash: true } : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  experimental: { proxyTimeout: 360000, proxyClientMaxBodySize: "11mb" },
  ...(!staticHost
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};
