/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  // Keep Node.js-only broker packages out of Edge Runtime (middleware)
  experimental: { serverComponentsExternalPackages: ['smartapi-javascript', 'got', 'public-ip'] },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
}

module.exports = nextConfig
