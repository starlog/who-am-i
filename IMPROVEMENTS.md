# 코드 리뷰 및 개선 보고서

`CODE-REVIEW-AND-FIX.md` 워크플로우 실행 결과입니다. 분석은 에이전트 6개(B·C·D·E·F·G)를 병렬로,
수정은 메인 에이전트가 순차로 적용했습니다. 에이전트 A(DB)는 이 프로젝트가 DB를 쓰지 않아 건너뛰었습니다.

## 1. 프로젝트 개요

- **프로젝트 유형**: Next.js 풀스택 (App Router)
- **언어 / 프레임워크**: TypeScript / Next.js 16.3.4, React 19.2.8, Tailwind CSS v4
- **DB**: 없음 (DB 드라이버 미사용, 앱은 완전 stateless)
- **진입점**: `package.json` → `next start` (배포 시 `.next/standalone/server.js`)
- **주요 파일**
  | 경로 | 역할 |
  |---|---|
  | `src/app/page.tsx` | 사용자 정보·수신 헤더 표시 (서버 컴포넌트) |
  | `src/app/api/me/route.ts` | 같은 내용을 JSON 으로 반환 |
  | `src/app/health/route.ts` | 헬스체크 |
  | `src/app/api/hello/route.ts` | REST 예시 (스캐폴딩) |
  | `src/lib/auth.ts` | 프록시 헤더 파싱 · id_token 프로필 추출 |
  | `src/lib/api.ts` | 서브패스 대응 fetch 유틸 |
  | `src/lib/base-path.ts` | basePath 정규화 (신규) |
- **Docker Manager 배포 준비 상태**: **준비 완료** (아래 6장의 Dockerfile 확인 3건 선행 권장)
- **원본 커밋 (롤백 지점)**: `be5783c`

## 2. Docker Manager 호환성 결과

| 항목 | 상태 | 비고 |
|---|---|---|
| 프로젝트 유형 감지 | 통과 | `next.config.ts` + `src/app/` → Next.js 풀스택 |
| start 스크립트 | 통과 | `"start": "next start"` |
| `output: 'standalone'` | 통과 | `.next/standalone/server.js` 생성 확인 |
| 포트 설정 | 통과 | `server.js` 가 `PORT`(기본 3000) 사용 |
| 0.0.0.0 바인딩 | **조건부 통과** | `process.env.HOSTNAME \|\| '0.0.0.0'` — Docker 가 `HOSTNAME` 을 컨테이너 ID 로 자동 주입하므로 Dockerfile 에 `ENV HOSTNAME=0.0.0.0` 필요 (6장 참조) |
| 헬스체크 (GET /health) | 통과 | `{"status":"ok"}` 만 반환, DB 체크 없음, `middleware.ts` 부재로 인증 게이트 무관 |
| basePath 헬스체크 호환 | 통과 | `/c/who-am-i/health` → 200 실측 확인 |
| 절대경로 → 상대경로 | 통과 | `src/` 전체에 클라이언트 절대경로 리터럴 0건 |
| `.env.example` | 통과 | 빌드타임/런타임 구분해 재작성 |
| 하드코딩 DB 연결 제거 | 해당 없음 | DB 연결 문자열 0건 |

## 3. 우선순위별 발견 사항 및 수정 내용

### 높음 (배포 필수 / 보안 / 안정성)

