import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },
  serverExternalPackages: ['unpdf', 'puppeteer-core', '@sparticuz/chromium'],
  outputFileTracingExcludes: {
    '/api/export/pdf': ['**/@sparticuz/chromium/**/*.br'],
  },
};

export default nextConfig;
