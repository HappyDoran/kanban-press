# 구현 TODO

표기: `[ ]` 미착수, `[-]` 진행 중, `[x]` 완료, `[!]` 외부 설정 필요

## P0 — 기반과 보안 경계

- [x] Node 22, pnpm workspace, Next.js web scaffold
- [x] DB 없는 구조로 문서·package 경계·실행 구성을 전환
  - 수용 기준: PostgreSQL, DB package, Worker, 서버 storage 의존성이 없다.
  - 수용 기준: 문서와 프로젝트 스킬이 쿠키 + IndexedDB + 직접 게시 흐름을 설명한다.
  - 수용 기준: install, lint, typecheck, test, build가 통과한다.
- [x] stateless cookie codec 구현
  - 수용 기준: AEAD seal/open, key version, expiry, tamper detection을 단위 테스트한다.
  - 수용 기준: token과 평문 payload가 로그 또는 client bundle에 노출되지 않는다.
- [x] GitHub OAuth App 생성 및 local callback 등록
- [x] GitHub 로그인 vertical slice
  - 수용 기준: start/callback/logout과 `/api/me`가 동작한다.
  - 수용 기준: OAuth state 위조·만료·재사용과 잘못된 redirect를 거절한다.
  - 수용 기준: GitHub numeric ID가 IndexedDB namespace로 전달된다.

## P1 — Notion과 개인 칸반

- [x] Notion Public Integration 생성 및 callback 등록
- [x] Notion OAuth 연결/해제
  - 수용 기준: 연결 token은 암호화 HttpOnly 쿠키에만 존재한다.
  - 수용 기준: 연결 개수와 직렬화 크기 상한을 초과하면 안전하게 거절한다.
  - 수용 기준: 한 GitHub 사용자의 연결이 다른 사용자 namespace에 나타나지 않는다.
- [x] Notion workspace와 page tree 조회
  - 수용 기준: integration에 공유된 root page와 하위 page만 표시한다.
  - 수용 기준: pagination, rate limit, 권한 철회를 처리한다.
- [x] IndexedDB repository와 migration 구현
  - 수용 기준: GitHub user ID별 board record가 격리된다.
  - 수용 기준: token을 저장하지 않으며 schema validation을 통과한 값만 읽는다.
- [x] 칸반 UI와 상태 전이 구현
  - 수용 기준: 저장 당시 정의된 column 전이가 domain 규칙을 따른다.
  - 수용 기준: keyboard 조작과 새로고침 복구가 가능하다.
- [x] Notion 계층과 칸반 통합
  - 수용 기준: 연결에서 발견한 page는 기존 상태를 보존하며 기본 column으로 자동 동기화한다.
  - 수용 기준: 하위 page는 기본 접힌 toggle로 표시한다.
  - 수용 기준: 사용자가 page별 칸반 표시 여부를 변경하고 새로고침 후 복구한다.
- [x] data source 계층과 기본 칸반 노출 축소
  - 수용 기준: data source 행 page를 database parent page 아래에 배치한다.
  - 수용 기준: 최상위 page를 펼칠 때만 block outline을 조회하고 Notion toggle 제목과
    그 안의 child page 계층을 보존한다.
  - 수용 기준: `block_id` 부모 page를 root로 승격하거나 기본 칸반에 표시하지 않는다.
  - 수용 기준: 최상위 page만 기본 표시하고 하위 page는 사용자가 선택해야 표시한다.
  - 수용 기준: 기존 자동 표시 record를 v5에서 재평가하되 명시적 숨김은 보존한다.
- [x] page 문서/컨테이너 역할 설정
  - 수용 기준: 사용자가 `Legacy` 같은 page를 컨테이너로 지정하고 새로고침 후 복구한다.
  - 수용 기준: 컨테이너는 칸반과 게시 대상에서 제외되고 하위 outline toggle만 제공한다.
  - 수용 기준: 다시 문서로 전환하면 기존 column, position, 표시 선택을 복원한다.
  - 수용 기준: v5 record는 v6에서 안전하게 `document` 역할로 migration된다.
  - 수용 기준: 자동 구조 검사 완료 전에는 컨테이너 선택을 노출하지 않고, 하위
    outline이 있는 page에만 선택을 제공한다.
  - 수용 기준: 화면에 나타난 미확인 page를 동시 3개 이하로 자동 검사하고 수동 확인
    버튼을 노출하지 않는다.
  - 수용 기준: 검사 결과는 Notion 수정 시각 기준으로 캐시하고 원문 변경 시 무효화한다.
  - 수용 기준: v6 record는 v7에서 nullable 구조 검사 상태로 안전하게 migration된다.
