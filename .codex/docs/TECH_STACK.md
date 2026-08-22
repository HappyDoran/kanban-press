# 기술 스택

## 런타임과 저장소

- Node.js 22 LTS (`mise`)
- pnpm 11 + Corepack
- TypeScript strict mode
- pnpm workspace monorepo

## Web 애플리케이션

- Next.js App Router + React
- Route Handler와 Server Component를 서버 경계로 사용
- Tailwind CSS, shadcn/ui
- dnd-kit: 접근 가능한 칸반 drag-and-drop
- IndexedDB + Dexie: 사용자별 보관 문서 정렬과 page 설정 저장
- React state: 새로고침 시 소멸하는 게시 중·완료 상태와 완료 링크
- Zod: 쿠키 복호화 결과, API 입력, IndexedDB 레코드 검증

## 인증과 외부 연동

- GitHub OAuth App: 로그인과 공개 `<login>.github.io` repository 직접 commit
- Notion Public Integration OAuth + 공식 Notion SDK
- Node `crypto` 기반 AEAD 암호화 쿠키
- OAuth state는 짧게 만료되는 별도 암호화 HttpOnly 쿠키로 검증

GitHub OAuth는 `read:user public_repo workflow`만 요청한다. `workflow`는 생성되는
`.github/workflows/deploy.yml`을 commit하기 위해 필요하다. private repository와
임의의 repository 선택은 지원하지 않는다. 서버는 요청마다 OAuth scope와 고정 Pages
repository의 소유권·쓰기 권한을 다시 검증한다.

Better Auth는 DB 없는 세션·복수 provider token 쿠키 계약보다 추상화 비용이 커서
MVP에서는 사용하지 않는다. OAuth 흐름과 쿠키 codec을 작은 내부 모듈로 구현한다.

## 게시

- Notion 예약 page property와 block → 공유 `PublishDocument` v2 → Markdown/MDX 변환
- 목록·할 일·callout·table과 중첩 자식을 보존하는 구조적 Markdown/제한 HTML 변환
- Astro content schema가 v1 frontmatter를 `미분류`로 정규화하고 v2 metadata를 strict 검증
- template v2 compatibility reader와 v2 Markdown writer를 순서대로 적용한 mixed collection 지원
- Astro 7.1.1 정적 블로그 template: 반응형 홈·전체 글·category index/detail·글 상세·404
- Astro passthrough image service로 로컬 게시 자산을 변환 의존성 없이 base path에 맞춰 복사
- `actions/setup-node@v6` + `pnpm/action-setup@v6`로 명시적인 lockfile 없는 build
- pnpm dependency build script는 `pnpm-workspace.yaml`에서 Astro가 요구하는
  `esbuild`만 `allowBuilds`로 허용
- `actions/upload-pages-artifact@v5` + `actions/deploy-pages@v5` GitHub Pages workflow
- GitHub Contents 또는 Git Data API로 결정적 파일 반영
- Git tree 조회로 empty/app-managed/legacy/unmanaged repository를 구분하고 unmanaged
  repository에는 commit하지 않음
- GitHub Pages API로 `build_type=workflow` readiness 확인
- GitHub Actions와 GitHub Pages가 build/deploy 수행
- Web 앱은 GitHub API를 polling해 결과를 표시
- preview route는 공유 `PublishDocument`를 strict Zod DTO로 투영하고 React dialog가
  raw HTML 없이 렌더링하며 image URL 없는 placeholder로 표시
- Node HTTPS + DNS lookup 고정 방식의 image downloader가 public HTTPS endpoint만 허용하고
  JPEG/PNG/GIF/WebP를 bounded stream으로 받아 `src/assets/blog/<slug>/` artifact로 변환

## 테스트

- Vitest: domain, 암호화 codec, adapter 단위 테스트
- MSW 또는 fetch mock: GitHub/Notion contract test
- Vitest integration: mutable fake provider로 preview→원문/권한 변경→publish와 실제
  publisher v2/category/image artifact 연결 검증
- Astro fixture build: 구조적 Notion block의 Markdown과 최종 semantic HTML 회귀 검증
- Playwright: OAuth를 대체한 브라우저 E2E와 IndexedDB 격리 검증
- Playwright + axe-core: production build에서 desktop·320px mobile 핵심 흐름,
  WCAG serious/critical 위반, overflow와 DCL 3초·전송량 3MB 회귀 예산 검증

실제 provider credential이 필요한 `pnpm test:smoke`는 로컬 필수 검증과 분리한다.
Vitest의 `smoke` mode가 gitignored `.env.smoke.local`을 읽고 실제 Notion/GitHub의
read-only retrieve/readiness만 확인하며 commit API는 호출하지 않는다.

Provider OAuth·REST fetch는 10초 timeout을 공유한다. 운영 로그는 provider, allowlist
operation, 안정적인 code, status, bounded duration/Retry-After만 JSON 한 줄로 기록한다.
credential, cookie, URL, 사용자·문서·repository 식별자와 임의 오류 문자열은 기록하지 않는다.

## 배포 단위

- Web: 단일 Next.js 서비스
- Blog: 사용자별 GitHub repository와 GitHub Pages

PostgreSQL, ORM, RLS, Redis, pg-boss, 별도 Worker, R2/MinIO는 MVP에 포함하지 않는다.

## DB를 사용하지 않는 이유

현재 제품은 팀 공유나 서버 동기화가 필요하지 않다. 사용자별 칸반은 브라우저에,
게시 결과는 GitHub에 이미 영속화된다. 따라서 별도 DB는 동일 데이터를 복제하면서
운영 비용과 데이터 격리 책임만 늘린다.

다음 요구가 생기면 DB 도입을 다시 판단한다.

- 여러 기기 간 칸반 동기화
- 팀 공동 작업과 역할 권한
- 영구 배포 이력, 감사 로그, 예약 게시
- 서버 측 신뢰 가능한 재시도와 webhook 상태 관리
- 쿠키 예산을 넘는 다수의 Notion 연결
