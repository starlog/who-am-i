import { normalizeBasePath } from './base-path';

/**
 * 자체 API 를 호출할 때 서브패스(basePath)를 붙이는 유틸.
 *
 * Next.js 는 <Link> / router.push 에는 basePath 를 자동으로 붙이지만
 * fetch · axios · window.location 에는 붙이지 않는다. 그래서 /c/who-am-i 같은
 * 서브패스 배포에서 fetch('/api/me') 는 프록시 밖으로 나가 404 가 된다.
 *
 * NEXT_PUBLIC_BASE_PATH 는 클라이언트 번들에는 빌드 시점에 인라인되므로,
 * next.config.ts 의 basePath 와 반드시 같은 값으로 빌드해야 한다. 정규화도
 * next.config.ts 와 동일한 함수를 쓴다(둘이 갈라지면 경로가 어긋난다).
 */
const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export function apiUrl(path: string): string {
  // basePath + path 로 단순 연결하면 apiUrl('api/me') 가 '/c/who-am-iapi/me' 로
  // 뭉개진다. 슬래시가 없으면 보정한다.
  return `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), options);
}