| # | 에이전트 | 문제 | 파일 | 수정 내용 | 상태 |
|---|---|---|---|---|---|
| 1 | E | `/api/hello` POST 바디 크기 무제한 → 50MB 수락·에코 실증, 컨테이너 OOM 유발 가능 | `src/app/api/hello/route.ts` | `Content-Length` + 실제 길이 이중 검사, 64KB 초과 시 413 | 완료 (413 실측) |
| 2 | E | 깊게 중첩된 JSON 이 `Response.json()` 직렬화에서 처리되지 않은 예외 → HTTP 500 | `src/app/api/hello/route.ts` | 직렬화를 `try/catch` 로 감싸 400 반환 | 완료 (400 실측) |
| 3 | B·C·F | `basePath` 정규화 부재 — 뒤 슬래시(`/c/who-am-i/`)나 앞 슬래시 누락(`c/who-am-i`) 값이면 `next build` 가 통째로 실패 | `next.config.ts` | `normalizeBasePath()` 도입 | 완료 (두 경우 모두 빌드 성공 확인) |
| 4 | C | `apiUrl('api/me')` 처럼 선행 슬래시 없는 입력이 `/c/who-am-iapi/me` 로 뭉개짐 | `src/lib/api.ts` | 표준 구현대로 슬래시 보정 | 완료 |
| 5 | (검증 중 발견) | **`next.config.ts` 와 `api.ts` 가 같은 환경변수를 각자 정규화해 `/c/who-am-i//api/me` 로 슬래시 중복** | `src/lib/base-path.ts` (신규) | 정규화 함수를 공유 모듈로 분리해 양쪽이 같은 로직을 사용 | 완료 (실측 재현 후 수정 확인) |

> #5 는 에이전트 분석이 아니라 **Phase 4 실행 검증 중 실제로 재현해 발견**한 버그입니다.
> 에이전트 C 가 "두 곳에서 독립적으로 정규화하는 위험"을 예고했고, 그것이 실제로 터진 사례입니다.

### 중간 (보안 / 성능 / 운영)

| # | 에이전트 | 문제 | 파일 | 수정 내용 | 상태 |
|---|---|---|---|---|---|
| 6 | E | `<img src={picture}>` 에 임의 외부 URL 이 들어가 페이지 열람만으로 외부 요청 발생(IP·UA 유출), React 19 는 `<link rel=preload>` 까지 생성 | `src/lib/auth.ts`, `src/app/page.tsx` | `safePictureUrl()` 로 https + `googleusercontent.com` 제한, `referrerPolicy="no-referrer"` 추가 | 완료 (악성 URL 3종 차단 실측) |
| 7 | E | 보안 응답 헤더 전무 (CSP / X-Frame-Options / nosniff / Referrer-Policy) | `next.config.ts` | 4종 헤더 추가, CSP 는 RSC 인라인 스크립트를 고려해 구성 | 완료 (브라우저 콘솔 위반 0건 확인) |
| 8 | E | 사용자별 신원 응답에 `Cache-Control` 부재 → 중간 캐시가 끼면 타인에게 서빙될 수 있음 | `next.config.ts` | `/api/:path*` 에 `private, no-store, max-age=0` | 완료 (헤더 실측) |
| 9 | E | `AUTH_HEADER_NAMES` 의 안전성이 "idToken 만 spread 에서 뺐다"는 암묵적 규약에만 의존 | `src/lib/auth.ts` | allowlist 위에 `SECRET_HEADER_NAMES` denylist 를 한 겹 추가, `getAuthHeaders()` 에서 재확인 | 완료 (Cookie·access-token 미노출 실측) |
| 10 | D | id_token 파싱 실패가 완전 무음 → "토큰이 안 왔다"와 "왔는데 깨졌다"를 구분 불가 | `src/lib/auth.ts` | 실패 사유만 구조화 로그로 기록 (토큰 값은 절대 미기록) | 완료 (로그 실측) |
| 11 | B | `.env.example` 이 빌드타임/런타임 변수를 구분하지 않아 배포자가 런타임에만 주입하게 됨 | `.env.example` | 섹션 분리 + `HOSTNAME` 추가 + 주의사항 명시 | 완료 |
| 12 | G | `engines` 필드 부재 — 베이스 이미지 Node 버전이 낮으면 빌드 단계에서 모호하게 실패 | `package.json` | `"node": ">=20.9.0"` 선언 | 완료 |
| 13 | G | `@types/node` 가 실행 환경(Node 22)보다 2 메이저 뒤처짐 | `package.json` | `^20` → `^22` | 완료 |

### 낮음 (품질 / 관리)

