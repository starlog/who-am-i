/**
 * 리버스 프록시가 넘겨준 로그인 사용자 정보를 읽는다.
 *
 * 이 앱은 Docker Manager(v2) 아래 /c/who-am-i 로 배포되고, 그 앞단은
 *
 *   브라우저 → nginx (auth_request) → docker-manager /api/auth/check (세션 확인) → 이 앱
 *
 * 구조다. nginx 는 /api/auth/check 의 X-Auth-Request-* 응답 헤더를 회수해
 * X-Forwarded-Email / X-Forwarded-User 로 바꿔 프록시한다. 프로젝트에
 * pass_identity 가 켜져 있으면 docker-manager 가 서명한 단기 신원 토큰(JWT)도
 * X-Forwarded-Identity 로 넘어온다. 즉 이 앱은 로그인을 직접 수행하지 않고,
 * "이미 인증된 결과"를 헤더로만 받는다.
 *
 * v1 의 oauth2-proxy 구성(Authorization: Bearer <Google id_token>)도 계속 읽는다.
 *
 * ── 신뢰 범위 ──────────────────────────────────────────────────────────
 * 이 헤더들은 nginx 가 proxy_set_header 로 매 요청 덮어쓰기 때문에 프록시를
 * 거친 요청에서는 위조할 수 없다. 반대로 컨테이너 포트(3000)에 직접 닿을 수
 * 있으면 누구나 원하는 값을 보낼 수 있다.
 *
 * 여기서 "직접 닿을 수 있는 범위"는 인터넷 경계가 아니라 **도커 네트워크
 * 경계**다. 포트를 publish 하지 않아도 같은 브리지 네트워크에 있는 다른
 * 컨테이너는 3000 포트에 그대로 도달하고, standalone 서버는 0.0.0.0 에
 * 바인딩된다. 즉 같은 Docker Manager 에 올라간 이웃 앱이 침해되거나 SSRF 를
 * 가지면 nginx 를 우회해 임의의 신원으로 이 앱에 접근할 수 있다.
 *
 * 따라서
 *   - 표시(누가 로그인했는지)에는 그대로 써도 된다. 이 앱의 용도가 그것이다.
 *   - **권한 판정에는 쓰면 안 된다.** 쓰려면 (a) nginx 가 넣는 공유 비밀
 *     헤더로 프록시 경유를 강제하거나, (b) JWKS 로 토큰 서명을 검증해야
 *     한다(docker-manager 의 공개키: {publicUrl}/.well-known/jwks.json).
 *     아래 decodeJwtPayload 는 서명을 검증하지 않는다.
 */

import { headers } from 'next/headers';

/** 헤더에서 온 문자열 한 건의 최대 길이. 화면·JSON 출력이 무한정 커지는 것을 막는다. */
const MAX_FIELD_LENGTH = 256;

/** groups 헤더에서 받아들일 최대 그룹 수. */
const MAX_GROUPS = 64;

/** 토큰이 어느 헤더 계열에서 왔는지. 클레임의 의미(sub 등)가 출처마다 다르다. */
export type ProfileSource = 'docker-manager' | 'id_token';

/**
 * 신원 토큰의 프로필 클레임.
 *
 * - docker-manager: X-Forwarded-Identity (pass_identity=1). name · picture · role · sub 를 담는다.
 * - id_token      : v1 oauth2-proxy 의 Google id_token. profile 스코프가 있어야 채워진다.
 */
export type IdentityProfile = {
  source: ProfileSource;
  /** 표시 이름. */
  name: string | null;
  /** Google id_token 에만 있다. */
  givenName: string | null;
  /** Google id_token 에만 있다. */
  familyName: string | null;
  picture: string | null;
  /** Docker Manager 역할(admin 등). docker-manager 토큰에만 있다. */
  role: string | null;
  /**
   * sub. docker-manager 토큰이면 Docker Manager 사용자 ID,
   * Google id_token 이면 구글 계정 고유 ID 다.
   */
  subject: string | null;
  /** 토큰 발급자(iss). */
  issuer: string | null;
  /** 토큰 대상(aud). docker-manager 토큰이면 {publicUrl}/c/{project}. */
  audience: string | null;
  /** 만료 시각(exp, ISO 8601). 이 값이 지났어도 그대로 표시한다. */
  expiresAt: string | null;
};

/** @deprecated IdentityProfile 을 쓴다. */
export type GoogleProfile = IdentityProfile;

/** 프록시가 전달한 로그인 사용자. */
export type ProxyUser = {
  /** 구글 계정 이메일. 프록시가 항상 넘겨주는 유일한 식별자다. */
  email: string;
  /**
   * 표시용 사용자 값. Docker Manager v2 에서는 사용자 이름이고,
   * v1 oauth2-proxy 의 Google provider 에서는 이름이 아니라 sub(고유 ID)다.
   */
  user: string | null;
  /** oauth2-proxy 의 preferred_username 클레임(설정에 따라 없을 수 있다). */
  preferredUsername: string | null;
  /** 그룹 목록(설정에 따라 비어 있을 수 있다). */
  groups: string[];
  /**
   * 신원 토큰에서 꺼낸 프로필. Docker Manager 프로젝트에 pass_identity 가
   * 켜져 있을 때(또는 v1 oauth2-proxy 가 id_token 을 넘길 때)만 채워진다(README 참고).
   */
  profile: IdentityProfile | null;
};

