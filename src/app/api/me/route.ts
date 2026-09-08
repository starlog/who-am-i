import { displayName, getAuthHeaders, getProxyUser } from '@/lib/auth';

/**
 * 프록시(oauth2-proxy)가 전달한 로그인 사용자 정보.
 *
 * 인증은 앞단에서 이미 끝나 있으므로 이 라우트는 헤더를 읽어 되돌려줄 뿐이다.
 * 프록시를 거치지 않은 요청(로컬 npm run dev 등)에서는 user 가 null 이다.
 */
export async function GET() {
  const user = await getProxyUser();

  return Response.json({
    user,
    displayName: user ? displayName(user) : null,
    // 프록시 설정 점검용. 비어 있으면 nginx 가 헤더를 안 넘기고 있다는 뜻이다.
    headers: await getAuthHeaders(),
  });
}
