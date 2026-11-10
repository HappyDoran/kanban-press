---
title: 요구사항 대비 현재 상태와 백로그
kind: spec
last_verified: 2026-11-10
---

# 요구사항 대비 현재 상태와 백로그

요구사항 번호(R1~R7)와 계약 절(§)은 [제품 명세](PROJECT_SPEC.md)가 소유한다. 이 문서는 지금 어디까지 왔고 다음에 무엇을 하는지만 적는다. 항목을 끝내면 상태를 바꾸고, 확정된 결정은 [TECH_RULES.md](../../TECH_RULES.md)나 [아키텍처](../architecture/ARCHITECTURE.md)·[ADR](../adr/)로 옮긴 뒤 여기서 지운다. 상태는 실제 검증 결과와 일치해야 한다.

## 판정 요약 (2026-11-10)

- 완료: P0~P5의 38개 항목. 마지막 전체 검증 기록은 2026-08-26 lint, typecheck, unit 261개, integration 17개, production Chromium E2E 6개(desktop/320px), production build 통과다.
- 실제 provider: 2026-08-12 read-only smoke 통과(아래 P3 rollout 행). 이후 실제 provider 재확인은 하지 않았다.
- 2026-11-10 재검증: lint, typecheck, build, unit 261개, integration 17개, production Chromium E2E 6개 통과. 루트 script의 `corepack pnpm` 호출을 `pnpm`으로 바꿔 `mise exec -- pnpm` 실행을 복구했다.
- 루트 단일 사용자 Astro 프로토타입은 2026-11-10 사용자 결정으로 제거했다(재작성 Q0).
- 진행 중: 요구사항(R1~R7)과 기술 스택을 유지한 코드 재작성(아래 재작성 백로그).
- 자동 테스트 명령: [README.md](../../README.md) 검증 절 기준.

### 구현 현황

- Next.js web scaffold, provider 경계, stateless 암호화 쿠키 codec이 존재한다.
- GitHub 로그인 route와 `/api/me`가 구현됐으며 실제 사용에는 OAuth App 설정이 필요하다.
- Notion OAuth 연결·목록·해제 route가 구현됐으며 실제 사용에는 Public Connection
  설정이 필요하다.
- Notion workspace 목록과 접근 허용된 page tree 조회 UI가 구현됐다.
- 사용자별 IndexedDB repository, schema migration, 문서의 보관 중 추가가 구현됐다.
- 접근 가능한 drag-and-drop 칸반과 drop 기반 게시 시작 UI가 구현됐다.
- 기존 GitHub App installation 구현과 환경 변수는 제거됐다.
- GitHub OAuth는 `public_repo workflow`를 요청하며 `<login>.github.io`의 scope,
  소유권, 공개 여부와 push 권한을 확인한다.
- Notion page metadata는 자동으로 stored에 동기화되고 계층 목록의
  자동/표시/숨김/역할 override/구조 검사 캐시가 IndexedDB에 보존된다(schema version 10에서 도입, 현재 12).
- 칸반은 IndexedDB의 `보관 중`과 화면 메모리의 `게시 중`, `게시 완료`를 합성한다.
  v12 migration은 이전 영속 게시 상태와 commit/hash/URL 추적 필드를 제거한다.
- page를 펼칠 때만 Notion block outline을 조회하며 legacy toggle, child page,
  child database 계층을 탐색 UI에 보존한다.
- 결정적 Astro template manifest와 user/project base path 실제 build 검증이 구현됐다.
- 정규화된 Notion block의 안전한 Markdown artifact 변환 pipeline이 구현됐다.
- 글머리·번호 목록, 할 일, callout, table과 중첩 자식이 provider 독립 block으로
  보존되며 preview와 Astro 최종 HTML에서 같은 의미 구조와 반응형 표를 렌더링한다.
- Notion heading 1·2·3은 최종 글에서 `h2`·`h3`·`h4` 의미 구조를 유지하고, preview의
  dialog heading 구조와 독립된 시각 class를 사용한다. desktop과 320px 모두 세 단계가
  본문보다 크며 `heading 1 > heading 2 > heading 3` 순서를 유지한다.
