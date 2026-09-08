/**
 * basePath 정규화. next.config.ts 와 src/lib/api.ts 가 **같은 환경변수를 각자**
 * 읽기 때문에, 정규화를 한 곳에 두지 않으면 값이 어긋난다.
 * (실제로 NEXT_PUBLIC_BASE_PATH=/c/who-am-i/ 로 빌드했을 때 apiUrl 이
 *  '/c/who-am-i//api/me' 를 만들어 내는 버그가 있었다.)
 *
 * Next 는 basePath 가 '/' 로 끝나거나, '/' 로 시작하지 않거나, '/' 하나뿐이면
 * next build 를 실패시킨다(E39 / E105 / E95). 배포 설정의 슬래시 하나 때문에
 * 파이프라인이 원인 불명으로 깨지지 않도록 여기서 보정한다.
 */
export function normalizeBasePath(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');

  if (value === '') return ''; // 루트 배포

  return value.startsWith('/') ? value : `/${value}`;
}
