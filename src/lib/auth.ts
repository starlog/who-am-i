/**
 * 리버스 프록시(oauth2-proxy)가 넘겨준 로그인 사용자 정보를 읽는다.
 *
 * 이 앱은 Docker Manager 아래 /c/who-am-i 로 배포되고, 그 앞단은
 *
 *   브라우저 → nginx (auth_request /_oauth) → oauth2-proxy → 이 앱
 *
 * 구조다. nginx 는 oauth2-proxy 의 X-Auth-Request-* 응답 헤더를 회수해
 * X-Forwarded-Email / X-Forwarded-User 로 바꿔 프록시한다. 즉 이 앱은
 * Google OAuth 를 직접 수행하지 않고, "이미 인증된 결과"를 헤더로만 받는다.
 *
 * ── 신뢰 범위 ──────────────────────────────────────────────────────────
 * 이 헤더들은 nginx 가 proxy_set_header 로 매 요청 덮어쓰기 때문에 프록시를
 * 거친 요청에서는 위조할 수 없다. 반대로 컨테이너 포트(3000)에 직접 닿을 수
 * 있으면 누구나 원하는 값을 보낼 수 있다. 따라서
 *   - 표시(누가 로그인했는지)에는 그대로 써도 된다.
 *   - 권한 판정에 쓰려면 컨테이너 포트를 외부에 노출하지 않는 것이 전제다.
 */

import { headers } from 'next/headers';

/** Google id_token 의 프로필 클레임. profile 스코프가 있어야 채워진다. */
export type GoogleProfile = {
  /** 구글 계정 표시 이름. 이메일 계열 헤더로는 절대 오지 않는 값이다. */
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  picture: string | null;
  /** 구글 계정 고유 ID(sub). 이메일이 바뀌어도 유지된다. */
  subject: string | null;
};

/** 프록시가 전달한 로그인 사용자. */
export type ProxyUser = {
  /** 구글 계정 이메일. 프록시가 항상 넘겨주는 유일한 식별자다. */
  email: string;
  /** 표시용 사용자 값. Google provider 에서는 이름이 아니라 sub(고유 ID)다. */
  user: string | null;
  /** oauth2-proxy 의 preferred_username 클레임(설정에 따라 없을 수 있다). */
  preferredUsername: string | null;
  /** 그룹 목록(설정에 따라 비어 있을 수 있다). */
  groups: string[];
  /**
   * id_token 에서 꺼낸 프로필. oauth2-proxy 에 set-authorization-header 가
   * 켜져 있고 nginx 가 그 값을 넘겨줄 때만 채워진다(README 참고).
   */
  profile: GoogleProfile | null;
};

/**
 * 읽을 헤더 이름. 앞쪽이 우선한다.
 *
 * X-Forwarded-*   : Docker Manager 의 nginx 가 만들어 주는 이름(정상 경로).
 * X-Auth-Request-*: oauth2-proxy 원본 이름. nginx 설정이 바뀌어 원본이 그대로
 *                   전달되는 경우에도 동작하도록 함께 읽는다.
 */
const HEADER_NAMES = {
  email: ['x-forwarded-email', 'x-auth-request-email'],
  user: ['x-forwarded-user', 'x-auth-request-user'],
  preferredUsername: ['x-forwarded-preferred-username', 'x-auth-request-preferred-username'],
  groups: ['x-forwarded-groups', 'x-auth-request-groups'],
  /** id_token 이 실려 오는 헤더. 값 자체는 토큰이므로 화면에 찍지 않는다. */
  idToken: ['x-forwarded-id-token', 'x-auth-request-id-token', 'authorization'],
} as const;

/**
 * 화면에 덤프해도 되는 인증 관련 헤더.
 * id_token / Cookie 계열은 값이 곧 자격증명이므로 의도적으로 뺐다.
 */
export const AUTH_HEADER_NAMES: string[] = [
  ...HEADER_NAMES.email,
  ...HEADER_NAMES.user,
  ...HEADER_NAMES.preferredUsername,
  ...HEADER_NAMES.groups,
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-forwarded-prefix',
  'x-real-ip',
];

