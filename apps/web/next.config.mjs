/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@afrohit/shared'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  async rewrites() {
    return [
      { source: '/s/:code', destination: `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/share/redirect/:code` },
    ];
  },
};
export default nextConfig;
