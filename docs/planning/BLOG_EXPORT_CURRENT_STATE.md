---
title: GitHub Pages 블로그 내보내기 현황 감사
kind: snapshot
last_verified: 2026-08-09
---

# GitHub Pages 블로그 내보내기 현황 감사

- 감사일: 2026-08-09
- 기준 revision: `0d76b2f` (`HappyDoran/blog-export-audit`, 감사 문서 작성 전)
- 범위: `packages/publisher`, `apps/web/lib/publish`, GitHub/Notion adapter의 게시 경계,
  `/api/publish` 및 `/api/publish/status`, GitHub Pages 대상 UI와 칸반 게시 UI, 관련 테스트
- 방법: `AGENTS.md`, 프로젝트 명세/기술 스택/아키텍처/TODO를 먼저 읽고 코드와
  테스트를 심볼 단위로 대조했다. 실제 GitHub/Notion credential을 사용하는 provider smoke
  test나 실제 Pages 배포는 수행하지 않았다.

## 결론

현재 구현은 **Notion 원문을 서버에서 다시 읽어 제한된 문서 모델로 정규화하고, 안전한
Markdown 한 파일과 Astro 블로그 골격을 사용자의 공개 `<login>.github.io` repository에
직접 commit한 뒤 Actions/Pages를 polling하는 MVP vertical slice**다. 결정적 artifact,
경로/HTML/URL 검증, provider 권한 재검증, non-force commit, 사용자별 transient UI 상태라는
핵심 보안·아키텍처 계약은 코드와 단위/통합 테스트에 대체로 반영되어 있다.

다만 “repository가 있으면 바로 게시 가능”하다고 보기에는 운영상 공백이 있다. 가장 큰
실행 위험은 생성 workflow가 `main` push로 고정되어 실제 `defaultBranch`가 다른 repository에
commit하면 workflow가 시작되지 않는 점이다. 또한 Pages의 custom workflow 활성화 여부를
확인하거나 설정하지 않고, 기존 repository의 핵심 설정 파일을 사전 diff/preview 없이
덮어쓰며, 배포 로그 URL을 API로 받아도 UI에서 버린다. 브라우저 새로고침 이후에는 진행 중인
배포와 완료 링크를 복구하지 않으며, 실제 provider를 포함한 E2E도 없다. 따라서 현재 상태는
**코드 경로와 생성 사이트 build가 검증된 MVP**이지, 다양한 실제 사용자 repository에서
end-to-end로 검증된 내보내기 제품은 아니다.

## 현재 책임과 데이터 흐름

| 계층 | 현재 책임 | 근거 |
|---|---|---|
| 게시 UI | `stored`/`published` 카드를 `publishing` column에 drop하면 게시 시작, 경과 시간·완료 링크·일반 오류 표시 | `KanbanBoard`, `BoardCard` — `apps/web/app/kanban-board.tsx`; `runPublish`, `publishBoardRecord` — `apps/web/app/notion-browser.tsx` |
| 게시 API | Origin, GitHub session, 입력 UUID, 소유 Notion connection을 검증하고 두 provider 권한을 재조회 | `publishNotionPage` — `apps/web/lib/publish/orchestration.ts`; `POST` — `apps/web/app/api/publish/route.ts` |
| Notion 변환 | 최신 page와 재귀 block children을 조회해 제한된 `NotionContentBlock` union으로 정규화 | `NotionRestContentAdapter.getPageContent`, `publishableBlocks` — `apps/web/lib/notion/content.ts` |
| Publisher | Astro template manifest와 escaped Markdown artifact 생성 | `createAstroTemplateManifest` — `packages/publisher/src/index.ts`; `createMarkdownArtifact` — `packages/publisher/src/markdown.ts` |
| GitHub 반영 | 고정 user-site repository 재검증, blob/tree/commit 생성, non-force ref 갱신 | `GitHubPagesClient.getPagesRepository`, `commitArtifacts` — `apps/web/lib/github/pages.ts` |
| 상태 조회 | 같은 repository 권한을 재검증하고 workflow run과 Pages deployment를 commit SHA로 조회 | `getPublishStatus` — `apps/web/lib/publish/orchestration.ts`; `GitHubPagesClient.getDeploymentStatus` — `apps/web/lib/github/pages.ts` |
| 상태 저장 | `stored`와 표시 여부만 IndexedDB에 저장; `publishing`, `published`, 완료 URL은 React memory에만 저장 | `PublishViewState`, `publishViewStates` — `apps/web/app/notion-browser.tsx`; v12 migration — `apps/web/lib/board/repository.ts` |

