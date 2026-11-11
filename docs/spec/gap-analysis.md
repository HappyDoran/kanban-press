---
title: 요구사항 대비 현재 상태와 백로그
kind: spec
last_verified: 2026-11-11
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
- 접근 가능한 drag-and-drop 칸반과 drop 기반 게시 시작 UI가 구현됐다.
- 기존 GitHub App installation 구현과 환경 변수는 제거됐다.
- GitHub OAuth는 `public_repo workflow`를 요청하며 `<login>.github.io`의 scope,
  소유권, 공개 여부와 push 권한을 확인한다.
- 칸반의 보관 중은 문서 목록에서 직접 고른 page로, 블로그 저장소의 `kanban-press-board` branch에 page ID로 저장한다
  (2026-11-11 K3, ADR 0003). 게시 중은 화면 메모리, 게시 완료는 블로그 글 파일이다. IndexedDB 칸반 저장소는 제거됐다.
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
| P3 GitHub Pages 블로그 경험 확장 | preview/category/template v2 통합 E2E와 rollout | §5 게시 | preview 이후 원문·권한 변경 시 publish가 최신 상태를 재검증한다.<br>실제 provider smoke와 전체 repository 검증이 통과한다.<br>세부 문서와 실제 구현 상태가 일치한다. | 완료 (외부 확인: mock provider 통합 E2E와 전체 repository 검증을 통과했다. 2026-08-11 로그인 browser session으로 실제 GitHub identity/repository와 Notion workspace·원문, 다수 이미지 placeholder가 있는 preview를 read-only 확인했다. GitHub Pages 배포 소스를 GitHub Actions로 변경하고 앱의 `게시 준비 완료` 판정도 확인했다. 2026-08-12 별도 테스트 credential을 파일에 기록하지 않고 임시 shell 환경 변수로 주입해 read-only `mise exec -- corepack pnpm --filter @kanban-press/web test:smoke`를 통과했다. 실제 Notion page·전체 block·이미지 다운로드와 로컬 artifact 변환, GitHub identity·repository· Pages readiness 및 credential/provider URL 비잔존 검증이 성공했다. 실행 뒤 GitHub classic PAT와 Notion 테스트 integration을 삭제하고 임시 Notion page를 휴지통으로 이동했다.) |
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
| Q3b Notion 본문 조회 | workspace page tree, block outline, 게시용 본문 조회 adapter | `packages/notion`, `apps/web/lib/notion`, `apps/web/app/api/notion/connections/[connectionId]` | backend | pagination·rate limit·권한 철회 처리와 malformed provider 응답을 테스트한다.<br>preview·publish integration이 통과한다. | 완료 (2026-11-10 lint, typecheck, build, unit 266개, integration 17개, E2E 6개 통과. `content.ts`를 요청(`provider.ts`)·변환(`convert.ts`)·adapter(`content.ts`)로 나누고 중복된 pagination·블록 순회·rich text 변환을 하나로 합쳤다. 기존 adapter 테스트를 수정 없이 판정 기준으로 사용. 교체 범위 소스(테스트 제외) +844/−1225줄, 1,347→966줄) |
| Q4a 칸반 저장소 | IndexedDB repository와 domain 정리 | `apps/web/lib/board/repository.ts`, `packages/domain` | frontend | v12 기존 record를 그대로 읽고 v11 이하 DB는 비운다.<br>GitHub user ID 격리, strict schema purge, 표시 선택·구조 판별 캐시 규칙을 테스트한다. | 완료 (2026-11-10 lint, typecheck, build, unit 251개, integration 17개, E2E 6개 통과. 사용자 결정으로 v1~v11 migration 제거, 앱이 쓰지 않던 `addDraft`·`listByColumn`·`remove`·`setPageRole`과 domain 칸반 전이 규칙 제거. migration·전이 테스트가 빠져 unit 수가 줄었다. 교체 범위 소스(테스트 제외) +194/−988줄) |
| Q4b 클라이언트 로직 분리 | `NotionBrowser`의 세션·연결·page tree·칸반·게시 상태를 hook으로 분리 | `apps/web/app/notion-browser.tsx`, `kanban-board.tsx`, `board-drop.ts`, `apps/web/lib/board/page-role.ts`·`task-limiter.ts`, `apps/web/lib/notion/outline.ts` | frontend | 화면 변화 없이 E2E가 통과한다.<br>분리한 상태 로직에 unit 테스트가 있다. | 완료 (2026-11-10 lint, typecheck, build, unit 261개, integration 17개, E2E 6개 통과. `notion-browser.tsx`를 조립 컴포넌트, `use-workspace`·`use-board` hook, `notion-tree.tsx`, `lib/client/api.ts`(응답 zod 검증)·`publish.ts`(게시·배포 확인 흐름)로 나눴다. GET 링크라 405를 받던 로그아웃을 POST로 고쳤다) |
| Q4c A안 화면 적용 | 상단 바·문서 사이드바·칸반 레이아웃과 A 토큰 | `apps/web/app/page.tsx`·`layout.tsx`·`globals.css`와 화면 컴포넌트 | designer, frontend | [디자인 기획](../planning/BLOG_EXPERIENCE_DESIGN.md) 6.4·10절을 충족한다.<br>keyboard drag와 320px E2E가 통과한다. | 완료 (2026-11-10 lint, typecheck, build, unit 261개, integration 17개, E2E 6개(desktop·320px, Axe 포함) 통과. 상단 바 게시 대상 상태, 문서 사이드바(행당 상태 하나, 트리 미리보기 제거), 칸반 h1·열 h2, 600–899px 문서 목록 접기, A 토큰 CSS로 교체하고 serif 글꼴을 뺐다. 프리뷰 CSS는 토큰 이름만 바꾸고 Q6에서 다룬다) |
| Q5 게시 서버 경로 | GitHub repository 검증, 문서 조립, Markdown·image artifact, commit | `packages/github`·`publisher`(template 제외), `apps/web/lib/github`·`publish`, `apps/web/app/api/publish` | backend | 요청마다 Notion·GitHub 권한을 재검증한다.<br>provider URL·token이 artifact·로그에 남지 않는다.<br>publisher integration이 통과한다. | 완료 (2026-11-10 lint, typecheck, build, unit 262개, integration 17개(publisher 14·web 3), E2E 6개 통과. GitHub client의 요청·응답 검증을 세 helper로 합치고, 게시·프리뷰 route의 origin·세션·본문·연결 소유권 검증과 오류 응답을 `authorizePageRequest`·`pageErrorResponse`로 합쳤다. IP 대역 검사를 `node:net` `BlockList`로, 블록 타입 중복을 `PublishBlockWith<Image>`로 줄였다. 기존 단위·통합 테스트를 수정 없이 판정 기준으로 사용. 교체 범위 소스(테스트 제외) +520/−1288줄) |
| Q6 블로그 template·preview | 생성 Astro template와 게시 전 preview UI | `packages/publisher` template, `publish-preview`, `github-pages-target` | designer, frontend | Q1 기준을 충족한다.<br>user/project base path build와 v1·v2 글 호환이 유지된다.<br>preview와 최종 HTML의 의미 구조가 같다. | 완료 (2026-11-10 lint, typecheck, build, unit 262개, integration 17개(publisher 14·web 3), E2E 6개 통과. 블로그 CSS를 `BLOG_CSS` 하나로 모아 template과 프리뷰가 함께 쓰고, A 토큰·system 글꼴·mono 메타·목차 왼쪽 고정으로 바꿨다. 프리뷰는 블로그와 같은 class와 h1(글 제목)·h2–h4(본문) 구조로 그리고, 앱 CSS의 프리뷰 전용 본문 스타일을 지웠다. user/project base path·v1/v2 호환은 template integration으로 확인. 샘플 블로그 desktop·320px와 프리뷰 desktop·320px·390 프레임을 스크린샷으로 확인) |
| Q7 신뢰성·마감 | timeout·재시도 UX, 구조화 로그, 문서 동기화 | `apps/web/lib/operations`, `retry-action`, 아키텍처·하네스 문서 | backend, frontend | §6.1 계약 테스트가 통과한다.<br>문서의 경로·역할 표가 새 구조와 맞다.<br>실제 provider smoke는 사용자가 실행한다. | 완료 (2026-11-10 lint, typecheck, build, unit 262개, integration 17개, E2E 6개 통과. `providerRequest`의 timeout 경쟁·실패 로그를 단순화하고 Notion의 `Retry-After` 해석을 공통 `parseRetryAfter`로 합쳤다. 다시 시도 버튼에 보조 버튼 스타일을 입혔다. 아키텍처 문서에 `apps/web` 층별 코드 위치를, 하네스 역할 표에 `lib/client`·`lib/board`·`blog-css.ts` 소유를 반영했다. §6.1 계약 테스트는 수정 없이 통과. 미실행: `test:smoke`(사용자 실행 대상)) |