| # | 에이전트 | 문제 | 파일 | 수정 내용 | 상태 |
|---|---|---|---|---|---|
| 14 | D | `AUTH_HEADER_NAMES` 가 변경 가능한 `string[]` 로 export | `src/lib/auth.ts` | `readonly string[]` 로 축소 | 완료 |
| 15 | D | `str()` 이 트림 검사만 하고 원본을 반환해 `first()` 와 동작 불일치 | `src/lib/auth.ts` | 트림한 값 반환 | 완료 |
| 16 | D | `email` 만 `decode()` 를 거치지 않아 헤더 처리가 비일관 | `src/lib/auth.ts` | `decode()` 적용 후 소문자화 | 완료 |
| 17 | D | base64url 패딩을 치환 전 문자열 길이로 계산 (현재는 무해하나 예방적) | `src/lib/auth.ts` | 치환 결과를 변수에 담아 그 길이로 패딩 | 완료 |
| 18 | D | `typeof payload === 'object'` 를 배열이 통과 | `src/lib/auth.ts` | `!Array.isArray()` 가드 추가 | 완료 |
| 19 | E | 헤더 파생 문자열 길이·개수 제한 없음 | `src/lib/auth.ts` | 필드 256자, 그룹 64개 상한 | 완료 |
| 20 | E | `/api/hello` GET 쿼리 무검증 반사 | `src/app/api/hello/route.ts` | `name` 64자 제한 | 완료 |
| 21 | D | `globals.css` 의 `font-family: Arial` 이 Geist 설정과 충돌 | `src/app/globals.css` | 해당 줄 제거 | 완료 |
| 22 | D | 미사용 create-next-app 예시 SVG 5개가 배포 이미지에 포함·외부 노출 | `public/` | 삭제 (`COPY public` 대비 `.gitkeep` 유지) | 완료 |
| 23 | D | `layout.tsx` 만 큰따옴표를 써 스타일 불일치 | `src/app/layout.tsx` | 작은따옴표로 통일 | 완료 |
| 24 | B | `poweredByHeader` 기본값 true → `X-Powered-By` 노출 | `next.config.ts` | `false` | 완료 |
| 25 | B·C·F | README 가 basePath 를 "빌드·런타임 양쪽에 지정"이라고 안내 (런타임 주입은 무효) | `README.md` | 빌드 시점 전용임을 명시 | 완료 |
| 26 | E | 코드 주석의 신뢰 경계 전제가 인터넷 경계만 다뤄 실제보다 느슨함 | `src/lib/auth.ts` | 도커 네트워크 경계로 정정 | 완료 |

## 4. 에이전트별 분석 요약

| 에이전트 | 영역 | 상태 | 발견 문제 수 | 수정 완료 수 |
|---|---|---|---|---|
| A | DB 커넥션/쿼리 | 해당 없음 (DB 미사용, 미실행) | — | — |
| B | 환경변수/설정 | 문제 있음 | 7 | 4 (2건 문서화, 1건 기각) |
| C | 경로 호환성 | 문제 있음 | 7 | 3 (2건 문서화, 2건 기각) |
| D | 코드 품질 | 문제 있음 | 12 | 9 (1건 보류, 2건 미채택) |
| E | 보안 | 문제 있음 | 11 | 8 (3건 수동 조치) |
| F | Docker Manager 호환성 | 양호 (배포 차단 요인 0건) | 9 | 2 (3건 Dockerfile 확인, 4건 문서화) |
| G | 의존성 | 양호 (취약점 0건) | 5 | 2 (3건 미채택) |
| **합계** | | | **51** | **28** |

## 5. 생성된 파일

- `IMPROVEMENTS.md` — 이 보고서
- `src/lib/base-path.ts` — basePath 정규화 공유 모듈 (신규)
- `public/.gitkeep` — Dockerfile 의 `COPY public` 이 실패하지 않도록 디렉토리 유지
- `.env.example` — 재작성 (신규 생성이 아닌 갱신)
- `RECOMMENDED-INDEXES.*` — **생성하지 않음** (DB 미사용)

## 6. 수동 조치 필요 항목

### 6-1. Docker Manager 자동 생성 Dockerfile 에서 확인해야 할 항목 (승인 전)

Dockerfile·`.github/workflows/deploy.yml`·`.dockerignore` 는 워크플로우 지침에 따라 직접 만들지 않았습니다.