## 현재 생성 파일

`createAstroTemplateManifest`는 경로순으로 정렬된 아래 11개 template artifact를 매 게시
요청마다 생성한다. `publishNotionPage`가 여기에 현재 문서의 Markdown 한 개를 더해 commit한다.

| 경로 | 역할 및 현재 내용 |
|---|---|
| `.github/workflows/deploy.yml` | `main` push 및 수동 실행, Node 24, pnpm 11.15.0, Astro build, Pages artifact upload/deploy |
| `.gitignore` | `node_modules`, `dist`, `.astro` 제외 |
| `astro.config.mjs` | 정적 output, `site`, user/project-site `base` |
| `package.json` | Astro 7.1.1 하나를 runtime dependency로 두고 `astro build` 제공 |
| `pnpm-workspace.yaml` | dependency build 중 `esbuild`만 허용 |
| `src/content.config.ts` | `blog` collection과 title/description/publishedAt/updatedAt schema |
| `src/content/blog/.gitkeep` | 빈 collection 유지 |
| `src/layouts/BaseLayout.astro` | 한국어 기본 HTML, 내장 최소 CSS, header와 content slot |
| `src/pages/index.astro` | `publishedAt` 내림차순 글 목록 |
| `src/pages/posts/[...slug].astro` | collection의 각 Markdown을 `/posts/<slug>/`로 정적 생성 |
| `tsconfig.json` | Astro strict TypeScript 설정 상속 |
| `src/content/blog/<slug>.md` | 요청한 Notion page 한 건의 frontmatter와 변환 본문 |

근거는 `templateFiles`와 `artifact` (`packages/publisher/src/index.ts`),
`createMarkdownArtifact` (`packages/publisher/src/markdown.ts`), artifact 병합/정렬 부분인
`publishNotionPage` (`apps/web/lib/publish/orchestration.ts`)다. GitHub 반영은 현재 head tree를
`base_tree`로 사용하므로 목록 밖의 기존 파일은 보존하지만, 위와 경로가 같은 기존 파일은
새 blob으로 교체한다. 삭제 artifact는 없으므로 이전 게시물이 자동 삭제되지는 않는다.

### 지원하는 콘텐츠와 축약

- 직접 보존: paragraph, heading, quote, code, HTTPS image, toggle, divider, rich-text의
  bold/italic/strikethrough/code 및 HTTP(S)/mailto link.
- 변환/축약: Notion heading 1/2/3은 게시물의 2/3/4단계 heading이 된다. bookmark, embed,
  link preview는 caption/link paragraph가 되고, bulleted/numbered list item, to-do, callout은
  일반 paragraph로 평탄화된다.
- 제외/손실: child page/database는 현재 글 본문에 포함하지 않는다. 별도 처리되지 않는
  block은 자식만 남기거나 사라지므로 list marker, checkbox 상태, callout 표현, table 구조,
  equation 등 Notion의 원래 의미/레이아웃을 완전히 보존하지 않는다.
- 안전 경계: slug는 소문자 영숫자와 단일 `-`만 허용하고, 사용자 HTML/Markdown을 escape한다.
  link는 `http:`, `https:`, `mailto:`만, image는 `https:`만 허용한다. block 깊이 20,
  document/block/rich-text 크기 상한, GitHub artifact 200개/총 20 MiB 상한이 있다.

## URL 계약

