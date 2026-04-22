/**
 * Next.js configuration for SpendHound frontend.
 * Enables standalone output for Docker production builds.
 * 
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
};

export default nextConfig;
