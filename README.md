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
| `/health` | 헬스체크 |
| `src/lib/auth.ts` | 헤더 파싱. 앱에서 사용자 정보가 필요하면 여기만 쓰면 됩니다 |

```ts
import { displayName, getProxyUser } from '@/lib/auth';

const user = await getProxyUser();   // 서버 컴포넌트 / 라우트 핸들러
if (user) console.log(user.email, displayName(user));
```

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

## 주의: 이 헤더는 표시용으로만 신뢰하세요

nginx 가 `proxy_set_header` 로 매 요청 값을 덮어쓰므로 **프록시를 거친 요청에서는 위조할 수
없습니다.** 반대로 컨테이너 포트(3000)에 직접 닿을 수 있으면 누구나 임의의 이메일과 id_token 을
보낼 수 있습니다. `src/lib/auth.ts` 는 id_token 서명을 검증하지 않으므로(프록시 경로를 신뢰),
권한 판정에 쓰려면 컨테이너 포트를 외부에 노출하지 않거나 JWKS 로 서명을 검증해야 합니다.

## 실행

```bash
npm run dev          # 개발 서버
npm run build        # standalone 빌드 (.next/standalone)
npm start
```

서브 경로(`/c/who-am-i`) 배포 시에는 빌드·런타임 양쪽에 `NEXT_PUBLIC_BASE_PATH` 를 지정합니다.