/**
 * 읽을 헤더 이름. 앞쪽이 우선한다.
 *
 * X-Forwarded-*   : Docker Manager 의 nginx 가 만들어 주는 이름(정상 경로).
 * X-Auth-Request-*: 인증 게이트(/api/auth/check · oauth2-proxy) 원본 이름. nginx
 *                   설정이 바뀌어 원본이 그대로 전달되는 경우에도 동작하도록 함께 읽는다.
 */
const HEADER_NAMES = {
  email: ['x-forwarded-email', 'x-auth-request-email'],
  user: ['x-forwarded-user', 'x-auth-request-user'],
  preferredUsername: ['x-forwarded-preferred-username', 'x-auth-request-preferred-username'],
  groups: ['x-forwarded-groups', 'x-auth-request-groups'],
  /** Docker Manager 가 서명한 신원 토큰. 값 자체는 토큰이므로 화면에 찍지 않는다. */
  identity: ['x-forwarded-identity', 'x-auth-request-identity'],
  /** v1 oauth2-proxy 의 Google id_token 이 실려 오는 헤더. 역시 화면에 찍지 않는다. */
  idToken: ['x-forwarded-id-token', 'x-auth-request-id-token', 'authorization'],
} as const;

/**
 * 값 자체가 자격증명이라 절대 출력하면 안 되는 헤더.
 *
 * 아래 AUTH_HEADER_NAMES 는 allowlist 라 지금도 안전하지만, 그 안전이
 * "idToken 만 spread 에서 뺐다"는 암묵적 규약에만 기대고 있었다. 누군가
 * Object.values(HEADER_NAMES).flat() 로 리팩터링하는 순간 id_token 원문이
 * 화면에 노출되므로, allowlist 위에 denylist 를 한 겹 더 둔다.
 */
const SECRET_HEADER_NAMES: ReadonlySet<string> = new Set<string>([
  ...HEADER_NAMES.identity,
  ...HEADER_NAMES.idToken,
  'cookie',
  'set-cookie',
  'x-auth-request-access-token',
  'x-forwarded-access-token',
]);

/**
 * 화면에 덤프해도 되는 인증 관련 헤더.
 * 신원 토큰 / id_token / Cookie 계열은 값이 곧 자격증명이므로 의도적으로 뺐다.
 */
export const AUTH_HEADER_NAMES: readonly string[] = [
  ...HEADER_NAMES.email,
  ...HEADER_NAMES.user,
  ...HEADER_NAMES.preferredUsername,
  ...HEADER_NAMES.groups,
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-forwarded-prefix',
  'x-real-ip',
].filter((name) => !SECRET_HEADER_NAMES.has(name));

function first(source: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = source.get(name)?.trim();

    if (value) return value;
  }

  return null;
}

/** 화면·JSON 에 실을 문자열의 길이를 제한한다. */
function clamp(value: string | null): string | null {
  return value === null ? null : value.slice(0, MAX_FIELD_LENGTH);
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
  if (typeof value !== 'string') return null;

  // first() 가 헤더 값을 trim 해서 돌려주므로 클레임 경로도 동작을 맞춘다.
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * 프로필 사진 URL 을 검증한다.
 *
 * picture 는 서명을 검증하지 않은 토큰에서 온 값이라 임의의 URL 이 들어올
 * 수 있다. 그대로 <img src> 에 넣으면 React 가 <link rel="preload"> 까지 만들어
 * 페이지를 여는 것만으로 외부 호스트에 요청이 나가고, 열람자의 IP 와
 * User-Agent 가 새어 나간다. 그래서 https + googleusercontent 호스트로 제한한다
 * (Google 로그인 사용자만 사진이 보이고, Entra·비밀번호 로그인은 사진이 없다).
 */
function safePictureUrl(value: unknown): string | null {
  const raw = str(value);

  if (!raw) return null;

  try {
    const url = new URL(raw);

    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)googleusercontent\.com$/.test(url.hostname)) return null;

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * JWT 페이로드를 읽는다. 서명은 검증하지 않는다.
 *
 * 검증 없이 읽어도 되는 이유는 이 토큰이 사용자가 아니라 인증 게이트로부터
 * 프록시 경로로만 도착하기 때문이다(nginx 가 매 요청 덮어쓰므로 사용자는 이 헤더를 넣을 수 없다).
 * 반대로 말하면 도커 네트워크 안에서 컨테이너 포트에 닿을 수 있으면 이 값도
 * 신뢰할 수 없다. 표시 용도로만 쓰고, 권한 판정에 쓰려면 JWKS 로 서명을
 * 검증해야 한다(파일 상단 "신뢰 범위" 참고).
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');

  if (parts.length !== 3) {
    // 토큰 값 자체는 자격증명이므로 남기지 않는다. 형태 정보만 기록한다.
    warn('not_a_jwt', `segments=${parts.length}`);

    return null;
  }

  // base64url → base64 로 바꾸고 패딩을 채운다. 치환 결과를 기준으로 길이를
  // 계산해야 나중에 치환 로직이 늘어나도 패딩이 어긋나지 않는다.
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const base64 = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );

  try {
    // atob 는 바이트 단위라 한글 이름이 깨진다. UTF-8 로 다시 해석한다.
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));

    // typeof [] === 'object' 이므로 배열을 명시적으로 배제한다.
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      warn('payload_not_an_object');

      return null;
    }

    return payload as Record<string, unknown>;
  } catch (error) {
    warn('payload_decode_failed', error instanceof Error ? error.message : String(error));

    return null;
  }
}