## 블로그 기능 확장 백로그 (2026-11-10 기획)

요구와 계약은 [제품 명세 §5.1](PROJECT_SPEC.md#51-블로그-기능-확장-계약-r8r11)이 소유한다. 앞 단계부터 진행하며, 각 단계는 사용자 검토 후 커밋한다.

| 단계 | 내용 | 요구사항 | 역할 | 완료 조건 | 상태 |
|---|---|---|---|---|---|
| B1 글 관리 | 옛 글 정리(결함), 블로그에서 내리기, 게시 완료 열 복원 | R8 | backend, frontend | §5.1 R8 완료 조건을 integration·E2E로 증명한다.<br>삭제 commit은 page ID 접미사 파일만 바꾼다. | 완료 (2026-11-10 lint, typecheck, build, unit 274개, integration 17개, E2E 6개 통과. GitHub client가 삭제(null sha tree 항목)와 글 관련 파일 목록(`contentPaths`)을 지원하고, `blog-files.ts`가 page ID 접미사로 한 글의 파일을 찾는다. 게시는 옛 파일을 지우고 옛 주소 안내 page를 남기며, `/api/publish/unpublish`·`/api/publish/posts`를 추가했다. 칸반은 게시 후 카드를 숨기지 않고 게시 완료 열을 저장소 기준으로 그린다(E2E 기대값을 새 §4 계약에 맞춰 바꾸고 복원·내리기 흐름을 추가). `HappyDoran.github.io` 임시 복사본 시뮬레이션으로 제목 변경 재게시(옛 파일 rename + 안내 page)·내리기·중복 내리기(commit 없음)와 JavaScript 없는 옛 주소 이동을 확인. 미검증: 실제 GitHub 저장소 대상 실행) |
| B2 탐색·노출 | 태그·보관함 route, RSS·sitemap·Open Graph | R9 | designer, backend | §5.1 R9 완료 조건을 template integration으로 증명한다. | 완료 (2026-11-10 lint, typecheck, build, unit 274개, integration 19개(template 16·web 3), E2E 6개 통과. template에 `/tags/`·`/tags/<slug>/`·`/archive/`·`rss.xml`·`sitemap.xml`, Open Graph meta, 카드·글 상세 태그 링크, footer 링크를 추가했다. 태그 slug는 카테고리와 같은 규칙(영문 부분 + hash)이며 대소문자만 다른 태그는 하나로 모은다. user/project base path 통합 테스트로 새 주소·base path·XML escape를 확인하고, 샘플 블로그 빌드 결과를 `xmllint`로 XML 문법 검사, 화면을 desktop·320px로 확인했다) |
| B3 순서·묶음 | `Blog Pinned`·`Blog Series`·`Blog Order` 속성과 홈·시리즈 화면 | R10 | backend, designer | §5.1 R10 완료 조건을 unit·template integration으로 증명한다.<br>프리뷰가 같은 값을 보여준다. | 완료 (2026-11-10 lint, typecheck, build, unit 283개, integration 20개(template 17·web 3), E2E 6개 통과. Notion `checkbox`·`number` 속성 정규화, 문서 조립·Markdown frontmatter(값이 있을 때만)·content schema(기존 글 기본값), 홈 고정 글, `/series/`·`/series/<slug>/`, 글 상세 시리즈 목록과 시리즈 순서 이전·다음, sitemap·footer, 프리뷰 DTO·화면을 추가했다. 속성이 없는 v1·v2 글은 그대로 build된다) |
| B4 주소·사이트 설정 | `Blog Slug` 속성, 사이트 설정 파일 | R11 | backend, frontend | §5.1 R11 완료 조건과 아래 결정 D3·D4가 반영된다. | 완료 (2026-11-10 lint, typecheck, build, unit 299개, integration 21개(template 18·web 3), E2E 8개 통과. `Blog Slug` 속성과 검증, GitHub 파일 읽기(`readFile`), `/api/blog/settings` 읽기·저장(설정 파일 하나만 commit), 앱 상단 바의 블로그 설정 dialog, template의 설정 파일 읽기(이름·소개·프로필 링크·RSS, 잘못된 항목은 기본값)를 추가했다. 설정 dialog E2E(desktop·320px, Axe)와 template 통합 테스트로 확인. 프리뷰는 설정 파일 대신 기본 사이트 이름을 쓴다) |
| B5 실환경 확인 | 실제 GitHub·Notion으로 게시·설정·제목 변경 재게시·내리기 | R8~R11 | 병합 담당 | 로컬 앱에서 사용자가 로그인해 실제 `HappyDoran.github.io`에 실행하고 commit·Actions·공개 블로그를 확인한다. | 완료 (2026-11-10 첫 게시 `60dae0f`, 설정 저장 `ebce86c`·`7d4e6b1`, 제목 변경 재게시 `4b03c2d`(글 파일 rename + 옛 주소 안내 page, JavaScript 없이 이동 확인), 내리기 `b104e3a`(두 주소 404). Actions 모두 성공, 실제 RSS `xmllint` 통과. 이 과정에서 고친 것: Notion 429 뒤 줄 선 구조 확인을 대기 시각까지 멈춤(`TaskLimiter.pauseUntil`), GitHub 텍스트 artifact를 tree에 inline하고 바이너리 blob을 하나씩 올림(첫 게시가 동시 blob 9개 timeout으로 실패), 사이트 주소 호스트 소문자. 미실행: `test:smoke`(`.env.smoke.local` 없음)) |
| U1 칸반 앱 UI 정리 | 사이드바 말줄임·너비 조절·따로 스크롤, 트리 아이콘 정리, 열·카드 가로 넘침, 로고 | 디자인 기획 6.4 | designer, frontend | 긴 제목·이름이 1440·1024·768·320px에서 가로 넘침을 만들지 않는다.<br>경계선이 끌기·키보드로 동작하고 너비를 기억한다. | 완료 (2026-11-10 lint, typecheck, build, unit 301개, integration 21개, E2E 9개(새 사이드바 너비 테스트) 통과. 긴 제목 mock으로 네 폭을 찍어 찾은 문제: 사이드바 4~6줄 줄바꿈, `+ ▾`·`· ▤` 겹친 기호와 `폴더` 중복 문구, `칸반`/`추가` 상태 구분 약함, 1024·768px에서 긴 워크스페이스 이름 때문에 게시 완료 열과 카드가 화면 밖으로 넘침, 모든 완료 카드의 큰 `블로그에서 내리기` 버튼, Notion 로고를 닮은 `N` 로고, 768px 상단 바 두 줄. 모두 고치고 네 폭에서 가로 넘침 없음을 확인) |
| U2 칸반 앱 UI 후속 | 제목 검색, 좁은 화면 카드 게시 버튼, 앱 이름 변경, 로그인 전 화면 | 디자인 기획 6.4, 명세 §4 | designer, frontend | 검색·좁은 화면 게시를 E2E로 증명한다.<br>네 폭에서 가로 넘침이 없다. | 완료 (2026-11-10 lint, typecheck, build, unit 303개, integration 21개, E2E 11개(새 검색·좁은 화면 게시 테스트) 통과. 사이드바 제목 검색(평평한 결과·status 문구·Escape), 600px 미만 카드 `게시`·`다시 게시` 버튼(명세 §4 예외 추가), 화면 이름 `Kanban Press`, 주 버튼 강조색, 앱 전체 한글 단어 단위 줄바꿈(320px에서 `Notion에/서` 끊김 수정)) |
| R0 프로젝트 이름 변경 | `notion-kanban-blog` → `kanban-press`(저장소·폴더·패키지 `@kanban-press/*`·skill/agent `kp-*`·쿠키·DB·블로그 저장소 폴더) | 명세 §3 | 병합 담당 | 이름 변경 전 쿠키·칸반 DB·블로그 저장소가 그대로 동작한다(호환 테스트). | 완료 (2026-11-10 lint, typecheck, build, unit 309개, integration 22개(template 19·web 3), E2E 11개 통과. 옛 AAD·옛 쿠키 이름 읽기와 로그아웃 시 옛 쿠키 삭제, 옛 칸반 DB를 새 DB로 옮기기, 옛 관리 표식 인정·게시 때 삭제, 옛 사이트 설정 읽기·저장 때 이동을 테스트로 증명. GitHub 저장소 이름과 로컬 폴더 이동은 커밋 후 실행) |
| U3 정체성: 칸반 앱 | 교정쇄 × 원고지 시각 정체성을 앱에 적용, 디자인 토큰 단일 출처(`DESIGN_TOKENS_CSS`) | 디자인 기획 2.4·6.4·10·11 | designer, frontend | 앱과 블로그 template이 같은 토큰 문자열을 쓴다(unit).<br>E2E·Axe가 그대로 통과하고 네 폭에서 가로 넘침이 없다. | 완료 (2026-11-10 lint, typecheck, build, unit 309개, integration 22개(template 19·web 3), E2E 11개(+폭 전용 skip 3) 통과. 포트 3100을 다른 프로젝트 서버가 쓰고 있어 같은 E2E를 포트 3200 임시 설정으로 실행했다. `DESIGN_TOKENS_CSS`를 publisher에 두고 블로그 `BaseLayout`과 앱 `layout.tsx`가 같은 문자열을 넣는다(unit: template이 토큰 문자열을 그대로 포함). 앱: Hahmlet·JetBrains Mono 가변 글꼴과 시스템 고딕(처음 넣은 Noto Sans KR은 Vercel build의 글꼴 다운로드 실패로 뺐다), 잉크 주 버튼, 연필 파랑 단 구분선·기준선·재단선, 교정 붉은 게시 중 막대, 게시 완료 카드 교료 도장, ‘칸’‘반’ 로고, 안내 문구, 개수 단위 `편`(E2E 기대 문구 4곳 갱신). 1440·1024·768·320px 스크린샷으로 넘침·겹침 확인(1024px는 scrollWidth로도 가로 넘침 없음 측정). 블로그는 같은 토큰만 바뀐 중간 상태(U4에서 마무리)) |
| U4 정체성: 블로그 | 블로그 template·프리뷰에 교정쇄 × 원고지 적용: 판권·(끝)·200자 원고지 매수, 제목 글꼴 | 디자인 기획 2.4·7.5·10·11 | designer, backend | 매수 계산을 unit으로, 판권·(끝)을 template integration으로 증명한다. | 완료 (2026-11-10 lint, typecheck, build, unit 311개(매수 계산 2개 추가), integration 22개(template 19·web 3, 판권·(끝)·매수·글꼴 link·옛 글 분량 생략 확인 추가), E2E 11개(+폭 전용 skip 3) 통과. publisher가 게시 때 `countManuscriptPages`로 `manuscriptPages` frontmatter를 쓰고(본문 글자가 없으면 생략), template이 글 메타·판권에 보여준다. 앱 프리뷰도 같은 함수로 매수·(끝)·판권을 그린다. 블로그는 Google Fonts `Hahmlet` 700만 받는다. 샘플 블로그 build를 1200·375px로 확인. 매수는 다음 게시부터 붙는다(실제 블로그의 기존 글은 0개)) |
| U5 디자인 시스템 다지기 | 간격·글자 크기 토큰화, 버튼·카드·dialog 컴포넌트화, 개발용 style guide | 디자인 기획 10·11 | designer, frontend | 앱 CSS의 간격·글자 크기 literal이 토큰으로 바뀐다. | 대기 |

## 칸반 일관성 백로그 (2026-11-11 사용자 요청)

같은 GitHub 계정으로 다른 브라우저에서 로그인하면 게시 완료 열이 비던 문제(칸반 표시 설정이 브라우저 IndexedDB에만 있음)와,
글을 한꺼번에 다시 게시할 때 GitHub 시간당 한도를 넘길 수 있는 문제를 다룬다.

| 단계 | 내용 | 요구사항 | 역할 | 완료 조건 | 상태 |
|---|---|---|---|---|---|
| K1 배포 상태 조회 통합 | 여러 글을 기다릴 때 마지막 commit 하나만 조회 | §5 상태 조회 | frontend | 함께 게시하는 글 수와 관계없이 상태 조회가 10초에 최대 1번이다(unit). | 완료 (2026-11-11 `03b7b3e`. lint, typecheck, unit 272개 통과. 결과 재사용·failed fallback 테스트 추가) |
| K2 칸반 무상태화(K3로 일부 대체) | IndexedDB 칸반 저장소 제거, page 목록 기반 역할 판별, 토글 안 page의 소유 page 찾기, 보관 중 검색 | R3, R4, §3 칸반, §4 | backend, frontend | 아무 저장 데이터가 없는 다른 브라우저에서 같은 칸반이 보인다(E2E).<br>하위 page도 칸반에 오르고 컨테이너는 오르지 않는다(unit·E2E).<br>토글 안 page가 소유 page 아래로 붙는다(unit). | 완료 (2026-11-11 `e3ae72b`, PR #4로 prd 배포) |
| K3 보관 중 직접 고르기 | 문서 목록의 추가 토글, 보관 중 목록을 블로그 저장소 branch에 저장(`/api/board`), 보관 중 카드 ✕ | R4, §3 칸반, §4 | backend, frontend | 고른 문서만 보관 중에 오르고, 저장 데이터 없는 다른 브라우저에서도 같은 보관 중이 보인다(E2E).<br>branch가 없으면 부모 없는 commit으로 만들고, 동시 변경은 409로 실패한다(unit).<br>연결 소유권·origin·추가 필드를 거절한다(unit). | 완료 (2026-11-11 아래 커밋 본문 참조) |

## 미결 결정

없음. 아래 D1~D5는 2026-11-10 사용자가 권고안대로 진행을 승인했다.

| 번호 | 결정 | 선택지 | 확정 | 적용 단계 |
|---|---|---|---|---|
| D1 | 블로그에서 내리기 확인 방식 | 확인 dialog / 버튼 두 번 누르기 | 확인 dialog(글 제목과 "블로그에서 삭제, Notion 원문은 유지" 안내) | B1 |
| D2 | RSS 본문 범위 | 설명만 / 전체 본문 | 설명만(본문 HTML escape 부담 없음) | B2 |
| D3 | 사이트 설정 편집 경로 | 앱 설정 화면에서 저장소 파일 commit / Notion 설정 page 예약 속성 | 앱 설정 화면 → `.kanban-press/site.json` commit | B4 |
| D4 | 주소가 바뀐 옛 글 | 지우기만 / 옛 주소에 새 주소로 보내는 안내 page 남기기 | 안내 page 남기기(외부 링크 보존, JavaScript 없이 meta refresh + 링크) | B1(정리 규칙), B4 |
| D5 | 블로그 제목 글꼴 | Google Fonts `Hahmlet`을 블로그에서 받기(독자 브라우저가 Google에 요청) / 글꼴 파일을 블로그 저장소에 넣기(용량 큼) / 시스템 명조로 대신하기(기기마다 모양이 다름) | Google Fonts `Hahmlet` 700 한 굵기(받지 못해도 시스템 명조로 읽힘). 제품 명세 게시 절의 “외부 font 없이” 문구를 함께 고쳤다 | U4 |
