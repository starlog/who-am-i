import type { NextConfig } from 'next';

import { normalizeBasePath } from './src/lib/base-path';

const nextConfig: NextConfig = {
  output: 'standalone',
  // 빈 문자열이면 basePath 키 자체를 넘기지 않는다(Next 가 undefined 키는 건너뛴다).
  basePath: normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH) || undefined,
  // 프레임워크 정보를 굳이 응답에 실을 이유가 없다.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 로그인 신원을 표시하는 페이지라 iframe 삽입(클릭재킹)을 막는다.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // RSC 페이로드가 인라인 <script> 로 들어오므로 unsafe-inline 이 필요하다.
              "script-src 'self' 'unsafe-inline'",
              // 프로필 사진은 googleusercontent 에서만 온다(auth.ts 에서도 검증).
              "img-src 'self' data: https://*.googleusercontent.com",
              // Tailwind 가 인라인 스타일을 낸다.
              "style-src 'self' 'unsafe-inline'",
              // next/font 가 폰트를 셀프호스팅하므로 self 로 충분하다.
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'none'",
              "form-action 'none'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
      {
        // 사용자별 신원 응답이 중간 캐시에 남지 않게 한다.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
