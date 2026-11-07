# Who am I

Docker Manager 뒤에서 **로그인한 사용자가 누구로 보이는지** 확인하는 앱입니다.
자체 로그인은 없고, 앞단이 넣어 준 요청 헤더를 읽어 그대로 표시합니다.

```
브라우저 → nginx (auth_request) → docker-manager /api/auth/check (세션 확인) → 이 앱
```

Docker Manager v2 에는 oauth2-proxy 가 없습니다. `/c/{project}/` 게이트는 Docker Manager 자체
로그인 세션(Google · Entra · 비밀번호)으로 동작합니다. v1(oauth2-proxy) 구성에서 오는
`Authorization: Bearer <id_token>` 도 하위 호환으로 계속 읽습니다.

## 구성

| 경로 | 설명 |
|---|---|
| `/` | 사용자 정보와 도착한 헤더 원문을 표시 (서버 컴포넌트) |
| `/api/me` | 같은 내용을 JSON 으로 반환 |
| `/api/hello` | REST API 예시 (스캐폴딩. 앱 기능과 무관하므로 필요 없으면 지워도 됩니다) |
| `/health` | 헬스체크 |
| `src/lib/auth.ts` | 헤더 · 신원 토큰 파싱. 앱에서 사용자 정보가 **표시용으로** 필요하면 여기만 쓰면 됩니다 |
| `src/lib/api.ts` | 클라이언트에서 자체 API 를 부를 때 서브패스를 붙이는 `apiUrl` / `apiFetch` |
| `src/lib/base-path.ts` | basePath 정규화. `next.config.ts` 와 `api.ts` 가 함께 씁니다 |
| `scripts/prepare-standalone.mjs` | 빌드 후 standalone 산출물 정리(정적 자산 복사 · HOSTNAME 보정) |

```ts
import { displayName, getProxyUser } from '@/lib/auth';

const user = await getProxyUser();   // 서버 컴포넌트 / 라우트 핸들러
if (user) console.log(user.email, displayName(user));
```

> **이 값으로 권한을 판정하지 마세요.** `getProxyUser()` 가 돌려주는 이메일·그룹·프로필·역할은
> 서명이 검증되지 않은 값입니다. 아래 "주의" 절을 먼저 읽으세요.

## 전달되는 헤더

nginx 가 `/api/auth/check` 의 `X-Auth-Request-*` 응답을 회수해 `X-Forwarded-*` 로 바꿔 넘깁니다.
`src/lib/auth.ts` 는 두 계열을 모두 읽으므로 어느 쪽이 와도 동작합니다.

| 헤더 | 내용 |
|---|---|
| `X-Forwarded-Email` | 로그인 이메일. 항상 전달되는 유일한 식별자 |
| `X-Forwarded-User` | 사용자 이름 (`encodeURIComponent` 로 감싸져 옴. 앱이 디코드) |
| `X-Forwarded-Identity` | 프로젝트에 `pass_identity` 를 켰을 때만. Docker Manager 가 서명한 신원 토큰(JWT) |
| `X-Forwarded-Preferred-Username` / `X-Forwarded-Groups` | nginx 가 회수하도록 설정한 경우에만 (현재 Docker Manager 는 보내지 않음) |
| `Authorization: Bearer <id_token>` | v1 oauth2-proxy 구성에서만. Google id_token |

### 신원 토큰 (`X-Forwarded-Identity`)

기본 설정에서는 이메일과 이름만 옵니다. 프로필 사진 · 역할 · 사용자 ID 까지 받으려면
Docker Manager 에서 이 프로젝트의 **신원 전달(`pass_identity`)** 을 켜세요.

- 관리자 화면: 프로젝트 상세 → 신원 전달 → **전달 켜기**
- API: `PUT /api/projects/{id}` 에 `{"pass_identity": 1}` (admin 전용)

켜면 nginx 가 `auth_request /_oauth_identity/{project}` 로 바뀌고, 매 요청 아래 토큰을 넘깁니다.
oauth2-proxy · nginx 설정을 따로 고칠 필요는 없습니다.

| 클레임 | 내용 |
|---|---|
| `email` | 로그인 이메일 |
| `name` | 사용자 이름 |
| `picture` | 프로필 사진 URL (Google 로그인일 때) |
| `role` | Docker Manager 역할 (`admin` 등) |
| `sub` | Docker Manager 사용자 ID (**구글 `sub` 가 아님**) |
| `iss` | Docker Manager 공개 URL |
| `aud` | `{iss}/c/{project}` — 이 프로젝트 전용 |
| `exp` | 발급 후 5분 |

