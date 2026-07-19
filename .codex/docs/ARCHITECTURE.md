# 아키텍처

## 1. 구성

```text
Browser
  ├─ Next.js UI
  └─ IndexedDB (GitHub user ID별 칸반)
          │ HTTPS + HttpOnly encrypted cookies
          ▼
apps/web (stateless Next.js)
  ├─ auth
  ├─ notion adapter
  ├─ github adapter
  └─ publisher
       ├────────────▶ Notion API
       └────────────▶ GitHub API ─▶ Actions ─▶ Pages
```

서버 런타임은 `apps/web` 하나이며 사용자 데이터, token, job을 서버 저장소에
영속화하지 않는다.

## 2. 저장 위치

| 데이터 | 저장 위치 | 신뢰 수준 |
|---|---|---|
| GitHub 세션과 credential | 암호화 HttpOnly 쿠키 | 서버에서 복호화·검증 |
| Notion connection과 credential | 암호화 HttpOnly 쿠키 | 서버에서 복호화·검증 |
| 칸반 상태와 UI 설정 | IndexedDB | 비신뢰 입력 |
| 게시 콘텐츠와 이력 | 사용자 GitHub repository | GitHub 권한으로 검증 |
| 배포 상태 | GitHub Actions/Pages | GitHub API에서 조회 |

## 3. package 경계

```text
apps/web
  ├─ packages/auth
  ├─ packages/notion
  ├─ packages/github
  ├─ packages/publisher
  └─ packages/validation
          └─ packages/domain (validation 제외)
```

- `domain`: ID, 칸반 상태, provider 독립 규칙
- `auth`: stateless session 및 암호화 envelope 계약
- `notion`: workspace/page 조회 계약
- `github`: installation/repository/commit 계약
- `publisher`: Notion 문서에서 결정적 artifact 생성
- `validation`: 외부 입력 schema

package끼리 서로 adapter를 import하지 않는다. orchestration은 `apps/web`이 담당한다.

## 4. 요청 경계

### 읽기 요청

1. 세션 쿠키를 해독하고 만료를 확인한다.
2. provider token을 해독한다.
3. provider API에서 현재 권한으로 데이터를 읽는다.
4. 필요한 최소 필드만 브라우저에 반환한다.

### mutation과 게시 요청

1. Origin/CSRF 조건과 세션을 확인한다.
2. 브라우저 payload를 schema로 검증한다.
3. Notion 페이지 접근과 GitHub repository 접근을 다시 확인한다.
4. 최신 원문을 서버에서 가져온다.
5. artifact와 content hash를 결정적으로 생성한다.
6. 기존 hash와 같으면 성공으로 간주하고, 다르면 GitHub에 commit한다.

클라이언트가 전달한 markdown, repository 소유권, 사용자 ID를 그대로 신뢰하지 않는다.

## 5. 쿠키 envelope

envelope에는 최소한 `version`, `keyId`, `issuedAt`, `expiresAt`, payload를 둔다.
AEAD nonce는 매번 새로 생성한다. 복호화 실패, 알 수 없는 key, 만료, schema 불일치는
인증 실패로 처리한다.

현재 cookie codec은 AES-256-GCM을 사용하며 직렬화 형식은
`v1.keyId.nonce.ciphertext.tag`다. `version`과 `keyId`는 AAD에 포함하고,
시간 정보와 payload는 암호문 안에 둔다. 공개 package 진입점에는 타입만 노출하며
구현은 Node 전용 `@notion-kanban-blog/auth/server`에서 import한다.

OAuth state 쿠키와 장기 세션 쿠키는 이름·수명·용도를 분리한다. production에서는
`Secure`를 강제한다. 연결 추가 전에 직렬화된 크기를 검사하고 정책 상한을 넘기지 않는다.

GitHub 로그인은 `/auth/github/start`에서 10분 수명의 state 쿠키를 만들고,
`/auth/github/callback`에서 query state와 상수 시간 비교한 뒤 즉시 쿠키를 삭제한다.
GitHub가 PKCE를 지원하지 않으므로 authorization code와 client secret으로 token을
교환한다. callback code는 GitHub에서도 일회용이며, 애플리케이션은 state 쿠키 삭제로
브라우저에서의 재사용을 차단한다. 성공 세션은 7일 수명이다.

사용자 지정 복귀 경로는 `/`로 시작하는 동일 origin 상대 경로만 허용한다.
`//`, 역슬래시, 절대 URL, OAuth/auth API 경로는 거절한다.

Notion OAuth state에는 현재 GitHub user ID를 함께 봉인한다. callback과 연결 해제는
현재 GitHub 세션의 ID가 일치해야 한다. 연결 쿠키는 여러 사용자의 레코드를 포함할 수
있지만 목록·변경 시 현재 소유자 레코드만 노출한다. 전체 3개 또는 암호문 3,800 bytes를
넘는 새 연결은 저장하지 않고 방금 발급된 token을 revoke한다.

## 6. 장애 특성

- Notion/GitHub API 실패는 요청 실패로 반환하며 브라우저에서 명시적으로 재시도한다.
- commit 이후 응답이 유실되면 다음 요청이 content hash로 기존 반영을 확인한다.
- GitHub Actions/Pages 상태는 GitHub가 source of truth다.
- 서버 재시작은 사용자 상태에 영향을 주지 않지만 쿠키 암호화 키는 안정적으로 유지해야 한다.
