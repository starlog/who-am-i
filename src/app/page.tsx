import { displayName, getAuthHeaders, getProxyUser } from '@/lib/auth';

/**
 * 프록시(oauth2-proxy)가 넘겨준 로그인 정보를 그대로 보여준다.
 *
 * headers() 를 호출하므로 이 페이지는 매 요청 서버에서 렌더링된다
 * (정적 프리렌더링 대상에서 자동으로 빠진다).
 */
export default async function Home() {
  const user = await getProxyUser();
  const authHeaders = await getAuthHeaders();

  return (
    <div className="flex min-h-screen justify-center bg-zinc-50 p-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-4">
        <header className="pt-4">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Who am I
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            앞단 oauth2-proxy 가 요청 헤더로 전달한 로그인 정보입니다.
          </p>
        </header>

        <section className="rounded-lg border border-black/10 bg-white p-6 dark:border-white/15 dark:bg-zinc-950">
          {user ? (
            <>
              <div className="flex items-center gap-4">
                {user.profile?.picture && (
                  // 외부(googleusercontent) 이미지라 next/image 는 도메인 설정이 필요하다.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.profile.picture}
                    alt=""
                    width={48}
                    height={48}
                    className="size-12 shrink-0 rounded-full border border-black/10 dark:border-white/15"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-lg font-medium text-black dark:text-zinc-50">
                    {displayName(user)}
                  </p>
                  <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{user.email}</p>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 border-t border-black/10 pt-5 text-sm dark:border-white/10">
                <Row label="이메일" value={user.email} />
                <Row label="이름 (id_token)" value={user.profile?.name ?? null} />
                <Row label="preferred_username" value={user.preferredUsername} />
                <Row label="X-Forwarded-User" value={user.user} />
                <Row label="구글 고유 ID (sub)" value={user.profile?.subject ?? null} />
                <Row label="그룹" value={user.groups.length > 0 ? user.groups.join(', ') : null} />
              </dl>

              {!user.profile && (
                <p className="mt-5 rounded-md bg-black/[.04] p-3 text-xs leading-relaxed text-zinc-600 dark:bg-white/[.06] dark:text-zinc-400">
                  이름·프로필 사진은 id_token 에서 나옵니다. 지금은 토큰이 전달되지 않고
                  있습니다. oauth2-proxy 에{' '}
                  <code className="font-mono">set-authorization-header</code> 를 켜고 nginx 가 그
                  값을 넘기도록 설정해야 합니다 (README 참고).
                </p>
              )}
            </>
          ) : (
            <p className="rounded-md border border-dashed border-black/15 px-3 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
              인증 헤더가 없습니다. 프록시(nginx + oauth2-proxy)를 거치지 않은 요청이거나, 해당
              프로젝트가 <code className="font-mono">skip_auth=1</code> 로 설정되어 인증 게이트를
              지나지 않는 경우입니다.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-black/10 bg-white p-6 dark:border-white/15 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-black dark:text-zinc-50">
            실제로 도착한 헤더 원문
          </h2>

          {Object.keys(authHeaders).length > 0 ? (
            <dl className="mt-4 grid grid-cols-[15rem_1fr] gap-x-4 gap-y-2 font-mono text-xs">
              {Object.entries(authHeaders).map(([name, value]) => (
                <Row key={name} label={name} value={value} />
              ))}
            </dl>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-black/15 px-3 py-8 text-center text-xs text-zinc-500 dark:border-white/20">
              전달된 프록시 헤더가 없습니다.
            </p>
          )}

          <p className="mt-5 text-xs leading-relaxed text-zinc-500">
            Cookie · Authorization(id_token) 헤더는 값 자체가 자격증명이므로 표시하지 않습니다.
            JSON 이 필요하면 <code className="font-mono">/api/me</code> 를 호출하세요.
          </p>
        </section>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="truncate text-zinc-500">{label}</dt>
      <dd className="break-all text-black dark:text-zinc-100">
        {value ?? <span className="text-zinc-400 dark:text-zinc-600">(없음)</span>}
      </dd>
    </>
  );
}
