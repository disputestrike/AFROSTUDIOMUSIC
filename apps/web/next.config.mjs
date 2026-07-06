/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@afrohit/shared'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
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