- 최신 Notion 본문 조회와 요청 기반 게시·배포 상태 복구가 구현됐다.
- 기본 branch 기반 workflow, 관리 marker, Pages Actions 준비 상태, 기존 파일 보호,
  복구 UI와 Actions 로그 링크가 구현됐다.
- 예약 Notion 블로그 속성 정규화, `PublishDocument` v2 strict 모델과 공유
  `buildPublishDocument` 조립 경계가 구현됐다.
- Astro template v2 compatibility reader가 schema 없는 기존 v1 글을 `미분류`로
  정규화하고 strict v2 글과 함께 읽는다. Markdown writer는 v2 frontmatter를 출력하며
  기존 글 경로와 URL은 다시 게시할 때도 유지된다.
- 정적 블로그는 홈 최신 글 12개, 전체 글, category index/detail, breadcrumb·목차·분류·태그가
  있는 글 상세와 404를 생성한다. 공통 반응형 shell, 명시적인 focus, reduced-motion,
  user/project base path와 JavaScript 없는 탐색을 Astro fixture build로 검증한다.
- GitHub owner 기반 개인 브랜드, 홈·전체 글·주제·GitHub 탐색, 홈 글/주제 통계와
  반응형 article/목차 layout을 정적 Astro shell에 적용한다.
- `POST /api/publish/preview`는 현재 사용자 소유 Notion 원문을 다시 읽고 공유 문서 조립
  경계를 거쳐 URL 없는 image placeholder를 포함한 strict DTO만 반환한다. 보관 카드와
  판별 완료 문서 행의 dialog는 글/홈 보기, 3개 viewport, loading/error/retry를 제공하며
  닫기·새로고침 뒤 결과를 복구하거나 IndexedDB·게시 상태를 변경하지 않는다.
- 게시 image는 제한된 HTTPS downloader가 public IP에 고정해 받아 로컬 Astro asset으로
  commit한다. provider capability URL은 preview·Markdown·commit message에 남지 않으며
  MIME, byte, redirect, timeout, SSRF 제한을 contract test한다.
- mutable provider 통합 E2E는 preview 뒤 원문·Notion 권한·GitHub 권한 변경을 publish가
  다시 읽는지 검증하고, 최신 category/template v2/로컬 image artifact만 commit 경계로
  전달됨을 확인한다. 별도 read-only 실제 provider smoke는 release 전에 명시적으로 실행한다.
- mock rollout E2E와 전체 저장소 검증은 통과했다. 실제 provider smoke runner와
  gitignored credential 예시도 구현했다. 2026-08-11 로그인 browser session으로 실제
  GitHub identity/repository, Notion workspace·원문 읽기, 글 상세·홈·반응형 및 이미지
  placeholder preview를 read-only 확인했다. GitHub Pages 배포 소스를 GitHub Actions로
  변경한 뒤 앱의 repository readiness도 `ready`로 확인했다. 2026-08-12 테스트 credential을
  파일에 기록하지 않고 임시 shell 환경 변수로 주입해 실제 provider smoke를 통과했다.
  Notion page·전체 block·실제 이미지의 로컬 artifact 변환과 GitHub identity·repository·Pages
  readiness, credential/provider URL 비잔존을 확인했으며 commit, ref update, Pages mutation은
  발생하지 않았다. 실행 뒤 GitHub classic PAT와 Notion 테스트 integration을 삭제하고 임시
  Notion page를 휴지통으로 이동해 외부 release gate를 완료했다.

## 백로그 (우선순위 순)

표기: 상태는 `대기`, `진행 중`, `완료 (검증 근거)`, `외부 설정 필요`다.