- [x] Notion 계층 블록 호환성 강화
  - 수용 기준: 설명용 toggle만 있는 page는 컨테이너 후보가 되지 않는다.
  - 수용 기준: toggle heading과 제목 있는 자식 보유 block의 계층을 보존한다.
  - 수용 기준: column/tab/synced block을 순회하고 순환 참조를 안전하게 중단한다.
  - 수용 기준: `link_to_page`의 접근 가능한 page/database를 outline에 연결한다.
  - 수용 기준: v7의 이전 판정 캐시를 v8에서 무효화하되 사용자 역할과 칸반은 보존한다.
  - 수용 기준: 대표 fixture와 malformed provider 응답을 테스트한다.
- [x] page 판별 중 액션 UI 단일화
  - 수용 기준: 판별 전에는 page 역할·칸반 액션 대신 단일 로딩 상태만 표시한다.
  - 수용 기준: 판별 완료 후에만 문서 또는 컨테이너에 맞는 액션을 표시한다.
  - 수용 기준: 판별 실패도 중복 버튼 없이 단일 상태로 표시한다.
- [x] page 역할 자동 적용과 예외 데이터 호환
  - 수용 기준: 탐색 가능한 하위 구조가 있으면 컨테이너, 없으면 문서로 자동 적용한다.
  - 수용 기준: 일반 화면에서 `컨테이너로 사용`·`문서로 사용` 버튼을 제거한다.
  - 수용 기준: 판별 실패에는 `구조 다시 확인` 하나만 제공한다.
  - 수용 기준: v8의 컨테이너 역할은 수동 override로 보존하고 기본 문서는 자동 역할로 전환한다.
- [x] 수동 page 역할 UI 제거
  - 수용 기준: page 행에 더보기 또는 문서/컨테이너 역할 설정을 노출하지 않는다.
  - 수용 기준: 문서는 `표시하기/숨기기`, 컨테이너는 펼치기/접기만 제공한다.
  - 수용 기준: 판별 실패의 `구조 다시 확인`은 유지한다.
- [x] 게시 칸반 3단계 단순화
  - 수용 기준: UI는 `보관 중`, `게시 중`, `게시 완료`로 표시한다.
  - 수용 기준: v9의 draft/review/ready/failed는 stored, publishing과 published는
    같은 의미의 column으로 v10에서 migration된다.
- [x] 영속 게시 상태 제거와 반복 게시 허용
  - 수용 기준: IndexedDB에는 `stored`만 저장하고 게시 SHA/hash/URL을 저장하지 않는다.
  - 수용 기준: 게시 중·완료 상태와 완료 링크는 React 메모리에만 존재해 새로고침 시
    사라진다.
  - 수용 기준: v11 record는 v12에서 게시 상태와 추적 필드를 안전하게 제거한다.
  - 수용 기준: 동일 콘텐츠를 다시 게시해도 새 commit과 Actions 실행을 만든다.
  - 수용 기준: 보관 카드를 게시 중 column에 drop하면 게시하고 별도 게시 버튼이나
    상태 선택기를 노출하지 않는다.
  - 수용 기준: 완료 카드는 게시 중으로 drop해 다시 게시하거나 보관 중으로 drop해
    완료 표시를 닫을 수 있다.
  - 수용 기준: 카드의 `×`는 원문을 삭제하지 않고 칸반 표시만 해제한다.
  - 수용 기준: 포인터가 게시 중 column 안에 있으면 인접 카드보다 해당 column을
    drop 대상으로 우선해 빈 column에도 안정적으로 게시할 수 있다.
  - 수용 기준: 게시 성공 카드는 현재 화면에서 완료 상태로 유지하되 IndexedDB에서는
    숨김 처리해 새로고침 후 칸반에 다시 나타나지 않는다.
  - 수용 기준: 완료 카드를 보관 중으로 되돌리면 표시 상태도 복구한다.

## P2 — GitHub Pages 게시

- [x] OAuth 기반 `<login>.github.io` 직접 게시 경계
  - 수용 기준: OAuth에서 `public_repo workflow`를 요청하고 기존 사용자의 재동의를
    안내한다.
  - 수용 기준: 현재 사용자 소유의 public `<login>.github.io`와 push 권한만 허용한다.
  - 수용 기준: GitHub App 환경 변수, route, installation 저장 데이터가 없다.
