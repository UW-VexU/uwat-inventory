import path from 'node:path';
import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:2211';

const config: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname, '..'),
  transpilePackages: ['@uwat/shared'],
  turbopack: { root: path.join(__dirname, '..') },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default config;