function first(source: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = source.get(name)?.trim();

    if (value) return value;
  }

  return null;
}

/**
 * Docker Manager 는 이름을 encodeURIComponent 로 감싸 보내고(한글 이름이
 * 헤더에 그대로 들어가면 깨진다), oauth2-proxy 는 감싸지 않는다. 양쪽 모두를
 * 받아야 하므로 디코드를 시도하고 실패하면 원문을 쓴다.
 */
function decode(value: string | null): string | null {
  if (value === null) return null;

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * JWT 페이로드를 읽는다. 서명은 검증하지 않는다.
 *
 * 검증 없이 읽어도 되는 이유는 이 토큰이 사용자가 아니라 oauth2-proxy 로부터
 * 프록시 경로로만 도착하기 때문이다(사용자는 이 헤더를 넣을 수 없다).
 * 반대로 말하면 컨테이너 포트가 외부에 열려 있으면 이 값도 신뢰할 수 없다.
 * 표시 용도로만 쓰고, 권한 판정에 쓰려면 JWKS 로 서명을 검증해야 한다.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');

  if (parts.length !== 3) return null;

  // base64url → base64 로 바꾸고 패딩을 채운다.
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(
    parts[1].length + ((4 - (parts[1].length % 4)) % 4),
    '=',
  );

  try {
    // atob 는 바이트 단위라 한글 이름이 깨진다. UTF-8 로 다시 해석한다.
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));

    return typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Authorization: Bearer <id_token> 또는 id_token 헤더에서 프로필을 뽑는다. */
function readProfile(source: Headers): GoogleProfile | null {
  const raw = first(source, HEADER_NAMES.idToken);

  if (!raw) return null;

  const token = raw.replace(/^Bearer\s+/i, '');
  const claims = decodeJwtPayload(token);

  if (!claims) return null;

  return {
    name: str(claims.name),
    givenName: str(claims.given_name),
    familyName: str(claims.family_name),
    picture: str(claims.picture),
    subject: str(claims.sub),
  };
}

/**
 * Headers 객체에서 사용자 정보를 뽑는다(순수 함수).
 * 이메일 헤더가 없으면 null — 프록시를 거치지 않은 요청이라는 뜻이다.
 */
export function readProxyUser(source: Headers): ProxyUser | null {
  const email = first(source, HEADER_NAMES.email)?.toLowerCase() ?? null;

  if (!email) return null;

  // 그룹은 콤마로 구분된다. 헤더가 여러 번 오면 Headers.get 이 ", " 로 합친다.
  const groups = (first(source, HEADER_NAMES.groups) ?? '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);

  return {
    email,
    user: decode(first(source, HEADER_NAMES.user)),
    preferredUsername: decode(first(source, HEADER_NAMES.preferredUsername)),
    groups,
    profile: readProfile(source),
  };
}

/**
 * 화면에 쓸 이름을 고른다.
 *
 * X-Forwarded-User 는 경로에 따라 값이 다르다. Docker Manager 자체 로그인에서는
 * 사람 이름이지만 oauth2-proxy 의 Google provider 에서는 sub(숫자 문자열)이므로,
 * 숫자만으로 된 값은 이름으로 쓰지 않는다.
 */
export function displayName(user: ProxyUser): string {
  const candidates = [
    user.profile?.name,
    user.preferredUsername,
    user.user && !/^\d+$/.test(user.user) ? user.user : null,
  ];

  return candidates.find((value): value is string => !!value) ?? user.email;
}

/** 서버 컴포넌트 / 라우트 핸들러에서 현재 사용자를 읽는다. */
export async function getProxyUser(): Promise<ProxyUser | null> {
  return readProxyUser(await headers());
}

/**
 * 실제로 도착한 인증 관련 헤더 원문. 프록시 설정을 점검할 때 쓴다.
 * Cookie / Authorization 은 값이 그대로 자격증명이라 의도적으로 뺐다.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const source = await headers();
  const result: Record<string, string> = {};

  for (const name of AUTH_HEADER_NAMES) {
    const value = source.get(name);

    if (value !== null) result[name] = value;
  }

  return result;
}