토큰은 ES256 으로 서명되며 공개키는 `{iss}/.well-known/jwks.json` 에 있습니다.
로그인 방식(Google · Entra · 비밀번호)과 무관하게 형식이 같습니다.
이 앱의 `readProfile()` 이 페이로드에서 위 값을 꺼내 화면과 `/api/me` 에 표시합니다.
토큰 원문은 자격증명이므로 화면 · 로그에 남기지 않습니다.

## 로컬에서 확인

프록시를 거치지 않으면 헤더가 없으므로 값이 비어 있습니다. 직접 넣어 확인하세요.

```bash
npm run dev

curl -s localhost:3000/api/me \
  -H 'X-Forwarded-Email: me@example.com' \
  -H 'X-Auth-Request-Groups: dba,dev'

# 신원 토큰 흉내 (서명은 보지 않으므로 아무 값이나 됩니다)
PAYLOAD=$(printf '{"name":"홍길동","role":"admin","sub":"u1"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
curl -s localhost:3000/api/me \
  -H 'X-Forwarded-Email: me@example.com' \
  -H "X-Forwarded-Identity: e30.$PAYLOAD.sig"
```

서브 경로로 빌드한 경우에는 경로 앞에 prefix 를 붙이세요
(`curl -s localhost:3000/c/who-am-i/api/me ...`).

## 주의: 이 헤더는 표시용으로만 신뢰하세요

nginx 가 `proxy_set_header` 로 매 요청 값을 덮어쓰므로 **프록시를 거친 요청에서는 위조할 수
없습니다.** 반대로 컨테이너 포트(3000)에 직접 닿을 수 있으면 누구나 임의의 이메일과 토큰을
보낼 수 있습니다. `src/lib/auth.ts` 는 토큰 서명을 검증하지 않습니다(프록시 경로를 신뢰).

여기서 "직접 닿을 수 있는 범위"는 **인터넷 경계가 아니라 도커 네트워크 경계**입니다.
포트를 publish 하지 않아도 같은 브리지 네트워크의 다른 컨테이너는 3000 포트에 그대로 도달하고,
standalone 서버는 `0.0.0.0` 에 바인딩됩니다. 즉 같은 Docker Manager 에 올라간 이웃 앱이 침해되거나
SSRF 를 가지면 nginx 를 우회해 임의의 신원으로 이 앱에 접근할 수 있습니다.

따라서 **권한 판정에는 쓰지 마세요.** 쓰려면 둘 중 하나가 필요합니다.

1. nginx 가 넣는 공유 비밀 헤더로 프록시 경유를 강제 — 직접 접근 자체를 막으므로 근본 해결에 가깝습니다.
2. `jose` 등으로 `X-Forwarded-Identity` 를 검증 — `{iss}/.well-known/jwks.json` 으로 서명을 확인하고,
   `iss` 가 Docker Manager 공개 URL, `aud` 가 `{iss}/c/who-am-i`, `exp` 가 지나지 않았는지 봅니다.

참고로 프로필 사진 URL 은 서명되지 않은 토큰에서 오므로, `safePictureUrl()` 이 https +
`googleusercontent.com` 호스트로 제한합니다. 다른 provider 를 쓰면 사진이 표시되지 않습니다.

## 설치 및 실행

### 사전 요구사항

- Node.js **24.22.1 이상** (`package.json` 의 `engines`, `.nvmrc` 참고)
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

서브 경로 빌드에서는 `trailingSlash` 도 함께 켜지므로, 끝 슬래시가 없는 요청은
같은 경로 + `/` 로 308 리다이렉트됩니다(루트 배포에서는 꺼져 있습니다).

```bash
curl -s localhost:3000/c/who-am-i/health/    # 200
curl -s localhost:3000/c/who-am-i/health     # 308 → /c/who-am-i/health/
curl -sL localhost:3000/health               # 404 (정상)
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

- **신원 토큰 서명을 검증하지 않습니다.** 표시 전용으로만 쓰세요 (위 "주의" 절 참고).
- 만료된(`exp` 지난) 토큰의 프로필도 그대로 표시됩니다. 프록시 설정 점검이 목적이라 의도적으로 두었습니다.
- 프로필 사진은 `googleusercontent.com` 주소만 표시합니다. Entra · 비밀번호 로그인 사용자는 사진이 없습니다.
- Docker Manager 자동 생성 Dockerfile 에서 **빌드 전에** `NEXT_PUBLIC_BASE_PATH` 를 `ENV` 로
  설정하는지 확인이 필요합니다. basePath 는 빌드 시점에 확정되므로 런타임 주입은 반영되지 않습니다.
  자세한 내용은 [`IMPROVEMENTS.md`](./IMPROVEMENTS.md) 6장을 보세요.
  (`HOSTNAME` 과 정적 자산 복사는 `postbuild` 스크립트가 처리하므로 Dockerfile 쪽 조치가 필요 없습니다.)
