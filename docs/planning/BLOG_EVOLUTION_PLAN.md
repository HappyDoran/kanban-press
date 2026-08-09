# GitHub Pages 블로그 고도화 실행 기획

## 한 줄 결론

현재 내보내기는 안전한 Astro 정적 블로그를 만들지만 게시 전 프리뷰와 분류 체계가 없고,
실제 Pages 준비 상태·기본 branch·기존 repository 보호에도 출시 전 보완점이 있다. 따라서
`배포 신뢰성 → 메타데이터 계약 → 호환 템플릿 → 프리뷰 → 시각 고도화` 순서로 진행한다.

상세 근거와 설계는 다음 문서를 기준으로 한다.

- [현행 내보내기 감사](./BLOG_EXPORT_CURRENT_STATE.md)
- [제품·UX·UI 디자인](./BLOG_EXPERIENCE_DESIGN.md)
- [기술 설계 및 작업 지시서](./BLOG_PUBLISHING_ROADMAP.md)

## 목표

- 작성자가 게시 전에 최신 Notion 기준의 제목·분류·본문 변환 결과를 확인한다.
- 독자가 홈, 전체 글, 카테고리, 글 상세를 자연스럽게 탐색한다.
- 글은 카테고리 1개와 태그 여러 개를 가질 수 있고, 기존 글은 `미분류`로 계속 빌드된다.
- 기존 v1 게시물의 URL과 DB-free·HttpOnly credential·반복 commit 계약을 보존한다.
- 모바일 320px, 키보드, 스크린 리더, JavaScript 비활성 공개 사이트에서도 핵심 흐름이 동작한다.

## 확정 결정

| 항목 | 결정 |
|---|---|
| 메타데이터 원천 | 서버가 최신 Notion의 `Blog Category`, `Blog Tags`, `Blog Description`, `Blog Published At` 예약 속성을 읽는다. 브라우저는 값을 대신 보내지 않는다. |
| fallback | 카테고리 누락은 `미분류`, 태그 누락은 빈 목록, 설명 누락은 첫 본문 문장, 발행일 누락은 Notion 생성일이다. |
| 프리뷰 | `POST /api/publish/preview`가 제한된 typed DTO를 반환하고 React가 escape된 text node로 렌더링한다. HTML/Markdown과 credential은 반환하지 않는다. |
| 프리뷰 성격 | 최종 Astro와 의미·토큰을 공유하는 예상 화면이며 pixel-perfect WYSIWYG로 약속하지 않는다. 게시 때 최신 원문을 다시 조회한다. |
| 템플릿 migration | template v2가 v1/v2 frontmatter를 함께 읽은 뒤 v2 writer를 활성화한다. 기존 글은 일괄 rewrite하지 않고 재게시할 때 승격한다. |
| 1차 탐색 범위 | 홈, `/posts/`, 카테고리 index/detail, 글 상세, 404. 태그는 표시만 하고 태그별 route는 후속이다. |
| 디자인 방향 | 따뜻한 paper 계열, shell 1120px·본문 720px, 읽기 중심, light theme 우선, WCAG 2.2 AA. |
| 게시 방식 | 기존처럼 `게시 중` column drop만 게시 명령이다. 프리뷰는 선택 사항이고 게시 버튼을 추가하지 않는다. |

## 단계별 전개

### 0. 내보내기 신뢰성 게이트

- workflow trigger를 실제 default branch와 맞춘다.
- Pages custom workflow 준비 상태를 확인하고 필요한 사용자 행동을 안내한다.
- app-managed marker와 변경 대상 목록으로 기존 repository 덮어쓰기 위험을 차단한다.
- Actions URL과 provider별 오류를 UI에 연결한다.

완료 조건: 신규 및 기존 test repository에서 commit부터 Pages URL까지 smoke test가 통과하고,
준비되지 않은 repository에는 게시를 시작하지 않는다.

### 1. 메타데이터와 호환 템플릿

- 예약 Notion 속성의 제한된 union과 strict fixture를 추가한다.
- preview/publish가 공유하는 `buildPublishDocument`를 만든다.
- template v2 marker, v1/v2 호환 content schema, `/posts/`와 카테고리 route를 구현한다.
- mixed v1/v2 repository를 user/project base path로 실제 Astro build한다.

완료 조건: 기존 v1 글은 `미분류`로 노출되고 permalink가 유지되며, v2 글은 결정적
category slug로 분류된다.

### 2. 안전한 프리뷰

- 동일 origin, 로그인 세션, 소유 Notion connection, 최신 page 접근을 재검증하는 preview API를 만든다.
- 카드/문서 계층에 `미리보기`를 제공하고 데스크톱 dialog·모바일 full-height 화면을 구현한다.
- 글 상세/홈, 390·768·1280 폭, loading/warning/권한/rate-limit/timeout 상태를 제공한다.
- 프리뷰 결과는 React memory에만 두며 IndexedDB schema v12는 변경하지 않는다.

완료 조건: 프리뷰 이후 원문을 바꾸면 publish가 이전 응답을 재사용하지 않고 최신 값으로
게시하거나 권한 오류로 실패한다.

### 3. 공개 블로그 디자인 고도화

- 공통 header/footer/skip link, PostCard, breadcrumb, metadata, 목차, 이전·다음 글을 구현한다.
- 카테고리 탐색, 빈 상태, 404, 긴 코드·URL·이미지 실패의 반응형 처리를 구현한다.
- 320/390/768/1024/1440px 시각 회귀와 axe/VoiceOver 점검을 수행한다.

완료 조건: 정적 build에서 모든 내부 링크가 base path를 지키고, JavaScript 없이 홈부터
글 상세까지 탐색할 수 있다.

### 4. 콘텐츠 fidelity와 운영

- provider-hosted 이미지를 검증·복사해 content-addressed local asset으로 만든다.
- list, checklist, table, equation 등 지원 block을 확대하고 미지원 block 경고를 제공한다.
- polling timeout/backoff, 구조화 로그·secret redaction, 핵심 E2E를 완성한다.
- 태그별 route, RSS, sitemap, Open Graph, 검색과 테마 프리셋은 측정된 요구 순으로 추가한다.

## 작업 운영 방식

- 각 단계는 별도 worktree로 구현하고 `계약/fixture`, `publisher`, `web/API`, `UI/E2E`를
  독립 검토 단위로 나눈다.
- vertical slice마다 외부 입력·실패 경로를 먼저 문서화하고 narrow test 후 전체 gate를 실행한다.
- template v2 호환 reader와 v2 writer는 반드시 별도 release gate로 배포한다.
- 실제 provider smoke test에는 test 전용 공개 repository와 비민감 Notion fixture만 사용한다.
- 세부 파일, 의존성, 위험, 단계별 수용 기준은 `BLOG_PUBLISHING_ROADMAP.md`의 P0~P8을 따른다.

## 이번 기획의 완료 기준

- 현행 동작과 위험이 코드·테스트 근거로 기록되어 있다.
- 제품 정보 구조, 화면, 상태, 반응형, 접근성, 디자인 토큰이 정의되어 있다.
- 데이터/API/template migration과 보안 경계가 합의 가능한 수준으로 구체화되어 있다.
- 구현 순서, 의존성, 수용 기준, release gate가 TODO에 연결되어 있다.
