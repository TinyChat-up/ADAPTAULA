import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },
  serverExternalPackages: ['unpdf', 'puppeteer-core', '@sparticuz/chromium-min'],
};

export default nextConfig;