> **1·2번은 후속 작업에서 저장소 안에서 해결했습니다** (아래 9장 참조).
> `scripts/prepare-standalone.mjs` 가 `postbuild` 로 실행되어 Dockerfile 이 무엇을 하든
> `.next/standalone` 만 복사하면 동작합니다. Dockerfile 쪽 조치가 더 이상 필요 없습니다.

1. ~~**`ENV HOSTNAME=0.0.0.0`**~~ — **해결됨.** postbuild 가 `server.js` 에 보정 코드를 넣습니다.
2. ~~**`COPY .next/static` 및 `COPY public`**~~ — **해결됨.** postbuild 가 복사합니다.
3. **`ENV NEXT_PUBLIC_BASE_PATH=/c/who-am-i` 가 `RUN npm run build` 보다 먼저** 나오는지 —
   **여전히 확인이 필요합니다.** basePath 는 `server.js` 에 직렬화되어 빌드 시점에 확정됩니다.
   런타임 주입만으로는 반영되지 않으며, 이것만은 앱 안에서 해결할 수 없습니다.
4. (참고) **`HEALTHCHECK` 경로** — basePath 를 켜면 `/health` 는 404 이고 `/c/who-am-i/health` 가 200 입니다.
   Docker Manager 는 외부 헬스체크 시 basePath 를 자동 프리픽스하므로 정상이지만,
   Dockerfile 내부 `HEALTHCHECK` 가 접두 없는 `/health` 를 쓰면 컨테이너가 영구 unhealthy 가 됩니다.

### 6-2. nginx 설정 확인

- `proxy_pass http://app:3000;` — **후행 슬래시가 없어야** 합니다.
  슬래시가 있으면 `/c/who-am-i` prefix 가 제거되어 basePath 와 불일치, 전 경로 404 가 됩니다.
- prefix 정규화용 `return 301` 이 있으면 앱의 308 과 충돌해 리다이렉션 루프가 날 수 있습니다.
  (앱 쪽 원인은 없음을 `routes-manifest.json` 으로 확인했습니다.)

### 6-3. 보안 — 개발자 판단이 필요한 항목

- **id_token 서명 미검증** (에이전트 E, 심각도 높음). 에이전트가 실증했습니다: 서명부를 `AAAA` 로 채운 토큰과
  `alg: none` 토큰이 그대로 파싱되고, `X-Forwarded-Email` / `X-Forwarded-Groups` 를 직접 보내면 신원이 완전히 위조됩니다.
  - **이 앱 자체는 인가 판정을 하지 않으므로 실피해는 "표시가 틀린다" 수준**이고, 트레이드오프는 타당합니다.
  - 다만 README 가 `src/lib/auth.ts` 를 **재사용 모듈로 안내**하고 있어, 다음 앱이 `email`/`groups` 로 인가를
    판정하는 순간 인증 우회가 됩니다. 코드 주석과 README 의 경고는 이번에 강화했지만 **강제되지는 않습니다.**
  - 근본 대책 두 가지 (둘 다 앱 밖 설정이 필요해 자동 적용하지 않았습니다):
    - **(권장)** nginx 가 넣는 공유 비밀 헤더로 프록시 경유를 강제 → 직접 접근 자체가 막히므로 서명 검증 없이 원인 제거
    - 인가에 쓸 경우: `jose` 로 JWKS 서명 + `iss`/`aud` 검증
- **JWT `exp`/`iss` 미검사** — 만료된 토큰의 프로필도 표시됩니다. 다만 이 앱은 진단 도구이고 만료 토큰이 흘러오는
  상황 자체를 보여주는 것이 유용할 수 있어, 표시 동작을 바꾸지 않았습니다. 필요하면 `readProfile()` 에 만료 검사를 추가하세요.
- **`x-forwarded-for` / `x-real-ip` / `x-forwarded-host` 노출** — 내부 네트워크 정보가 화면에 표시됩니다.
  이 앱의 목적(프록시 설정 점검)상 **의도된 설계**로 판단해 유지했습니다.

### 6-4. `/api/hello` 처리 — 사용자 결정 필요

