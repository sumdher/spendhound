/**
 * Next.js configuration for SpendHound frontend.
 * Enables standalone output for Docker production builds.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Disable keep-alive on the internal proxy to avoid ECONNRESET with multi-worker uvicorn
  httpAgentOptions: { keepAlive: false },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // Proxy all backend API calls through Next.js so the browser always hits
  // the same host/port as the frontend. This makes the app work on any IP
  // or network without hardcoding anything.
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: "http://backend:8000/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Minimal referrer leakage
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable unused browser features
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          // HSTS — browsers refuse plain HTTP after first visit
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js App Router requires unsafe-inline/unsafe-eval for hydration;
              // swap to nonce-based CSP for a stricter posture if needed later.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com",
              "connect-src 'self' https://accounts.google.com",
              "frame-src https://accounts.google.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