| 단계 | 내용 | 요구사항 | 완료 조건 | 상태 |
|---|---|---|---|---|
| P0 기반과 보안 경계 | Node 22, pnpm workspace, Next.js web scaffold | R1~R7 기반 | 항목 완료(별도 수용 기준 없음) | 완료 |
| P0 기반과 보안 경계 | DB 없는 구조로 문서·package 경계·실행 구성을 전환 | §3, §6 | PostgreSQL, DB package, Worker, 서버 storage 의존성이 없다.<br>문서와 프로젝트 스킬이 쿠키 + IndexedDB + 직접 게시 흐름을 설명한다.<br>install, lint, typecheck, test, build가 통과한다. | 완료 |
| P0 기반과 보안 경계 | stateless cookie codec 구현 | §3 서버 쿠키 | AEAD seal/open, key version, expiry, tamper detection을 단위 테스트한다.<br>token과 평문 payload가 로그 또는 client bundle에 노출되지 않는다. | 완료 |
| P0 기반과 보안 경계 | GitHub OAuth App 생성 및 local callback 등록 | R1 | 항목 완료(별도 수용 기준 없음) | 완료 |
| P0 기반과 보안 경계 | GitHub 로그인 vertical slice | R1, §5 로그인 | start/callback/logout과 `/api/me`가 동작한다.<br>OAuth state 위조·만료·재사용과 잘못된 redirect를 거절한다.<br>GitHub numeric ID가 IndexedDB namespace로 전달된다. | 완료 |
| P1 Notion과 개인 칸반 | Notion Public Integration 생성 및 callback 등록 | R2 | 항목 완료(별도 수용 기준 없음) | 완료 |
| P1 Notion과 개인 칸반 | Notion OAuth 연결/해제 | R2, §5 Notion 연결과 탐색 | 연결 token은 암호화 HttpOnly 쿠키에만 존재한다.<br>연결 개수와 직렬화 크기 상한을 초과하면 안전하게 거절한다.<br>한 GitHub 사용자의 연결이 다른 사용자 namespace에 나타나지 않는다. | 완료 |
| P1 Notion과 개인 칸반 | Notion workspace와 page tree 조회 | R3 | integration에 공유된 root page와 하위 page만 표시한다.<br>pagination, rate limit, 권한 철회를 처리한다. | 완료 |
| P1 Notion과 개인 칸반 | IndexedDB repository와 migration 구현 | R4, §3 브라우저 IndexedDB | GitHub user ID별 board record가 격리된다.<br>token을 저장하지 않으며 schema validation을 통과한 값만 읽는다. | 완료 |
| P1 Notion과 개인 칸반 | 칸반 UI와 상태 전이 구현 | R4, §4 | 저장 당시 정의된 column 전이가 domain 규칙을 따른다.<br>keyboard 조작과 새로고침 복구가 가능하다. | 완료 |
| P1 Notion과 개인 칸반 | Notion 계층과 칸반 통합 | R3, R4 | 연결에서 발견한 page는 기존 상태를 보존하며 기본 column으로 자동 동기화한다.<br>하위 page는 기본 접힌 toggle로 표시한다.<br>사용자가 page별 칸반 표시 여부를 변경하고 새로고침 후 복구한다. | 완료 |
| P1 Notion과 개인 칸반 | data source 계층과 기본 칸반 노출 축소 | R3, R4 | data source 행 page를 database parent page 아래에 배치한다.<br>최상위 page를 펼칠 때만 block outline을 조회하고 Notion toggle 제목과 그 안의 child page 계층을 보존한다.<br>`block_id` 부모 page를 root로 승격하거나 기본 칸반에 표시하지 않는다.<br>최상위 page만 기본 표시하고 하위 page는 사용자가 선택해야 표시한다.<br>기존 자동 표시 record를 v5에서 재평가하되 명시적 숨김은 보존한다. | 완료 |
| P1 Notion과 개인 칸반 | page 문서/컨테이너 역할 설정 | R3, §3 브라우저 IndexedDB | 사용자가 `Legacy` 같은 page를 컨테이너로 지정하고 새로고침 후 복구한다.<br>컨테이너는 칸반과 게시 대상에서 제외되고 하위 outline toggle만 제공한다.<br>다시 문서로 전환하면 기존 column, position, 표시 선택을 복원한다.<br>v5 record는 v6에서 안전하게 `document` 역할로 migration된다.<br>자동 구조 검사 완료 전에는 컨테이너 선택을 노출하지 않고, 하위 outline이 있는 page에만 선택을 제공한다.<br>화면에 나타난 미확인 page를 동시 3개 이하로 자동 검사하고 수동 확인 버튼을 노출하지 않는다.<br>검사 결과는 Notion 수정 시각 기준으로 캐시하고 원문 변경 시 무효화한다.<br>v6 record는 v7에서 nullable 구조 검사 상태로 안전하게 migration된다. | 완료 |
| P1 Notion과 개인 칸반 | Notion 계층 블록 호환성 강화 | R3 | 설명용 toggle만 있는 page는 컨테이너 후보가 되지 않는다.<br>toggle heading과 제목 있는 자식 보유 block의 계층을 보존한다.<br>column/tab/synced block을 순회하고 순환 참조를 안전하게 중단한다.<br>`link_to_page`의 접근 가능한 page/database를 outline에 연결한다.<br>v7의 이전 판정 캐시를 v8에서 무효화하되 사용자 역할과 칸반은 보존한다.<br>대표 fixture와 malformed provider 응답을 테스트한다. | 완료 |
| P1 Notion과 개인 칸반 | page 판별 중 액션 UI 단일화 | R3 | 판별 전에는 page 역할·칸반 액션 대신 단일 로딩 상태만 표시한다.<br>판별 완료 후에만 문서 또는 컨테이너에 맞는 액션을 표시한다.<br>판별 실패도 중복 버튼 없이 단일 상태로 표시한다. | 완료 |
| P1 Notion과 개인 칸반 | page 역할 자동 적용과 예외 데이터 호환 | R3, §3 브라우저 IndexedDB | 탐색 가능한 하위 구조가 있으면 컨테이너, 없으면 문서로 자동 적용한다.<br>일반 화면에서 `컨테이너로 사용`·`문서로 사용` 버튼을 제거한다.<br>판별 실패에는 `구조 다시 확인` 하나만 제공한다.<br>v8의 컨테이너 역할은 수동 override로 보존하고 기본 문서는 자동 역할로 전환한다. | 완료 |
| P1 Notion과 개인 칸반 | 수동 page 역할 UI 제거 | R3 | page 행에 더보기 또는 문서/컨테이너 역할 설정을 노출하지 않는다.<br>문서는 `표시하기/숨기기`, 컨테이너는 펼치기/접기만 제공한다.<br>판별 실패의 `구조 다시 확인`은 유지한다. | 완료 |
| P1 Notion과 개인 칸반 | 게시 칸반 3단계 단순화 | R4, §4 | UI는 `보관 중`, `게시 중`, `게시 완료`로 표시한다.<br>v9의 draft/review/ready/failed는 stored, publishing과 published는 같은 의미의 column으로 v10에서 migration된다. | 완료 |
| P1 Notion과 개인 칸반 | 영속 게시 상태 제거와 반복 게시 허용 | R4, R6, §4 | IndexedDB에는 `stored`만 저장하고 게시 SHA/hash/URL을 저장하지 않는다.<br>게시 중·완료 상태와 완료 링크는 React 메모리에만 존재해 새로고침 시 사라진다.<br>v11 record는 v12에서 게시 상태와 추적 필드를 안전하게 제거한다.<br>동일 콘텐츠를 다시 게시해도 새 commit과 Actions 실행을 만든다.<br>보관 카드를 게시 중 column에 drop하면 게시하고 별도 게시 버튼이나 상태 선택기를 노출하지 않는다.<br>완료 카드는 게시 중으로 drop해 다시 게시하거나 보관 중으로 drop해 완료 표시를 닫을 수 있다.<br>카드의 `×`는 원문을 삭제하지 않고 칸반 표시만 해제한다.<br>포인터가 게시 중 column 안에 있으면 인접 카드보다 해당 column을 drop 대상으로 우선해 빈 column에도 안정적으로 게시할 수 있다.<br>게시 성공 카드는 현재 화면에서 완료 상태로 유지하되 IndexedDB에서는 숨김 처리해 새로고침 후 칸반에 다시 나타나지 않는다.<br>완료 카드를 보관 중으로 되돌리면 표시 상태도 복구한다. | 완료 |
| P2 GitHub Pages 게시 | OAuth 기반 `<login>.github.io` 직접 게시 경계 | R5, §5 GitHub Pages repository | OAuth에서 `public_repo workflow`를 요청하고 기존 사용자의 재동의를 안내한다.<br>현재 사용자 소유의 public `<login>.github.io`와 push 권한만 허용한다.<br>GitHub App 환경 변수, route, installation 저장 데이터가 없다. | 완료 |
| P2 GitHub Pages 게시 | Astro 게시 manifest와 template 완성 | R6 | project site와 user site의 base path를 모두 build test한다.<br>lockfile 없는 생성 repository의 workflow가 pnpm과 무캐시 설치를 명시하고 Pages artifact를 업로드한다.<br>pnpm dependency build script는 `pnpm-workspace.yaml`의 `allowBuilds`에서 Astro에 필요한 `esbuild`만 허용한다. | 완료 |
| P2 GitHub Pages 게시 | Notion block 변환 pipeline | R6, §5 게시 | 제목, 본문, 코드, 이미지, toggle, link의 fixture test가 있다.<br>위험한 HTML과 경로 이탈을 차단한다. | 완료 |
| P2 GitHub Pages 게시 | 요청 기반 게시 orchestration | R6, R7 | 최신 Notion 권한과 GitHub 권한을 매 요청 재검증한다.<br>동일 콘텐츠의 반복 게시와 중복 commit을 허용한다.<br>commit SHA를 반환하고 UI가 Actions/Pages 상태를 복구한다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | Pages 내보내기 readiness와 repository 보호 | R5, R7, §5 GitHub Pages repository | workflow branch가 실제 default branch와 일치한다.<br>Pages custom workflow 준비 상태와 기존 파일 변경 범위를 게시 전에 확인한다.<br>Actions URL과 provider별 복구 행동을 UI에서 제공한다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | Notion 블로그 metadata와 공유 문서 조립 계약 | R6, §5 게시 | 예약 속성은 서버가 최신 Notion 원문에서만 읽고 strict validation한다.<br>preview와 publish가 동일한 `PublishDocument` 조립 경계를 사용한다.<br>브라우저가 title, category, tag, Markdown, slug를 대신 전달하지 않는다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | Astro template v2와 v1 게시물 호환 | R6, §5 게시 | v1/v2 mixed collection이 user/project base path에서 build된다.<br>기존 글 URL을 유지하고 v1 metadata 누락은 `미분류`로 처리한다.<br>compatibility reader를 v2 Markdown writer보다 먼저 배포한다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | 카테고리 기반 홈·전체 글·상세 블로그 UI | R6, §5 게시 | 홈, `/posts/`, category index/detail, post, 404가 정적으로 생성된다.<br>320px부터 반응형이며 JavaScript 없이 핵심 탐색이 동작한다.<br>WCAG 2.2 AA와 user/project base path 회귀 검증을 통과한다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | 안전한 게시 전 preview API와 UI | §5 게시 | preview는 현재 사용자 소유 Notion 원문을 매 요청 다시 읽고 GitHub mutation을 하지 않는다.<br>typed DTO만 반환하며 raw HTML, Markdown, provider property, credential을 노출하지 않는다.<br>결과는 React memory에만 존재하고 IndexedDB v12와 게시 상태를 바꾸지 않는다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | provider image local asset 변환과 capability URL 차단 | R6, §5 게시 | signed provider URL이 preview, Markdown, 로그, commit message에 남지 않는다.<br>MIME, byte, redirect, timeout, SSRF 제한을 contract test한다. | 완료 |
| P3 GitHub Pages 블로그 경험 확장 | preview/category/template v2 통합 E2E와 rollout | §5 게시 | preview 이후 원문·권한 변경 시 publish가 최신 상태를 재검증한다.<br>실제 provider smoke와 전체 repository 검증이 통과한다.<br>세부 문서와 실제 구현 상태가 일치한다. | 완료 (외부 확인: mock provider 통합 E2E와 전체 repository 검증을 통과했다. 2026-08-11 로그인 browser session으로 실제 GitHub identity/repository와 Notion workspace·원문, 다수 이미지 placeholder가 있는 preview를 read-only 확인했다. GitHub Pages 배포 소스를 GitHub Actions로 변경하고 앱의 `게시 준비 완료` 판정도 확인했다. 2026-08-12 별도 테스트 credential을 파일에 기록하지 않고 임시 shell 환경 변수로 주입해 read-only `mise exec -- corepack pnpm --filter @notion-kanban-blog/web test:smoke`를 통과했다. 실제 Notion page·전체 block·이미지 다운로드와 로컬 artifact 변환, GitHub identity·repository· Pages readiness 및 credential/provider URL 비잔존 검증이 성공했다. 실행 뒤 GitHub classic PAT와 Notion 테스트 integration을 삭제하고 임시 Notion page를 휴지통으로 이동했다.) |
| P4 신뢰성과 운영 | provider rate limit, timeout, 사용자 재시도 UX | §6.1 | Notion/GitHub OAuth·REST 요청을 10초 안에 중단하고 provider별 504 code로 반환한다.<br>429의 bounded Retry-After를 UI가 표시하고 대기 중 재시도를 막는다.<br>서버 자동 재시도 없이 사용자가 읽기·preview·publish를 명시적으로 재시도한다. | 완료 |
| P4 신뢰성과 운영 | secret redaction을 포함한 구조화 로그 | §6.1 | allowlist JSON event만 기록하고 token, cookie, URL, 식별자와 임의 오류 문자열을 거절한다.<br>timeout, network, HTTP 실패의 provider·operation·code·bounded timing만 기록한다. | 완료 |
| P4 신뢰성과 운영 | OAuth/IndexedDB/publish 핵심 E2E | R1, R4, R6 | signed-out OAuth 진입과 signed-in session UI를 production browser에서 검증한다.<br>GitHub user ID별 IndexedDB 격리와 preview→drag publish→게시 후 숨김을 검증한다. | 완료 |
| P4 신뢰성과 운영 | 접근성, 성능, 모바일 칸반 검증 | R4 | desktop과 320px Chromium에서 Axe serious/critical 위반과 가로 overflow가 없다.<br>keyboard drag 활성화, DCL 3초, 전송량 3MB 예산을 자동 검증한다. | 완료 |
| P4 신뢰성과 운영 | 쿠키 예산 또는 다기기 동기화 요구가 발생하면 DB 도입 ADR 작성 | §6, ADR 0001 | 항목 완료(별도 수용 기준 없음) | 완료 (평가: 현재 trigger 요구 없음. ADR 0001에서 DB-free 유지와 재평가 gate를 확정한다.<br>검증: 2026-08-22 전체 lint, typecheck, unit 257개, integration 16개, production Chromium E2E 6개(desktop/320px), production build를 통과했다.) |
| P5 Notion 게시 충실도 | Notion 의미 구조와 최종 HTML 충실도 강화 | R6, §5 게시 | 글머리·번호 목록, 할 일, callout, table, 수식, 링크·미디어 카드와 중첩 자식을 일반 문단으로 평탄화하지 않고 provider 독립 block union에 보존한다.<br>게시 전 프리뷰와 Markdown/Astro 최종 HTML이 같은 의미 구조를 렌더링한다.<br>사용자 text·link·table cell의 HTML 주입을 차단하고 기존 이미지·깊이·크기 제한을 중첩 block에도 동일하게 적용한다.<br>대표 Notion fixture, 결정적 Markdown, Astro semantic HTML build를 검증한다. | 완료 (검증: 2026-08-22 lint, typecheck, unit 261개, integration 17개, production Chromium E2E 6개와 production build를 통과했다.) |
| P5 Notion 게시 충실도 | Notion 제목 시각 계층 일치 | R6, §5 게시 | 글 `h1`과 Notion heading의 의미 레벨을 유지하면서 프리뷰와 최종 HTML의 Notion heading 1·2·3에 동일한 시각 계층을 적용한다.<br>세 heading 단계가 모두 본문보다 크고 단계별 크기가 역전되지 않는다.<br>desktop과 320px에서 계산된 font-size와 기존 접근성·overflow 회귀를 검증한다. | 완료 (검증: 2026-08-26 lint, typecheck, unit 261개, integration 17개, production Chromium E2E 6개(desktop/320px)와 production build를 통과했다.) |
| P5 Notion 게시 충실도 | GitHub owner 기반 개인 블로그 UI 개편 | R6, §5 게시 | 홈·전체 글·주제·GitHub 메뉴와 owner 기반 브랜드를 모든 route에서 제공한다.<br>홈은 소개, 글·주제 수, 최신 글을 명확한 우선순위로 보여준다.<br>상세 글 목차는 mobile에서 본문 앞, desktop에서 sticky 보조 탐색으로 동작한다.<br>빈 블로그와 실제 글 fixture 모두 320px, keyboard, 접근성, base path build를 통과한다. | 완료 (검증: 2026-08-26 빈 `HappyDoran.github.io` production build와 user/project fixture, lint, typecheck, unit 261개, integration 17개, production Chromium E2E 6개 및 전체 build를 통과했다.) |
| 정리 | 루트 단일 사용자 Astro 프로토타입(`src/`, `scripts/`, `astro.config.mjs`) 제거 | 구현 현황 마지막 항목 | 신규 앱과 package가 프로토타입을 import하지 않음을 확인한 뒤 제거하고 lint·typecheck·test·build가 통과한다. | 완료 (재작성 Q0에서 처리) |

