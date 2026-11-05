/** @type {import('next').NextConfig} */
const API = process.env.API_URL ?? 'http://localhost:4100';
export default {
  reactStrictMode: true,
  devIndicators: false,
  // نمرّر /api إلى خادم NestJS لتبقى الجلسة في ملف تعريف ارتباط httpOnly على النطاق نفسه
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
