# Who am I

Docker Manager 뒤(oauth2-proxy)에서 **로그인한 사용자가 누구로 보이는지** 확인하는 앱입니다.
자체 로그인은 없고, 앞단이 넣어 준 요청 헤더를 읽어 그대로 표시합니다.

```
브라우저 → nginx (auth_request /_oauth) → oauth2-proxy (Google OAuth) → 이 앱
```

## 구성

| 경로 | 설명 |
|---|---|
| `/` | 사용자 정보와 도착한 헤더 원문을 표시 (서버 컴포넌트) |
| `/api/me` | 같은 내용을 JSON 으로 반환 |
| `/api/hello` | REST API 예시 (스캐폴딩. 앱 기능과 무관하므로 필요 없으면 지워도 됩니다) |
| `/health` | 헬스체크 |
| `src/lib/auth.ts` | 헤더 파싱. 앱에서 사용자 정보가 **표시용으로** 필요하면 여기만 쓰면 됩니다 |
| `src/lib/api.ts` | 클라이언트에서 자체 API 를 부를 때 서브패스를 붙이는 `apiUrl` / `apiFetch` |
| `src/lib/base-path.ts` | basePath 정규화. `next.config.ts` 와 `api.ts` 가 함께 씁니다 |
| `scripts/prepare-standalone.mjs` | 빌드 후 standalone 산출물 정리(정적 자산 복사 · HOSTNAME 보정) |

```ts
import { displayName, getProxyUser } from '@/lib/auth';

const user = await getProxyUser();   // 서버 컴포넌트 / 라우트 핸들러
if (user) console.log(user.email, displayName(user));
```

> **이 값으로 권한을 판정하지 마세요.** `getProxyUser()` 가 돌려주는 이메일·그룹·프로필은
> 서명이 검증되지 않은 값입니다. 아래 "주의" 절을 먼저 읽으세요.

## 전달되는 헤더

nginx 가 oauth2-proxy 의 `X-Auth-Request-*` 응답을 회수해 `X-Forwarded-*` 로 바꿔 넘깁니다.
`src/lib/auth.ts` 는 두 계열을 모두 읽으므로 어느 쪽이 와도 동작합니다.

| 헤더 | 내용 |
|---|---|
| `X-Forwarded-Email` | 구글 계정 이메일. 항상 전달되는 유일한 식별자 |
| `X-Forwarded-User` | Google provider 에서는 **이름이 아니라 `sub`(숫자 고유 ID)** |
| `X-Forwarded-Preferred-Username` / `X-Forwarded-Groups` | nginx 가 회수하도록 설정한 경우에만 |
| `Authorization: Bearer <id_token>` | 아래 설정을 켰을 때만. 여기에 **이름·프로필 사진**이 들어 있음 |

## 이름(name)을 받으려면

기본 설정에서는 이메일만 옵니다. oauth2-proxy 에는 이름을 담는 전용 헤더가 없고,
이름은 Google **id_token 의 `name` 클레임**에만 들어 있습니다. 두 곳을 고쳐야 합니다.

**1. oauth2-proxy (docker-manager 의 `docker-compose.yml`)**

```yaml
- OAUTH2_PROXY_SET_AUTHORIZATION_HEADER=true   # /oauth2/auth 응답에 Bearer <id_token> 을 실어 준다
- OAUTH2_PROXY_SCOPE=openid email profile      # name/picture 클레임을 받으려면 profile 스코프 필요
```

**2. nginx (docker-manager 의 `src/lib/nginx.ts` 프로젝트 블록)**

```nginx
auth_request_set $auth_id_token $upstream_http_authorization;
proxy_set_header Authorization $auth_id_token;
```

그러면 이 앱의 `readProfile()` 이 id_token 페이로드에서 `name` · `given_name` ·
`family_name` · `picture` · `sub` 를 꺼내 화면에 표시합니다.

대안으로 `OAUTH2_PROXY_PASS_ACCESS_TOKEN=true` 를 켜서 access token 을 넘기고
앱이 직접 `https://www.googleapis.com/oauth2/v3/userinfo` 를 호출하는 방법도 있지만,
요청마다 외부 호출이 붙으므로 위쪽(id_token) 방식이 낫습니다.

## 로컬에서 확인

프록시를 거치지 않으면 헤더가 없으므로 값이 비어 있습니다. 직접 넣어 확인하세요.

```bash
npm run dev

curl -s localhost:3000/api/me \
  -H 'X-Forwarded-Email: me@example.com' \
  -H 'X-Auth-Request-Groups: dba,dev'
```

서브 경로로 빌드한 경우에는 경로 앞에 prefix 를 붙이세요
(`curl -s localhost:3000/c/who-am-i/api/me ...`).

## 주의: 이 헤더는 표시용으로만 신뢰하세요

nginx 가 `proxy_set_header` 로 매 요청 값을 덮어쓰므로 **프록시를 거친 요청에서는 위조할 수
없습니다.** 반대로 컨테이너 포트(3000)에 직접 닿을 수 있으면 누구나 임의의 이메일과 id_token 을
보낼 수 있습니다. `src/lib/auth.ts` 는 id_token 서명을 검증하지 않습니다(프록시 경로를 신뢰).