## 재작성 백로그 (2026-11-10 착수)

요구사항(R1~R7)·계약(§3~§6)·기술 스택(Next.js `apps/web` 단일 서버, 별도 backend 없음)은 바꾸지 않고 코드를 다시 쓴다. 목적은 칸반 앱과 게시 블로그의 UI·UX 개편, 코드 단순화·축소, 사용자가 단계마다 읽고 이해할 수 있는 크기의 교체다. 2026-11-10 사용자 결정:

- 방식: `apps/web`과 `packages/*` 자리에서 단계별로 교체한다. 단계가 끝날 때마다 dev에서 전체 검증이 통과해야 하며 이전 구현은 같은 단계에서 지운다.
- 판정 기준: `apps/web/e2e/`와 `test:integration`은 동작 판정 기준으로 유지한다. UI 개편으로 selector·문구만 바꿀 때는 검증하는 동작을 줄이지 않고, 바꾼 이유를 커밋 본문에 적는다. unit 테스트는 새 코드 구조에 맞춰 다시 쓴다.
- 게시 결과물: 생성 블로그는 `HappyDoran.github.io` repository다(2026-11-10 원격 기준 초기 commit만 있고 게시 글 0개). template은 `packages/publisher`가 생성하며 블로그 repository를 직접 고치지 않는다.
- 학습 단위: 한 단계는 사용자가 한 번에 검토할 수 있는 크기로 나누고, 사용자 검토 뒤 다음 단계로 넘어간다.