| 대상 | 현재 값 | 근거/비고 |
|---|---|---|
| 게시 repository | `<login>/<login>.github.io` | `GitHubPagesClient.getPagesRepository`; 개인 사용자 소유, public, push 가능, `public_repo`(또는 `repo`) + `workflow` scope를 매 요청 확인 |
| 사이트 root | `https://<login>.github.io/` | `createAstroTemplateManifest.siteUrl`; 앱의 실제 publish 대상은 user site로 고정 |
| 글 slug | `<정규화한-영문-제목>-<page-id 앞 12 hex>`; 영문이 없으면 `notion-<suffix>` | `pageSlug` — `apps/web/lib/publish/orchestration.ts` |
| 글 URL | `https://<login>.github.io/posts/<slug>/` | 최초 publish response의 `pageUrl`; 성공 카드의 “게시된 글 보기”에 사용 |
| Actions URL | GitHub workflow run의 `html_url` 또는 `null` | 상태 API가 반환하지만 `parsePublishStatus`가 `state`만 남겨 현재 UI에는 노출하지 않음 |

Publisher 자체는 project site의 `/<repository>` base도 생성·build test하지만, web 앱은 임의
repository 선택을 허용하지 않아 실제 사용자 흐름에서는 쓰이지 않는다. custom domain/CNAME은
조회하지 않고 username URL을 합성한다. 제목 변경 시 page ID suffix는 유지되지만 제목 부분이
바뀌어 새 Markdown 경로가 생기며, 이전 경로를 삭제하지 않으므로 같은 Notion page가 두 글로
남을 수 있다.

## 현재 사용자 플로우

1. 사용자가 GitHub로 로그인하고 Notion workspace를 연결한다.
2. `GitHubPagesTarget`이 `GET /api/github/pages-repository`로 공개
   `<login>.github.io` repository, scope, 소유권, push 권한을 확인한다. 없으면 GitHub의 새
   repository 화면으로, scope가 부족하면 GitHub 재승인으로 안내한다.
3. 사용자가 Notion 계층에서 document를 칸반에 표시하고 `보관 중` 카드를 `게시 중` column에
   pointer 또는 keyboard drag-and-drop한다. 별도 게시 버튼이나 artifact preview는 없다.
4. UI가 memory state를 `publishing`으로 바꾸고 `POST /api/publish`에 connection/page ID만
   보낸다. 서버는 session/connection과 양 provider 접근을 다시 검증하고 최신 원문을 읽는다.
5. 서버가 template 11개와 Markdown 한 개를 만들고 content hash를 계산한다. 현재 branch
   head를 parent로 새 commit을 만들며 동일 콘텐츠라도 UUID가 든 commit message 때문에 매
   요청 새 commit을 만든다. 빈 repository면 parent 없는 첫 commit과 branch ref를 만든다.
6. UI가 commit SHA로 최대 120회, 3초 간격(약 6분) 상태를 조회한다. 카드에는 “GitHub Pages
   배포 중”과 경과 시간만 표시된다.
7. Pages가 성공하면 IndexedDB의 `isVisible`을 false로 바꾸되 현재 화면에는 transient
   `게시 완료` 카드와 “게시된 글 보기” 링크를 유지한다. 완료 카드를 `게시 중`으로 다시 drop하면
   재게시하고, `보관 중`으로 drop하면 다시 표시한다.
8. 실패하면 transient 상태를 제거해 `보관 중`으로 돌리고 카드에 일반 오류를 표시한다. 다시
   게시하려면 사용자가 카드를 다시 drag-and-drop한다.

새로고침, 탭 종료, account/repository 재로딩은 publish state, commit SHA, content hash,
완료 URL을 복구하지 않는다. 성공을 UI가 관찰한 뒤에는 record가 숨겨져 새로고침 후 카드가
사라지고, 배포 중 탭을 닫으면 visibility가 그대로여서 다음 접속에는 보관 카드로 보일 수 있다.

## 프리뷰와 사용자 경험

### 현재 제공되는 것

- 게시 전 repository 준비 상태: 대상 full name과 default branch를 보여준다.
- 게시 중 피드백: 3단계 column, spinner 성격의 mark, 초 단위 경과 시간.
- 게시 후 확인: 현재 화면 수명 동안 직접 글 URL을 새 탭으로 연다.
- 접근 방식: dnd-kit pointer/keyboard sensor와 screen-reader drag 안내가 있다.
- 오류 후 수동 재시도: 카드를 다시 `게시 중`으로 drop할 수 있다.

### 현재 없는 것