여기서 "직접 닿을 수 있는 범위"는 **인터넷 경계가 아니라 도커 네트워크 경계**입니다.
포트를 publish 하지 않아도 같은 브리지 네트워크의 다른 컨테이너는 3000 포트에 그대로 도달하고,
standalone 서버는 `0.0.0.0` 에 바인딩됩니다. 즉 같은 Docker Manager 에 올라간 이웃 앱이 침해되거나
SSRF 를 가지면 nginx 를 우회해 임의의 신원으로 이 앱에 접근할 수 있습니다.

따라서 **권한 판정에는 쓰지 마세요.** 쓰려면 둘 중 하나가 필요합니다.

1. nginx 가 넣는 공유 비밀 헤더로 프록시 경유를 강제 — 직접 접근 자체를 막으므로 근본 해결에 가깝습니다.
2. `jose` 등으로 JWKS 서명 + `iss` / `aud` / `exp` 검증.

참고로 프로필 사진 URL 은 서명되지 않은 토큰에서 오므로, `safePictureUrl()` 이 https +
`googleusercontent.com` 호스트로 제한합니다. 다른 provider 를 쓰면 사진이 표시되지 않습니다.

## 설치 및 실행

### 사전 요구사항

- Node.js **20.9 이상** (`package.json` 의 `engines` 참고. 개발은 22.x 에서 확인했습니다)
- DB 없음 — 앱은 요청 헤더만 읽는 stateless 구조입니다

### 설치

```bash
npm ci        # lock 파일이 있으므로 ci 권장
```

### 환경변수

`.env.example` 을 복사해 `.env` 를 만드세요.

```bash
cp .env.example .env
```

| 변수 | 시점 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | **빌드타임** | 서브 경로 prefix (예: `/c/who-am-i`). 루트 배포면 비워 둡니다 |
| `PORT` | 런타임 | standalone 서버 포트 (기본 3000) |
| `HOSTNAME` | 런타임 | 바인딩 주소. 컨테이너에서는 `0.0.0.0` 이 필요합니다 |

### 실행

```bash
npm run dev          # 개발 서버 → http://localhost:3000
npm run build        # standalone 빌드 (.next/standalone)
npm start
```

## 서브 경로 배포

`NEXT_PUBLIC_BASE_PATH` 는 **`next build` 이전에** 지정해야 합니다.
`output: 'standalone'` 산출물은 `next.config` 를 `server.js` 안에 통째로 직렬화하므로,
런타임에만 넣으면 반영되지 않고 정적 자산이 전부 404 가 됩니다.

```bash
NEXT_PUBLIC_BASE_PATH=/c/who-am-i npm run build
```

값에 앞/뒤 슬래시가 잘못 붙어도(`c/who-am-i`, `/c/who-am-i/`) `src/lib/base-path.ts` 가 보정합니다.

서브 경로로 빌드하면 **헬스체크를 포함한 모든 경로 앞에 prefix 가 붙습니다.**

```bash
curl -s localhost:3000/c/who-am-i/health     # 200
curl -s localhost:3000/health                # 404 (정상)
```

Docker Manager 는 헬스체크 시 basePath 를 자동으로 붙이므로 배포 경로에서는 문제가 없습니다.

### standalone 산출물은 빌드 시 자동으로 정리됩니다

`npm run build` 는 `postbuild` 로 `scripts/prepare-standalone.mjs` 를 실행해 두 가지를 처리합니다.
따라서 `.next/standalone` 만 복사하면 그대로 실행됩니다.

1. **`.next/static` 과 `public/` 복사** — standalone 산출물에는 이 둘이 포함되지 않습니다.
   복사하지 않으면 HTML 은 뜨지만 CSS·폰트가 전부 404 입니다.
2. **`HOSTNAME` 보정** — standalone 의 `server.js` 는 `process.env.HOSTNAME || '0.0.0.0'` 으로
   바인딩 주소를 정하는데, Docker 는 컨테이너 안에 `HOSTNAME` 을 **컨테이너 ID** 로 자동 주입합니다.
   그대로 두면 서버가 `0.0.0.0` 이 아니라 eth0 IP 하나에만 바인딩되어(또는 이름이 안 풀려 기동 실패)
   컨테이너 내부 `localhost:3000` 접근이 실패합니다. IP·`localhost` 가 아닌 값이면 `0.0.0.0` 으로 되돌립니다.
   `HOSTNAME=127.0.0.1` 처럼 **의도적으로 IP 를 지정한 경우는 그대로 존중**합니다.

```bash
npm run build
node .next/standalone/server.js   # 추가 복사 없이 바로 실행
```

## 알려진 이슈

- **id_token 서명을 검증하지 않습니다.** 표시 전용으로만 쓰세요 (위 "주의" 절 참고).
- 만료된(`exp` 지난) id_token 의 프로필도 그대로 표시됩니다. 프록시 설정 점검이 목적이라 의도적으로 두었습니다.
- Docker Manager 자동 생성 Dockerfile 에서 **빌드 전에** `NEXT_PUBLIC_BASE_PATH` 를 `ENV` 로
  설정하는지 확인이 필요합니다. basePath 는 빌드 시점에 확정되므로 런타임 주입은 반영되지 않습니다.
  자세한 내용은 [`IMPROVEMENTS.md`](./IMPROVEMENTS.md) 6장을 보세요.
  (`HOSTNAME` 과 정적 자산 복사는 `postbuild` 스크립트가 처리하므로 Dockerfile 쪽 조치가 필요 없습니다.)