- [x] Astro 게시 manifest와 template 완성
  - 수용 기준: project site와 user site의 base path를 모두 build test한다.
  - 수용 기준: lockfile 없는 생성 repository의 workflow가 pnpm과 무캐시 설치를
    명시하고 Pages artifact를 업로드한다.
  - 수용 기준: pnpm dependency build script는 `pnpm-workspace.yaml`의
    `allowBuilds`에서 Astro에 필요한 `esbuild`만 허용한다.
- [x] Notion block 변환 pipeline
  - 수용 기준: 제목, 본문, 코드, 이미지, toggle, link의 fixture test가 있다.
  - 수용 기준: 위험한 HTML과 경로 이탈을 차단한다.
- [x] 요청 기반 게시 orchestration
  - 수용 기준: 최신 Notion 권한과 GitHub 권한을 매 요청 재검증한다.
  - 수용 기준: 동일 콘텐츠의 반복 게시와 중복 commit을 허용한다.
  - 수용 기준: commit SHA를 반환하고 UI가 Actions/Pages 상태를 복구한다.

## P3 — GitHub Pages 블로그 경험 확장

- [ ] Pages 내보내기 readiness와 repository 보호
  - 수용 기준: workflow branch가 실제 default branch와 일치한다.
  - 수용 기준: Pages custom workflow 준비 상태와 기존 파일 변경 범위를 게시 전에 확인한다.
  - 수용 기준: Actions URL과 provider별 복구 행동을 UI에서 제공한다.
- [ ] Notion 블로그 metadata와 공유 문서 조립 계약
  - 수용 기준: 예약 속성은 서버가 최신 Notion 원문에서만 읽고 strict validation한다.
  - 수용 기준: preview와 publish가 동일한 `PublishDocument` 조립 경계를 사용한다.
  - 수용 기준: 브라우저가 title, category, tag, Markdown, slug를 대신 전달하지 않는다.
- [ ] Astro template v2와 v1 게시물 호환
  - 수용 기준: v1/v2 mixed collection이 user/project base path에서 build된다.
  - 수용 기준: 기존 글 URL을 유지하고 v1 metadata 누락은 `미분류`로 처리한다.
  - 수용 기준: compatibility reader를 v2 Markdown writer보다 먼저 배포한다.
- [ ] 카테고리 기반 홈·전체 글·상세 블로그 UI
  - 수용 기준: 홈, `/posts/`, category index/detail, post, 404가 정적으로 생성된다.
  - 수용 기준: 320px부터 반응형이며 JavaScript 없이 핵심 탐색이 동작한다.
  - 수용 기준: WCAG 2.2 AA와 user/project base path 회귀 검증을 통과한다.
- [ ] 안전한 게시 전 preview API와 UI
  - 수용 기준: preview는 현재 사용자 소유 Notion 원문을 매 요청 다시 읽고 GitHub mutation을 하지 않는다.
  - 수용 기준: typed DTO만 반환하며 raw HTML, Markdown, provider property, credential을 노출하지 않는다.
  - 수용 기준: 결과는 React memory에만 존재하고 IndexedDB v12와 게시 상태를 바꾸지 않는다.
- [ ] provider image local asset 변환과 capability URL 차단
  - 수용 기준: signed provider URL이 preview, Markdown, 로그, commit message에 남지 않는다.
  - 수용 기준: MIME, byte, redirect, timeout, SSRF 제한을 contract test한다.
- [ ] preview/category/template v2 통합 E2E와 rollout
  - 수용 기준: preview 이후 원문·권한 변경 시 publish가 최신 상태를 재검증한다.
  - 수용 기준: 실제 provider smoke와 전체 repository 검증이 통과한다.
  - 수용 기준: 세부 문서와 실제 구현 상태가 일치한다.

## P4 — 신뢰성과 운영

- [ ] provider rate limit, timeout, 사용자 재시도 UX
- [ ] secret redaction을 포함한 구조화 로그
- [ ] OAuth/IndexedDB/publish 핵심 E2E
- [ ] 접근성, 성능, 모바일 칸반 검증
- [ ] 쿠키 예산 또는 다기기 동기화 요구가 발생하면 DB 도입 ADR 작성
