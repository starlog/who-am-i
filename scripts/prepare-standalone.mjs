/**
 * next build 직후(postbuild) 실행되어 standalone 산출물을 "그대로 실행 가능한"
 * 상태로 만든다. Dockerfile 이 무엇을 하든 .next/standalone 만 복사하면
 * 동작하도록 하는 것이 목적이다.
 *
 * 두 가지를 처리한다.
 *
 * 1. .next/static 과 public 복사
 *    output: 'standalone' 산출물에는 이 둘이 포함되지 않는다. 복사하지 않으면
 *    HTML 은 뜨지만 CSS·폰트가 전부 404 다.
 *
 * 2. HOSTNAME 보정
 *    standalone 의 server.js 는 `process.env.HOSTNAME || '0.0.0.0'` 으로 바인딩
 *    주소를 정하는데, Docker 는 컨테이너 안에 HOSTNAME 을 **컨테이너 ID** 로
 *    자동 주입한다. 그러면 서버가 0.0.0.0 이 아니라 eth0 IP 하나에만 바인딩되어
 *    컨테이너 내부 localhost:3000 접근(HEALTHCHECK 등)이 실패한다.
 *    server.js 맨 앞에 보정 코드를 넣어, 바인딩 주소로 쓸 수 없는 값이면
 *    0.0.0.0 으로 되돌린다.
 */
import { access, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

/** 이미 패치했는지 판별하는 표식. 재빌드 시 중복 삽입을 막는다. */
const MARKER = '/* who-am-i: HOSTNAME 보정 */';

const HOSTNAME_PATCH = `${MARKER}
// Docker 는 컨테이너 안에 HOSTNAME 을 컨테이너 ID 로 자동 주입한다. 그 값은
// 바인딩 주소가 아니므로, IP·localhost 가 아니면 0.0.0.0 으로 되돌린다.
{
  const value = process.env.HOSTNAME;
  const bindable =
    typeof value === 'string' &&
    (value === 'localhost' || /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(value) || value.includes(':'));

  if (!bindable) process.env.HOSTNAME = '0.0.0.0';
}
`;

async function exists(target) {
  try {
    await access(target);

    return true;
  } catch {
    return false;
  }
}

async function copyInto(from, to, label) {
  if (!(await exists(from))) {
    console.log(`[prepare-standalone] ${label}: 원본이 없어 건너뜁니다 (${from})`);

    return;
  }

  // force 로 덮어써야 재빌드 시 중첩 디렉토리가 생기지 않는다.
  await cp(from, to, { recursive: true, force: true });
  console.log(`[prepare-standalone] ${label}: 복사 완료 → ${path.relative(root, to)}`);
}

async function patchHostname(serverPath) {
  const source = await readFile(serverPath, 'utf8');

  if (source.includes(MARKER)) {
    console.log('[prepare-standalone] HOSTNAME 보정: 이미 적용되어 있습니다');

    return;
  }

  await writeFile(serverPath, `${HOSTNAME_PATCH}\n${source}`);
  console.log('[prepare-standalone] HOSTNAME 보정: server.js 에 적용했습니다');
}

async function main() {
  if (!(await exists(standalone))) {
    // output: 'standalone' 이 아니면 할 일이 없다. 빌드를 실패시키지는 않는다.
    console.log('[prepare-standalone] .next/standalone 이 없어 건너뜁니다');

    return;
  }

  await copyInto(
    path.join(root, '.next', 'static'),
    path.join(standalone, '.next', 'static'),
    '.next/static',
  );
  await copyInto(path.join(root, 'public'), path.join(standalone, 'public'), 'public');
  await patchHostname(path.join(standalone, 'server.js'));
}

await main();