- Notion 변환 결과의 Markdown/HTML preview, 생성 파일 목록/diff, 최종 URL 사전 확인.
- 기존 repository 파일 덮어쓰기 범위에 대한 경고와 사용자 확인.
- commit 링크, Actions 로그 링크, content hash, provider별 구체 오류, 진행 단계(build/deploy) 표시.
- 버튼 기반 게시 대안. drag-and-drop 동작을 발견하지 못하거나 사용하기 어려운 사용자는 안내
  문구와 keyboard DnD에 의존한다.
- repository 상태가 `ready`가 아닐 때 게시 동작을 차단하는 연결. 대상 카드가 missing/scope/error
  상태여도 칸반 drop은 가능하고 나중에 일반 게시 오류로 귀결된다.
- 새로고침 후 진행 중/완료 배포 복구, 영구 게시 이력, 취소, 자동 retry, webhook.
- custom domain, 테마 선택, draft preview, 게시 취소/삭제/unpublish.

## 제약과 감사 발견사항

### P0 — 실제 배포를 막을 수 있음

1. **workflow branch가 `main`으로 고정된다.** `templateFiles`의 trigger는
   `branches: [main]`이지만 `GitHubPagesClient.commitArtifacts`는 repository가 반환한
   `defaultBranch`에 commit/ref update한다. 기본 branch가 `master` 등인 기존 user-site에서는
   commit은 성공하고 UI는 polling을 시작하지만 해당 push workflow가 실행되지 않아 약 6분 뒤
   일반 timeout 오류가 된다. manifest 생성 시 default branch를 입력받아 workflow trigger와
   일치시키거나, 고정 `main`을 제품 전제조건으로 검증/안내해야 한다.