에이전트 D·E·F 가 공통으로 "앱 목적과 무관한 스캐폴딩 데모이므로 삭제"를 권고했습니다.
다만 이 파일은 사용자가 프로젝트 생성 시 **명시적으로 요청한 REST API 예시**이므로 임의로 삭제하지 않았습니다.
대신 바디 크기 상한·직렬화 가드·길이 제한을 넣어 안전하게 만들었습니다. 예시가 더 필요 없다면
`rm -rf src/app/api/hello` 로 제거하세요 (다른 코드가 참조하지 않아 부작용 없음).

## 7. 검증 결과

- **DB 접속 환경**: 해당 없음 (DB 미사용) → 빌드·실행 검증을 모두 수행
- **Sanity 테스트**: **PASS**
  - `npx tsc --noEmit` — 통과
  - `npm run lint` — 통과
  - `npm run build` — 통과 (`/`, `/api/hello`, `/api/me`, `/health`)
- **실행 검증**: **PASS**
  - 의존성 설치: 성공 (`npm install`, 취약점 0건)
  - 앱 실행: 성공 (`.next/standalone/server.js`)
  - 헬스체크: `GET /health` → **HTTP 200**
  - 서브패스 빌드 헬스체크: `GET /c/who-am-i/health` → **HTTP 200**
  - 실행 오류 수정 횟수: **1회** (3장 #5 슬래시 중복 — 발견 후 수정, 재검증 통과)
- **보안 수정 실측 검증**
  | 항목 | 수정 전 | 수정 후 |
  |---|---|---|
  | 50MB POST | 201 (전량 에코) | **413** |
  | 24KB 깊은 중첩 JSON | 500 | **400** |
  | `?name=` 200자 | 전량 반사 | **64자로 절단** |
  | `picture: http://attacker/...` | 렌더 + preload 발생 | **차단(null)** |
  | `picture: javascript:...` | src 에 출력 | **차단(null)** |
  | `picture: https://attacker/...` | 렌더 | **차단(null)** |
  | `picture: https://lh3.googleusercontent.com/...` | 렌더 | **정상 렌더 + `referrerPolicy="no-referrer"`** |
  | Cookie / access-token 헤더 | 미노출 (기존에도 정상) | **미노출 (denylist 2중 방어)** |
  | 보안 응답 헤더 | 없음 | **CSP·X-Frame-Options·nosniff·Referrer-Policy** |
  | `/api/me` Cache-Control | 없음 | **private, no-store, max-age=0** |
- **basePath 정규화 검증**
  | 입력값 | 수정 전 | 수정 후 |
  |---|---|---|
  | `/c/who-am-i` | 정상 | 정상 |
  | `/c/who-am-i/` | 빌드 실패 (E39) | **정상 (`/c/who-am-i`)** |
  | `c/who-am-i` | 빌드 실패 (E105) | **정상 (`/c/who-am-i`)** |
  | (미설정) | 정상 (루트) | 정상 (루트) |
- **브라우저 검증**: 프로덕션 standalone 서버에서 페이지 정상 렌더, **콘솔 오류·CSP 위반 0건**
- **절대 경로 잔존 검사**: **PASS** (`src/` 내 클라이언트 절대경로 리터럴 0건, 유일한 매치는 주석)
- **의존성 취약점**: **0건** (`npm audit`, prod 17 / dev 384 / optional 88 전수)
- **미해결 오류**: 없음
- **롤백한 수정**: 없음

### 미채택 항목과 사유

| 제안 | 에이전트 | 미채택 사유 |
|---|---|---|
| `Dockerfile` / `.dockerignore` 생성 | B, C | 워크플로우 문서가 "Docker Manager 가 자동 생성하므로 직접 만들지 말 것"으로 명시. 6-1 에 확인 항목으로 대체 |
| `/health` 용 `rewrites` 추가 | B, C | Docker Manager 가 헬스체크 시 basePath 를 자동 프리픽스하므로 불필요. 설정 복잡도만 늘어남 |
| `src/lib/api.ts` 삭제 | B, D, F | 사용자가 명시적으로 요청한 파일이자 워크플로우 문서가 요구하는 서브패스 대응 패턴. 삭제 대신 결함(선행 슬래시)을 수정하고 `page.tsx` 에서 실제로 사용하도록 연결 |
| `.prettierrc` 추가 | D | 새 포매터 도입은 전 파일 재포맷을 유발. 따옴표 불일치만 직접 수정 |
| TypeScript 7 / ESLint 10 업그레이드 | G | `eslint-config-next` 가 `next` 와 동일 버전으로 핀되어 있어 peer 충돌 위험. 에이전트 G 자신도 "지금은 올리지 말 것"으로 판단 |
| devDependencies 버전 하한 명시 | G | lock 파일이 이미 재현성을 보장. 실익 대비 변경 폭이 큼 |
| JWT `exp`/`iss` 검증 | E | 표시 동작이 바뀜. 진단 도구 특성상 만료 토큰 표시가 유용할 수 있어 사용자 판단으로 남김 (6-3) |
| `getProxyUser()` 타입 브랜딩 / 함수명 변경 | E | 공개 API 변경. 주석·README 경고 강화로 대체하고 6-3 에 기록 |
| 네트워크 헤더 표시 토글 | E | 이 앱의 목적상 의도된 표시로 판단 |

## 8. 롤백 방법

```bash
git diff be5783c            # 변경 내역 확인
git checkout be5783c -- .   # 원본으로 복구
```

원본 커밋 `be5783c` 는 이 워크플로우 실행 직전 상태이며, 원격(`origin/main`)에도 푸시되어 있습니다.


---

## 9. 후속 수정 — standalone 산출물 자체 보정

6-1 의 1·2번은 "Dockerfile 에서 확인하세요"로 남겨 두었으나, 사용자 요청에 따라 **저장소 안에서 해결**했습니다.
워크플로우 문서가 Dockerfile 직접 생성을 금지하므로, Dockerfile 을 만드는 대신 빌드 산출물을 올바르게 만드는
방향을 택했습니다.

### 변경 내용

| 파일 | 내용 |
|---|---|
| `scripts/prepare-standalone.mjs` (신규) | `postbuild` 로 실행. 정적 자산 복사 + `HOSTNAME` 보정 |
| `package.json` | `"postbuild": "node scripts/prepare-standalone.mjs"` 추가, `"start"` 에 `-H 0.0.0.0` 명시 |

`.next/standalone/server.js` 맨 앞에 아래 판정을 삽입합니다. `HOSTNAME` 이 IPv4·IPv6·`localhost` 가
아니면(= 컨테이너 ID 등 바인딩 주소로 쓸 수 없는 값이면) `0.0.0.0` 으로 되돌립니다.
`HOSTNAME=127.0.0.1` 처럼 **의도적으로 IP 를 지정한 경우는 그대로 존중**합니다.

### 검증 결과 (컨테이너 ID 시뮬레이션: `HOSTNAME=a1b2c3d4e5f6`)

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 서버 기동 | `Error: getaddrinfo ENOTFOUND a1b2c3d4e5f6` — 기동 실패 | `Network: http://0.0.0.0:3405` |
| `127.0.0.1` 접근 | 실패 | **200** |
| LAN IP 접근 | 실패 | **200** |
| CSS (`_next/static`) | 404 | **200** (추가 복사 없이) |
| 서브패스 빌드 `/c/who-am-i/health` | — | **200** |
| 서브패스 빌드 CSS | — | **200** |

> 실제 Docker 환경에서는 컨테이너 ID 가 `/etc/hosts` 를 통해 eth0 IP 로 해석되므로 기동 실패 대신
> **eth0 IP 한 곳에만 바인딩**됩니다. 어느 쪽이든 컨테이너 내부 `localhost:3000` 접근은 실패합니다.

### 멱등성

같은 `.next` 위에서 `npm run build` 를 반복해도 패치 블록은 1개만 유지되고(표식으로 판별),
`fs.cp({ force: true })` 를 써서 `static/static` 같은 중첩 디렉토리가 생기지 않는 것을 확인했습니다.
`output: 'standalone'` 이 아닌 빌드에서는 아무 것도 하지 않고 조용히 건너뜁니다.
