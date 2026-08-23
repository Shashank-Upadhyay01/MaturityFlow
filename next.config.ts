import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Set STANDALONE=1 for a self-contained server folder. Plain `next start` (this
  // machine / LAN demo) breaks if output is always standalone.
  ...(process.env.STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
    // Scanned KYC documents are the largest thing a Server Action carries.
    // Must stay >= MAX_DOCUMENT_BYTES in src/lib/storage.ts.
    serverActions: { bodySizeLimit: '12mb' },
  },
  serverExternalPackages: ['pg', 'bcryptjs', 'exceljs'],
  // Lint is a separate gate (`npm run lint`). A style warning must never be able to stop a
  // branch deploying a fix — the gates that CAN stop a build are `typecheck` and `test`.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