2. **Pages custom workflow 활성화를 확인하거나 수행하지 않는다.** repository 조회는 일반
   repository metadata와 scope/권한만 확인하며 `/repos/{owner}/{repo}/pages` 상태나
   `build_type: workflow`를 확인하지 않는다. 생성 workflow에도 GitHub가 권장하는
   `actions/configure-pages` 단계가 없다. GitHub 공식 문서상 custom workflow 사용 전에 Pages를
   활성화해야 한다. 현재 OAuth의 좁은 `public_repo workflow` 정책을 유지하면서 자동 활성화가
   가능한지, 사용자가 Settings에서 수동 활성화해야 하는지를 결정하고 UI에 준비 상태로
   반영해야 한다. 참고: [GitHub custom workflow 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
   [Pages REST API](https://docs.github.com/en/rest/pages/pages?apiVersion=2022-11-28).

### P1 — 데이터/운영 위험과 UX 단절

3. **기존 repository를 preview 없이 침습적으로 수정한다.** 매 게시가 `package.json`, Astro
   config, content config, layout, index/posts route, workflow 등을 같은 경로에서 교체한다.
   repository가 비어 있어야 한다는 검증, app-managed marker, 예상 diff, 확인 단계가 없다.
   사용자의 기존 GitHub Pages 소스가 있으면 그 구조나 dependency가 깨질 수 있다.

4. **제목 변경은 고아 글을 만든다.** slug에 제목과 page ID가 함께 들어가지만 old slug를 추적하거나
   삭제하지 않는다. 제목 변경 후 재게시는 새 파일을 추가하므로 index에 신/구 글이 모두 보인다.
   page ID만으로 안정 경로를 만들지, frontmatter에 provider ID를 저장해 이전 artifact를 찾아
   교체할지 결정이 필요하다.

5. **오류가 행동 가능한 정보로 이어지지 않는다.** 서버는 Notion/GitHub rate limit, scope,
   access, conflict 등을 상태 코드와 error code로 구분하고 status API는 `actionsUrl`도 반환하지만,
   `runPublish`는 모든 실패를 한 문구로 합치고 `parsePublishStatus`는 Actions URL을 버린다.
   문구가 “배포 로그를 확인”하라고 하지만 실제 링크는 없다. provider 오류별 안내, repository
   재확인/재승인, Actions 링크, conflict 재시도 동작을 연결해야 한다.

6. **약 6분 polling과 transient state만 존재한다.** 120회 × 3초 뒤 실패 처리하며 요청별 timeout,
   backoff, `Retry-After`, visibility change, AbortController가 없다. 배포가 늦지만 정상인 경우에도
   실패로 보일 수 있고, 새로고침 후 resume할 수 없다. 이는 DB-free MVP의 명시적 제약이지만,
   P3의 “provider rate limit, timeout, 사용자 재시도 UX”가 실제 출시 전 필요하다.

7. **동시 반복 게시의 배포 순서가 보장되지 않는다.** 동일 콘텐츠도 새 commit/Actions 실행을
   만드는 것이 요구사항이지만 생성 workflow에는 Pages concurrency group이 없다. 여러 commit의
   build/deploy가 겹칠 때 최신 commit이 최종 배포된다는 제품 보장을 코드에서 만들지 않는다.
   반복 게시 허용과 오래된 deployment 직렬화/취소 정책을 함께 결정해야 한다.

8. **Notion-hosted image URL을 그대로 영속 콘텐츠에 넣는다.** `providerFileUrl`이 `file` URL도
   Markdown에 그대로 전달하며 별도 다운로드/asset commit이 없다. provider 서명 URL이 만료되면
   이미 게시된 정적 글의 이미지가 깨질 수 있다. 외부 HTTPS image만 허용할지, 게시 시 asset을
   repository로 복사할지 결정해야 한다.

### P2 — 품질과 확장 기회

9. **콘텐츠 fidelity가 제한적이다.** list/to-do/callout은 paragraph로 평탄화되고 여러 block
   종류가 빠진다. 지원 매트릭스를 UI에 공개하고, 우선순위가 높은 list, checklist, table,
   equation, media/file을 명시적으로 지원하거나 게시 전 경고해야 한다.

10. **URL과 날짜 의미가 고정적이다.** custom domain을 무시하고 username URL을 합성하며,
    `publishedAt`은 실제 최초 게시 시각이 아니라 Notion page `createdAt`이다. 목록 정렬과 독자의
    날짜 인식에 영향을 준다. “Notion 작성일”인지 “블로그 발행일”인지 제품 결정을 명확히 해야 한다.

11. **생성 블로그는 최소 골격이다.** responsive한 단일 column과 기본 metadata는 있으나 RSS,
    sitemap, canonical/Open Graph, syntax highlighting, navigation, 404, pagination, theme/customization,
    이미지 localization이 없다. 이는 동작 결함보다는 다음 template version 범위다.

## 테스트 기준 현황

| 영역 | 현재 증명하는 것 | 남은 공백 |
|---|---|---|
| `packages/publisher/src/index.test.ts` | user/project base path, 결정성, 정렬, workflow 핵심 문자열, 이름/경로 injection 거절 | 전체 artifact snapshot, default-branch workflow, Pages enable/configure/concurrency 미검증 |
| `packages/publisher/src/markdown.test.ts` | 주요 block 출력, HTML/Markdown escape, unsafe link/image, slug와 깊이 제한 | block 지원 매트릭스 전체, 대용량 경계, 실제 Notion file URL 수명 미검증 |
| `packages/publisher/src/template.integration.test.ts` | 생성 template에 fixture 글을 넣어 user/project site Astro build, index/post HTML 확인 | cold install, workflow YAML 실행, 실제 Actions/Pages, 기존 repo overlay 미검증 |
| `apps/web/lib/notion/content.test.ts` | 최신 page/children 재귀 조회와 대표 block 변환, pagination/오류 fixture | 실제 provider smoke, 모든 unsupported block의 사용자-visible 진단 미검증 |
| `apps/web/lib/github/pages.test.ts` | scope/소유권/public/push, 기존/빈 repo commit, 동일 tree 새 commit, 상태 해석 | 실제 OAuth/Actions/Pages API, non-main default branch end-to-end, Pages 설정 미검증 |
| `apps/web/lib/publish/orchestration.test.ts` | 서버 생성 artifact만 commit, 양 provider 재검증, 반복 게시 unique commit, Origin 거절, status 권한 재검증, slug/hash | auth/입력/provider 오류 매핑 전 범위, timeout/retry, 제목 변경 cleanup 미검증 |
| `apps/web/app/kanban-board.test.ts` | drop 상태 규칙, publishing column collision 우선, transient 완료 표시 규칙 | React component interaction/render, fetch/polling, 오류 링크, 새로고침, keyboard 실제 동작 미검증 |

Playwright/E2E 파일과 script는 현재 없고 `docs/spec/gap-analysis.md`의 “OAuth/IndexedDB/publish 핵심 E2E”는
미완료다. 특히 테스트는 `getDeploymentStatus`의 fetch mock과 Astro 로컬 build까지는 통과하지만,
OAuth 로그인부터 실제 repository commit, GitHub Actions, Pages URL 응답까지 한 번에 증명하지 않는다.

### 이번 감사에서 실행한 검증

- Node 22.23.2와 pnpm 11.15.0으로 frozen-lockfile install 성공.
- publisher unit: 2 files, 13 tests 통과.
- publisher Astro integration: 1 file, 2 tests 통과.
- web의 publish/GitHub/Notion/kanban 관련 대상: 4 files, 37 tests 통과. 이 실행 전에
  `@notion-kanban-blog/publisher`를 build해야 했다.
- Node 22 Corepack 경로를 명시한 전체 `lint`, `typecheck`, `test`, `test:integration`, `build`
  통과. 전체 unit 결과 중 web은 13 files/105 tests, publisher는 2 files/13 tests가 통과했고,
  Astro integration 2 tests와 Next.js production build도 통과했다.
- clean checkout에서 문서 표준 명령 `mise exec -- corepack pnpm …`는 `which corepack`이 기존
  NVM Node 18 경로를 가리켜 Corepack이 즉시 실패했다. Node 22의 Corepack 경로를 명시해 설치와
  테스트를 수행했다. 또한 web test는 publisher의 ignored `dist`가 없으면 package entry를
  resolve하지 못한다. CI/개발 검증 순서에서 workspace dependency build를 보장하거나 test가
  source export를 resolve하도록 정리할 필요가 있다.

## 의사결정이 필요한 항목

아래 순서로 제품/기술 결정을 내리는 것이 합리적이다.

1. **repository 소유 모델:** 반드시 비어 있거나 app-managed인 `<login>.github.io`만 허용할지,
   기존 사이트에 overlay할지. 전자라면 marker와 사전 검증, 후자라면 diff/preview/backup 및
   충돌 정책이 필요하다.
2. **Pages bootstrap:** custom workflow 활성화를 앱이 자동화할지, repository 생성/Settings
   단계를 사용자에게 맡길지. 현재 OAuth scope 최소화 정책과 함께 결정해야 한다.
3. **branch 계약:** repository default branch를 workflow에 주입할지, `main`만 지원하고
   repository readiness에서 거절할지.
4. **문서 identity와 lifecycle:** URL을 title 기반으로 유지할지 page-ID 기반으로 안정화할지,
   제목 변경/삭제/unpublish 시 old artifact를 어떻게 찾고 제거할지.
5. **게시 전 확인:** 최소한 생성 파일/변경 경로와 rendered preview를 보여줄지, 첫 게시와 기존
   repository 변경에만 확인 단계를 둘지.
6. **운영 관측성:** Actions URL과 provider error를 즉시 노출하고 client-side resume token만
   둘지, 영구 이력/재시도가 필요해지는 시점에 DB 경계를 재검토할지.
7. **콘텐츠 정책:** 손실 가능한 block을 경고하며 게시할지, 지원하지 않으면 요청을 거절할지,
   image를 repository asset으로 복사할지.
8. **배포 순서:** 반복 게시를 모두 실행하되 concurrency로 최신 배포 순서를 보장할지, 이전 run을
   취소할지.

## 권장 다음 단계

P0로 default-branch workflow와 Pages readiness/bootstrap을 먼저 고치고 실제 신규 public
user-site 한 곳에 smoke 배포를 추가한다. 이어서 기존 repository 보호(marker + 변경 preview),
Actions/error 링크, 제목 변경 cleanup을 P1으로 처리한다. 마지막으로 Playwright에서 “로그인
fixture → Notion 문서 표시 → drop 게시 → polling 성공 → 완료 링크 → 새로고침”과 실패/재승인
경로를 검증하면, 현재 TODO의 P3 공백과 이 감사의 가장 큰 불확실성을 함께 줄일 수 있다.