모든 Q 단계의 공통 완료 조건: README.md 전체 검증 통과, 교체 범위의 이전 코드 제거, 교체 전후 소스 줄 수 보고, IndexedDB v12 기존 데이터 읽기 유지, AGENTS.md 안전 조건 유지.

| 단계 | 내용 | 교체 범위 | 역할 | 완료 조건 | 상태 |
|---|---|---|---|---|---|
| Q0 준비 | 실행 환경 복구와 루트 프로토타입 제거 | 루트 script, `src/`, `scripts/`, `astro.config.mjs` | 병합 담당 | `mise exec -- pnpm` 검증이 동작한다.<br>프로토타입과 관련 규칙 문구가 없다. | 완료 (2026-11-10 lint, typecheck, build, unit 261개, integration 17개, E2E 6개 통과) |
| Q1 UI·UX 방향 | 칸반 앱과 게시 블로그의 새 화면 기준 | docs/planning/BLOG_EXPERIENCE_DESIGN.md, 앱 화면 기준 | designer, planner | 화면별 정보 계층·상태(loading/empty/error)·320px·접근성 기준이 문서에 있다.<br>사용자가 방향을 승인한다. || 완료 (2026-11-10 시안 3안 비교 후 사용자가 A 작업대형 승인. 기준: [디자인 기획](../planning/BLOG_EXPERIENCE_DESIGN.md) 2.3·6.4·10절) |
| Q2 인증 기반 | 쿠키 codec, GitHub OAuth, 세션 | `packages/auth`, `apps/web/app/auth/github`, `apps/web/lib/auth/github.ts`·`session.ts`, `/api/me`, `/auth/logout` | backend | OAuth state 위조·만료·재사용과 잘못된 redirect 거절, AEAD tamper 거절을 unit으로 증명한다.<br>재작성 전 codec이 발급한 쿠키를 그대로 연다. | 완료 (2026-11-10 lint, typecheck, build, unit 264개, integration 17개, E2E 6개 통과. 쓰이지 않던 `packages/validation` 제거, 세션 읽기 중복 4곳을 `lib/auth/session.ts`로 통합. 교체 범위 소스(테스트 제외) +511/−792줄. `packages/domain`의 칸반 전이 규칙은 사용처인 Q4에서 다룬다) |
| Q3a Notion 연결 | Notion OAuth 연결·목록·해제와 연결 쿠키 | `apps/web/lib/auth/notion.ts`, `apps/web/app/auth/notion`, `apps/web/app/api/notion/connections` | backend | 연결 개수·쿠키 크기 상한 거절과 거절된 token revoke, 다른 사용자 state·연결 격리, 재연결 시 이전 token revoke를 테스트한다. | 완료 (2026-11-10 lint, typecheck, build, unit 266개, integration 17개, E2E 6개 통과. OAuth redirect·callback 오류 응답을 `session.ts`로 통합. 교체 범위 소스(테스트 제외) +281/−369줄) |
| Q3b Notion 본문 조회 | workspace page tree, block outline, 게시용 본문 조회 adapter | `packages/notion`, `apps/web/lib/notion`, `apps/web/app/api/notion/connections/[connectionId]` | backend | pagination·rate limit·권한 철회 처리와 malformed provider 응답을 테스트한다.<br>preview·publish integration이 통과한다. | 대기 |
| Q4 칸반 화면 | IndexedDB repository와 칸반·Notion 탐색 UI | `apps/web/lib/board`, `kanban-board`, `notion-browser`, `board-drop`, `page.tsx`, `globals.css` | frontend, designer | Q1 기준을 충족한다.<br>v12 기존 record를 그대로 읽고 GitHub user ID 격리를 유지한다.<br>keyboard drag와 320px E2E가 통과한다. | 대기 |
| Q5 게시 서버 경로 | GitHub repository 검증, 문서 조립, Markdown·image artifact, commit | `packages/github`·`publisher`(template 제외), `apps/web/lib/github`·`publish`, `apps/web/app/api/publish` | backend | 요청마다 Notion·GitHub 권한을 재검증한다.<br>provider URL·token이 artifact·로그에 남지 않는다.<br>publisher integration이 통과한다. | 대기 |
| Q6 블로그 template·preview | 생성 Astro template와 게시 전 preview UI | `packages/publisher` template, `publish-preview`, `github-pages-target` | designer, frontend | Q1 기준을 충족한다.<br>user/project base path build와 v1·v2 글 호환이 유지된다.<br>preview와 최종 HTML의 의미 구조가 같다. | 대기 |
| Q7 신뢰성·마감 | timeout·재시도 UX, 구조화 로그, 문서 동기화 | `apps/web/lib/operations`, `retry-action`, 아키텍처·하네스 문서 | backend, frontend | §6.1 계약 테스트가 통과한다.<br>문서의 경로·역할 표가 새 구조와 맞다.<br>실제 provider smoke는 사용자가 실행한다. | 대기 |

## 미결 결정

없음.
