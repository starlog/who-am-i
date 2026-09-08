import { NextRequest } from 'next/server';

/**
 * 요청 바디 상한.
 *
 * App Router 라우트 핸들러에는 기본 바디 크기 제한이 없다(구 Pages Router 의
 * api.bodyParser.sizeLimit 은 여기에 적용되지 않는다). 상한이 없으면
 * request.json() 이 전체를 메모리에 버퍼링해 컨테이너 OOM 으로 이어진다.
 */
const MAX_BODY_BYTES = 64 * 1024;

/** 반사되는 쿼리 값의 길이 상한. */
const MAX_NAME_LENGTH = 64;

export async function GET(request: NextRequest) {
  const name = (request.nextUrl.searchParams.get('name') ?? 'world').slice(0, MAX_NAME_LENGTH);

  return Response.json({
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get('content-length') ?? 0);

  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Content-Length 는 없거나 거짓일 수 있으므로 실제 길이도 확인한다.
  const raw = await request.text();

  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    return Response.json({ message: 'Received', body }, { status: 201 });
  } catch {
    // 깊게 중첩된 배열은 파싱은 통과하지만 JSON.stringify 에서 스택이 넘친다.
    return Response.json({ error: 'Unserializable body' }, { status: 400 });
  }
}
