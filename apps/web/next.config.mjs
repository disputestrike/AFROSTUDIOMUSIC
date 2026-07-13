import path from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const production = process.env.NODE_ENV === 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(production ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=()' },
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: monorepoRoot,
  // Root CI runs ESLint before this build. Avoid Next's legacy config detector
  // re-running lint and warning about the monorepo flat configuration.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@afrohit/shared'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: '/s/:code', destination: `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/share/redirect/:code` },
      // Dev-only same-origin API proxy (set API_PROXY_TARGET + empty
      // NEXT_PUBLIC_API_URL in .env.local): lets a local web click-through run
      // against a remote API without CORS. Inactive unless the env var is set.
      ...(process.env.API_PROXY_TARGET
        ? [{ source: '/api/v1/:path*', destination: `${process.env.API_PROXY_TARGET}/api/v1/:path*` }]
        : []),
    ];
  },
};
export default nextConfig;
