# Notion Kanban Blog

각 사용자가 GitHub로 로그인하고 자신의 Notion 문서를 개인 칸반에서 관리해
자신의 GitHub Pages 블로그에 게시하는 애플리케이션입니다.

서버 DB는 사용하지 않습니다. 인증과 Notion 연결은 암호화된 HttpOnly 쿠키,
보관 문서의 순서와 표시 설정은 GitHub 사용자 ID로 구분한 브라우저 IndexedDB에
저장합니다. 게시 중·완료 표시는 현재 화면의 메모리에만 유지되어 새로고침하면
사라지며, 실제 게시 결과는 사용자 GitHub repository를 source of truth로 사용합니다.

제품 요구사항은 `.codex/docs/PROJECT_SPEC.md`, 구현 순서는 `.codex/TODO.md`를
기준으로 합니다.

## 요구사항

- [mise](https://mise.jdx.dev/)
- Node.js 22 LTS
- Corepack과 pnpm 11

```bash
mise install
mise exec -- node --version
```

## 설치와 실행

Docker나 PostgreSQL은 필요하지 않습니다.

```bash
mise exec -- corepack pnpm install --frozen-lockfile
mise exec -- corepack pnpm dev
```

기본 화면은 `http://localhost:3000`, health endpoint는
`http://localhost:3000/api/health`입니다.

Web 앱만 실행하려면:

```bash
mise exec -- corepack pnpm --filter @notion-kanban-blog/web dev
```

## GitHub 로그인 설정

`.env.example`을 기준으로 `apps/web/.env.local`을 만들고 다음 값을 설정합니다.

```text
GITHUB_OAUTH_CLIENT_ID
GITHUB_OAUTH_CLIENT_SECRET
GITHUB_API_VERSION
COOKIE_ENCRYPTION_KEY_V1
COOKIE_ACTIVE_KEY_ID
APP_ORIGIN
```

로컬 GitHub OAuth App에는 다음 주소를 등록합니다.

```text
Homepage URL: http://localhost:3000
Authorization callback URL: http://localhost:3000/auth/github/callback
```

32-byte base64url 쿠키 키는 다음과 같이 생성할 수 있습니다.

```bash
mise exec -- node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

로그인 시작 경로는 `/auth/github/start`, 현재 사용자 API는 `/api/me`,
로그아웃은 `POST /auth/logout`입니다.

로그인 OAuth는 `read:user public_repo workflow` scope를 요청합니다. 기존에
`workflow` 없이 승인한 사용자는 메인 화면에서 GitHub 권한을 한 번 다시 승인해야
합니다.

## Notion 연결 설정

Notion Creator dashboard에서 Public Connection을 만들고 다음 redirect URI를
등록합니다.

```text
http://localhost:3000/auth/notion/callback
```

`apps/web/.env.local`에 다음 값을 추가합니다.

```text
NOTION_OAUTH_CLIENT_ID
NOTION_OAUTH_CLIENT_SECRET
NOTION_API_VERSION=2026-03-11
```

GitHub 로그인 후 메인 화면의 `Notion 연결` 버튼으로 OAuth를 시작할 수 있습니다.
연결 목록은 `GET /api/notion/connections`, 연결 해제는
`POST /api/notion/connections/disconnect`를 사용합니다.

## GitHub Pages 게시 대상

별도 GitHub App은 필요하지 않습니다. 로그인한 사용자가 자신의 공개
`<GitHub login>.github.io` repository를 준비하면 서버가 OAuth credential로 소유권,
공개 여부와 push 권한을 확인합니다.

```text
예: GitHub login이 octocat이면 octocat/octocat.github.io
```

게시 기능은 이 repository에 생성된 정적 블로그 파일을 직접 commit합니다. private
repository와 다른 이름의 repository는 MVP 게시 대상으로 사용할 수 없습니다.
같은 문서를 다시 게시해도 매번 새 commit과 GitHub Actions 실행을 생성합니다.

## 검증

```bash
mise exec -- corepack pnpm lint
mise exec -- corepack pnpm typecheck
mise exec -- corepack pnpm test
mise exec -- corepack pnpm test:integration
mise exec -- corepack pnpm build
```

## 구조

```text
apps/
└── web/             # stateless Next.js 애플리케이션
packages/
├── auth/            # 암호화 쿠키와 OAuth 계약
├── domain/          # provider 독립 타입과 상태 규칙
├── github/          # GitHub OAuth repository/commit 계약
├── notion/          # Notion workspace/page 계약
├── publisher/       # 결정적 게시 artifact 계약
└── validation/      # 외부 입력 schema
templates/
└── astro-blog/      # GitHub Pages 정적 블로그
```

루트의 기존 `src/`, `scripts/`, `astro.config.mjs`는 교체 전까지 보존하는
단일 사용자 프로토타입입니다. 신규 앱에서 import하지 않습니다.