/**
 * id_token 파싱 실패를 서버 로그에 남긴다.
 *
 * 이 앱의 용도가 프록시 설정 점검이므로, "토큰이 아예 안 왔다"와 "왔는데
 * 파싱이 깨졌다"를 구분할 수 있어야 한다. 토큰 값은 절대 기록하지 않는다.
 */
function warn(reason: string, detail?: string): void {
  console.warn(
    JSON.stringify({ level: 'warn', at: 'decodeJwtPayload', reason, detail: detail ?? null }),
  );
}

/** aud 는 문자열 또는 문자열 배열이다. */
function audience(value: unknown): string | null {
  if (Array.isArray(value)) {
    return clamp(value.filter((item): item is string => typeof item === 'string').join(', ') || null);
  }

  return clamp(str(value));
}

function expiresAt(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const date = new Date(value * 1000);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * 신원 토큰에서 프로필을 뽑는다.
 * Docker Manager 의 X-Forwarded-Identity 를 우선하고, 없으면 v1 id_token 계열을 본다.
 */
function readProfile(source: Headers): IdentityProfile | null {
  const identity = first(source, HEADER_NAMES.identity);
  const raw = identity ?? first(source, HEADER_NAMES.idToken);

  if (!raw) return null;

  const token = raw.replace(/^Bearer\s+/i, '');
  const claims = decodeJwtPayload(token);

  if (!claims) return null;

  return {
    source: identity ? 'docker-manager' : 'id_token',
    name: clamp(str(claims.name)),
    givenName: clamp(str(claims.given_name)),
    familyName: clamp(str(claims.family_name)),
    picture: safePictureUrl(claims.picture),
    role: clamp(str(claims.role)),
    subject: clamp(str(claims.sub)),
    issuer: clamp(str(claims.iss)),
    audience: audience(claims.aud),
    expiresAt: expiresAt(claims.exp),
  };
}

/**
 * Headers 객체에서 사용자 정보를 뽑는다(순수 함수).
 * 이메일 헤더가 없으면 null — 프록시를 거치지 않은 요청이라는 뜻이다.
 */
export function readProxyUser(source: Headers): ProxyUser | null {
  // user / preferredUsername 과 같은 출처이므로 email 도 동일하게 디코드한다.
  // decode() 는 실패하면 원문을 그대로 돌려주므로 안전하다.
  const email = clamp(decode(first(source, HEADER_NAMES.email))?.toLowerCase() ?? null);

  if (!email) return null;

  // 그룹은 콤마로 구분된다. 헤더가 여러 번 오면 Headers.get 이 ", " 로 합친다.
  const groups = (first(source, HEADER_NAMES.groups) ?? '')
    .split(',')
    .map((group) => group.trim().slice(0, MAX_FIELD_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_GROUPS);

  return {
    email,
    user: clamp(decode(first(source, HEADER_NAMES.user))),
    preferredUsername: clamp(decode(first(source, HEADER_NAMES.preferredUsername))),
    groups,
    profile: readProfile(source),
  };
}

/**
 * 화면에 쓸 이름을 고른다.
 *
 * X-Forwarded-User 는 경로에 따라 값이 다르다. Docker Manager v2 에서는
 * 사람 이름이지만 v1 oauth2-proxy 의 Google provider 에서는 sub(숫자 문자열)이므로,
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

/**
 * 서버 컴포넌트 / 라우트 핸들러에서 현재 사용자를 읽는다.
 *
 * 반환값은 **서명이 검증되지 않은** 값이다. 표시 외의 용도(권한 판정)로 쓰지 말 것.
 */
export async function getProxyUser(): Promise<ProxyUser | null> {
  return readProxyUser(await headers());
}

/**
 * 실제로 도착한 인증 관련 헤더 원문. 프록시 설정을 점검할 때 쓴다.
 * Cookie / Authorization / X-Forwarded-Identity 는 값이 그대로 자격증명이라 의도적으로 뺐다.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const source = await headers();
  const result: Record<string, string> = {};

  for (const name of AUTH_HEADER_NAMES) {
    // AUTH_HEADER_NAMES 가 이미 걸러 내지만, 목록이 바뀌어도 새지 않도록 한 번 더 막는다.
    if (SECRET_HEADER_NAMES.has(name)) continue;

    const value = source.get(name);

    if (value !== null) result[name] = value.slice(0, MAX_FIELD_LENGTH);
  }

  return result;
}
