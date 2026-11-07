---
title: 프리뷰 및 카테고리 기반 블로그 게시 로드맵
kind: history
last_verified: 2026-08-09
---

# 프리뷰 및 카테고리 기반 블로그 게시 로드맵

## 1. 목적과 범위

이 문서는 현재 `notion-kanban-blog`의 게시 vertical slice에 다음 기능을 추가하기 위한
기술 설계와 실행 순서를 정의한다.

1. 게시 전에 최신 Notion 원문과 게시 메타데이터를 확인하는 인앱 프리뷰
2. 카테고리별 목록과 글 탐색을 제공하는 GitHub Pages용 Astro 블로그
3. 기존 template v1과 이미 게시된 Markdown을 깨뜨리지 않는 template/content schema
   migration

이 계획은 구현에 앞선 설계 산출물이다. 현재의 DB-free, 사용자별 독립 모델과
credential 저장 경계를 변경하지 않는다. 별도 DB, Worker, queue, object storage,
GitHub App, 서버 측 preview/publish 이력을 추가하지 않는다. 루트의 기존 단일 사용자
Astro 프로토타입(`src/`, `scripts/`)은 참고 자료일 뿐 신규 앱에서 import하지 않는다.

## 2. 조사 결과와 현재 경계

기준 문서는 `AGENTS.md`, `docs/spec/PROJECT_SPEC.md`,
`TECH_RULES.md`, `docs/architecture/ARCHITECTURE.md`, `docs/spec/gap-analysis.md`다.
실제 코드는 문서에 정의된 경계를 다음과 같이 따르고 있다.

| 경계 | 현재 책임 | 이번 변경의 책임 |
|---|---|---|
| `packages/domain` | provider/UI 독립 ID, 칸반 record와 `stored` 상태 규칙 | 변경 없음. 카테고리와 preview는 IndexedDB 상태가 아니므로 board/domain 모델에 넣지 않는다. 여러 publisher가 공유하는 제품 규칙이 생길 때만 별도 domain 타입을 검토한다. |
| `packages/notion` | workspace/page/outline/content adapter 계약 | 지원하는 page property의 제한된 union을 계약에 추가한다. OAuth token, 원시 provider response, 불필요한 people/file/formula 값은 반환하지 않는다. |
| `apps/web/lib/notion` | Notion REST 응답 검증, pagination, block 정규화 | 예약 속성을 엄격히 파싱하고 크기·개수 상한을 적용한다. 최신 page retrieve가 실패하면 preview/publish를 실패시킨다. |
| `apps/web/lib/publish` | 세션·소유 연결 확인, Notion/GitHub 재검증, 문서 조립, commit 순서 | preview와 publish가 공유하는 `buildPublishDocument` orchestration을 소유한다. preview는 GitHub mutation을 호출하지 않고 publish만 고정 Pages repository를 재검증한다. |
| `packages/publisher` | provider 독립 `PublishDocument`, Markdown, 결정적 Astro template/artifact | 카테고리 metadata/frontmatter schema, category route, template marker/version, legacy schema compatibility를 소유한다. |
| `packages/github` | 고정 repository 검증, Git Data commit, 배포 상태 | 계약 변경 없음. publish마다 scope·owner numeric ID·public·push 권한을 계속 재검증하고 non-force commit한다. |
| `apps/web/app` | Route Handler, React UI, 메모리 게시 상태 | preview POST route와 접근 가능한 dialog/drawer를 추가한다. preview 응답이나 상태를 IndexedDB에 저장하지 않는다. |

현재 `PublishDocument`는 `slug`, `title`, `description`, `publishedAt`, `updatedAt`,
`blocks`를 가지며, template v1의 content schema도 같은 필드를 요구한다. 게시 요청은
브라우저에서 `{ connectionId, providerPageId }`만 받고 최신 원문과 고정 repository를
서버에서 다시 확인한다. 이 입력 형태와 반복 게시 시 중복 commit 허용 계약은 유지한다.

## 3. 반드시 보존할 계약

### 3.1 저장과 credential

- 서버 런타임은 `apps/web` 하나다.
- GitHub/Notion credential은 AEAD로 보호된 `HttpOnly`, production `Secure`,
  `SameSite=Lax` 쿠키에만 둔다.
- credential, 쿠키 원문, provider capability URL은 응답 JSON, URL, React state,
  IndexedDB, localStorage, 로그, GitHub artifact에 넣지 않는다.
- IndexedDB의 Dexie schema version 12와 `BoardRecord`는 변경하지 않는다. 카테고리,
  tag, preview 결과, template version, 게시 결과를 board record에 추가하지 않는다.
- preview 상태와 결과는 React 메모리에만 두고 dialog를 닫거나 새로고침하면 버린다.
  게시 중·완료 상태도 기존과 같이 React 메모리에만 둔다.

### 3.2 서버 재검증

- preview와 publish 모두 동일 origin `POST`, 유효한 GitHub 세션, 현재 사용자 소유
  Notion connection, 현재 credential로 가능한 page retrieve와 block pagination을
  요청 시점마다 확인한다.
- preview는 repository를 변경하거나 배포 가능성을 판정하지 않으므로 GitHub repository
  API를 호출하지 않는다. 대신 응답에 “게시 가능”을 보장하는 표현을 쓰지 않는다.
- publish는 기존과 같이 Notion 접근뿐 아니라 OAuth `public_repo` 또는 `repo`와
  `workflow` scope, 정확한 `<login>.github.io`, owner numeric ID, public 여부, push
  권한을 매 요청 다시 확인한다.
- 브라우저가 title, Markdown, category, tag, slug, repository, user ID 또는 template
  version을 대신 보내지 않는다. publish와 preview request body는 ID 두 개만 허용하는
  strict schema를 사용한다.
- preview 이후 publish까지 원문이 바뀔 수 있으므로 publish는 preview 결과를 재사용하지
  않고 최신 page와 blocks를 다시 가져온다.

### 3.3 게시 동작

- 보관 카드를 `게시 중` column으로 drop하는 동작만 publish 명령이다. 별도 게시 버튼이나
  영속 publish state를 만들지 않는다.
- 같은 문서를 같은 내용으로 다시 게시해도 template artifact와 문서 artifact의 hash를
  계산하고 매 요청 parent가 있는 새 commit을 만든다.
- ref 경합은 force push하지 않고 `409`로 실패한다. 응답 유실 후 재시도의 중복 commit은
  허용한다.

## 4. 목표 데이터 흐름

```text
Browser
  ├─ POST /api/publish/preview { connectionId, providerPageId }
  │    └─ React preview dialog (메모리, typed DTO, raw HTML 없음)
  └─ POST /api/publish { connectionId, providerPageId }
       │
       ▼
apps/web
  1. session + owned Notion connection 검증
  2. packages/notion으로 최신 page properties + blocks 조회
  3. 예약 속성 해석 + fallback + 경고 생성
  4. 공유 buildPublishDocument로 provider 독립 모델 생성
       ├─ preview: 안전한 projection만 no-store JSON으로 반환
       └─ publish: GitHub 고정 repository 재검증
                    → packages/publisher template v2 + Markdown
                    → packages/github non-force commit
```

preview와 publish가 같은 조립 함수를 사용해야 title, description, 날짜, category, tag,
slug, block 변환의 차이가 생기지 않는다. 단, preview 응답은 `PublishDocument`를 그대로
직렬화하지 않고 클라이언트에 필요한 필드만 고른 versioned DTO로 만든다.

## 5. 메타데이터 소스 설계

### 5.1 선택지

| 선택지 | 장점 | 문제 |
|---|---|---|
| 브라우저 form/IndexedDB | UI 구현이 단순하고 자유로운 편집 가능 | 비신뢰 입력이며 기기별로 달라진다. 서버 재검증 및 DB-free source-of-truth 계약과 맞지 않는다. |
| 본문 classifier | 사용자가 속성을 만들 필요가 없다 | 분류가 비결정적이고 오분류 정정 위치가 불명확하다. 루트 prototype의 keyword classifier를 신규 앱에 import할 수도 없다. |
| Notion 예약 page properties | 원문과 metadata의 source of truth가 하나이고 publish 때 재검증 가능 | 사용자가 정확한 속성 이름과 타입을 준비해야 하며 일반 page에는 속성이 없을 수 있다. |
| 서버 DB의 게시 설정 | 안정적인 ID와 migration에 유리 | 명시적인 DB-free MVP를 깨고 사용자 격리·운영 책임을 새로 만든다. |

**추천안은 Notion 예약 page properties와 안전한 fallback의 조합**이다. 이 값은 서버가
page retrieve 응답에서 직접 읽으며 브라우저가 덮어쓸 수 없다. 일반 page나 기존 page도
fallback으로 게시할 수 있다.

### 5.2 예약 속성 계약

속성명은 대소문자를 포함해 정확히 일치해야 한다. 비슷한 이름을 암묵적으로 alias로
처리하면 workspace마다 다른 결과가 나올 수 있으므로 v1에서는 alias와 사용자별 mapping을
지원하지 않는다.

| Notion 속성 | 허용 타입 | 게시 값 | 누락 시 fallback | 상한/오류 |
|---|---|---|---|---|
| title 타입 속성 | `title` | `title` | `제목 없음`은 publish 불가 | trim 후 1~2,000자 |
| `Blog Category` | `select` | `category.name` | `미분류` | trim 후 1~80자. 속성은 있는데 타입/값이 잘못되면 `422 invalid_blog_metadata` |
| `Blog Tags` | `multi_select` | `tags` | `[]` | 중복·공백 제거, 최대 5개, 각 1~40자. 초과/잘못된 타입은 `422` |
| `Blog Description` | `rich_text` | `description` | 첫 paragraph/quote/heading, 없으면 title | plain text 0~1,000자. annotation과 link는 description에서 제거 |
| `Blog Published At` | `date` | `publishedAt` | Notion `created_time` | 시작 시각만 사용, 유효한 offset 포함 ISO 8601. range end는 사용하지 않음 |
| Notion `last_edited_time` | system field | `updatedAt`, preview freshness | 없음 | 유효한 offset 포함 ISO 8601 필수 |

`Blog Slug`는 첫 릴리스에 넣지 않는다. 글 경로는 현재처럼 정규화한 title과 Notion page
ID 앞 12자리로 만들어 title 중복과 한글 title에서도 충돌하지 않게 유지한다. 사용자가
category를 바꿔도 글 URL은 바뀌지 않고 category membership만 바뀐다.

카테고리 route slug는 category display name의 `NFKC → trim → 연속 공백 축약 →
lowercase` 값을 기준으로 만든다. ASCII 영숫자 base(최대 48자)에 정규화된 원문의
SHA-256 앞 8자를 붙인다. ASCII base가 없으면 `category-<hash8>`을 사용한다. 따라서
한글 category도 안전하며 `C++`/`C#`처럼 ASCII 정규화가 겹치는 이름도 충돌하지 않는다.
`미분류`의 고정 route는 `uncategorized`다.

### 5.3 Notion adapter 계약

`NotionPageContent`에 원시 `properties`를 노출하는 대신 다음 제한된 product-neutral
property union을 추가한다. 실제 필드명 해석은 `apps/web` orchestration이 담당한다.

```ts
type NotionPageProperty =
  | { kind: "rich_text"; plainText: string }
  | { kind: "select"; name: string | null }
  | { kind: "multi_select"; names: readonly string[] }
  | { kind: "date"; start: string | null }
  | { kind: "unsupported"; providerType: string };

interface NotionPageContent {
  // 기존 필드 유지
  publishingProperties: Readonly<Record<string, NotionPageProperty>>;
}
```

adapter는 예약 속성 네 개만 골라 union으로 정규화한다. formula, rollup, people, email,
phone, URL, relation, file 등의 값은 버리되 예약 이름에 잘못된 타입이 있으면 값 없이
`unsupported`로 표시한다. 이 구분으로 `apps/web`은 provider envelope 손상(`502`)과 사용자
metadata 설정 오류(`422`)를 혼동하지 않는다. property map은 strict schema와 전체
byte/항목 상한을 적용하고, malformed provider response는 `invalid_response`로 실패시킨다.

## 6. `PublishDocument`, frontmatter와 Astro schema

### 6.1 `PublishDocument` v2

```ts
interface PublishCategory {
  name: string;
  slug: string;
}

interface PublishDocument {
  schemaVersion: 2;
  slug: string;
  title: string;
  description: string;
  category: PublishCategory;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  blocks: PublishBlock[];
}
```

`packages/publisher`는 Zod strict schema로 위 모델을 다시 검증한다. category slug와 post
slug는 소문자 ASCII 영숫자 및 단일 `-` 구분만 허용하고, tag/category/title/description
상한과 ISO 날짜를 재검증한다. 알 수 없는 필드는 거절한다. `providerPageId`, Notion URL,
credential, GitHub owner/repository는 문서 frontmatter에 넣지 않는다.

새 Markdown frontmatter는 다음과 같다.

```yaml
---
schemaVersion: 2
title: "예시 글"
description: "설명"
category: "Frontend"
categorySlug: "frontend-a1b2c3d4"
tags: ["React", "TypeScript"]
publishedAt: "2026-08-09T01:00:00.000Z"
updatedAt: "2026-08-09T02:00:00.000Z"
---
```

모든 문자열은 현재처럼 JSON string literal을 사용해 YAML/HTML 제어 문자를 escape한다.
tag 배열도 각 원소를 같은 함수로 직렬화하며 문자열을 이어 붙여 YAML을 만들지 않는다.

### 6.2 template v2

`PublisherManifest.templateVersion`을 `2`로 올리고 repository에
`.notion-kanban-blog/template.json` artifact를 추가한다.

```json
{
  "publisher": "astro",
  "templateVersion": 2,
  "contentSchemaVersion": 2
}
```

marker는 credential이나 사용자 ID를 포함하지 않으며 결정적 byte content를 가진다.
현재 GitHub adapter가 base tree 위에 artifact를 overlay하므로 별도 repository read API나
서버 저장소 없이도 이후 migration 기준을 repository에 남긴다. marker가 없는 repository는
template v1로 간주한다.

template v2는 다음 정적 route를 생성한다.

- `/`: 최신 글 목록과 category 탐색
- `/categories/`: category별 글 수와 링크
- `/categories/<categorySlug>/`: 해당 category 글 목록
- `/posts/<postSlug>/`: 기존 글 permalink 유지

category page는 commit 시 별도 HTML/Markdown artifact를 만들지 않고 Astro build가 전체
content collection에서 생성한다. 따라서 category rename 뒤 재게시하면 다음 build에서
현재 collection 기준으로 route가 재계산되고 stale category artifact를 삭제할 GitHub API가
필요 없다. 목록 정렬은 `publishedAt` 내림차순, 동률이면 post ID 오름차순으로 결정적으로
처리한다. category 정렬은 `name`의 locale-independent code point 순서를 기본으로 하고
동률이면 slug를 사용한다.

## 7. 기존 게시물과 template migration

### 7.1 원칙

- migration은 첫 v2 publish가 template 파일을 overlay하는 방식으로 수행한다.
- 기존 `src/content/blog/*.md`를 일괄 수정하거나 삭제하지 않는다.
- 기존 v1 post permalink는 유지한다.
- repository 전체 Notion page 목록이나 과거 publish 이력을 서버에 저장하거나 복구하려
  하지 않는다.
- 사용자가 repository에서 직접 만든 파일은 보존한다. 생성 template과 동일 경로의 파일은
  기존과 같이 publisher의 canonical artifact로 덮어쓴다는 점을 UI/문서에 명시한다.

### 7.2 호환 schema

template v2의 Astro content schema는 v1 필드도 받을 수 있어야 한다.

| 입력 | 해석 |
|---|---|
| `schemaVersion` 없음 | v1로 간주 |
| `category`/`categorySlug` 없음 | `미분류`/`uncategorized` |
| `tags` 없음 | `[]` |
| `schemaVersion: 2` | category, categorySlug, tags를 필수로 strict 검증 |
| 알 수 없는 미래 `schemaVersion` | build를 명시적으로 실패시켜 잘못된 해석 방지 |

이 compatibility window 덕분에 첫 v2 publish 직후에도 이전 글이 빌드되고 모두 `미분류`
목록에서 보인다. 이전 글을 다시 publish하면 같은 post path가 v2 frontmatter로 덮어써지고
Notion category로 이동한다. 강제 일괄 migration은 DB-free 환경에서 원문 연결과 과거
게시물의 대응을 신뢰성 있게 복구할 수 없으므로 제공하지 않는다.

template v2 배포 실패 시 application rollback은 template v1 코드로 되돌릴 수 있지만,
이미 생성된 v2 Markdown을 v1 schema가 읽지 못할 수 있다. 따라서 release 순서는 반드시
“v1+v2를 읽는 template v2 → v2 Markdown 생성 활성화”의 두 단계여야 한다. 첫 단계가 실제
fixture repository에서 build된 뒤에만 두 번째 단계를 배포한다.

## 8. preview API/UI 선택지와 추천안

### 8.1 API/렌더링 선택지

| 선택지 | 충실도 | 보안/운영 | 판단 |
|---|---|---|---|
| 서버가 Markdown 또는 HTML을 반환하고 `dangerouslySetInnerHTML`로 표시 | 높음 | sanitization 이중화, XSS, Astro와 Next 렌더러 차이, raw content contract 노출 위험 | 제외 |
| 요청마다 임시 Astro build 후 iframe 제공 | 최종 결과와 가장 가까움 | latency/CPU가 크고 임시 파일·process 관리가 필요하며 stateless route에 부적합 | 제외 |
| 제한된 typed preview DTO를 React component가 렌더링 | 의미상 충분 | React escaping, URL allowlist, block별 테스트가 가능. CSS 차이는 존재 | **추천** |
| GitHub에 preview branch/commit 후 Pages 확인 | 실제 결과와 동일 | publish 전 외부 mutation, branch cleanup/이력 저장이 필요 | 제외 |

### 8.2 추천 API

`POST /api/publish/preview`

```json
{
  "connectionId": "uuid",
  "providerPageId": "uuid"
}
```

성공 응답은 `cache-control: no-store`와 함께 versioned DTO만 반환한다.

```ts
interface PublishPreviewResponse {
  previewSchemaVersion: 1;
  templateVersion: 2;
  sourceLastEditedAt: string;
  document: {
    slug: string;
    title: string;
    description: string;
    category: { name: string; slug: string };
    tags: string[];
    publishedAt: string;
    updatedAt: string;
    blocks: PreviewBlock[];
  };
  warnings: PreviewWarning[];
}
```

`PreviewBlock`은 현재 `PublishBlock`의 paragraph, heading, quote, code, image placeholder,
toggle, divider projection이다. response schema는 클라이언트에서도 strict parse한다.
Markdown, raw HTML, provider property map, OAuth token, cookie, GitHub repository object는
반환하지 않는다. preview는 최종 Astro typography와 완전히 같다는 의미의
WYSIWYG가 아니라 “게시될 metadata와 구조의 의미상 프리뷰”라고 UI에 표시한다.

오류 계약은 다음과 같다.

| 상태 | code | 의미 |
|---|---|---|
| `400` | `invalid_preview_request` | UUID 또는 strict body 불일치 |
| `401` | `authentication_required` | 세션 없음/만료/복호화 실패 |
| `403` | `invalid_origin`, `notion_access_denied` | CSRF 조건 또는 현재 page 권한 실패 |
| `404` | `notion_connection_not_found` | 현재 사용자 소유 연결이 아님 |
| `422` | `invalid_blog_metadata` | 예약 속성이 존재하지만 타입/값/상한 위반 |
| `429` | `notion_rate_limited` | `Retry-After`를 안전한 숫자로 전달 |
| `502` | `notion_unavailable`, `preview_unavailable` | provider/정규화 실패 |

### 8.3 추천 UI

- `stored` 문서 card와 문서 계층의 document action에 `미리보기`를 제공한다. container와
  구조 판별 중/실패 page에는 노출하지 않는다.
- desktop은 modal dialog, 좁은 viewport는 full-height drawer를 사용하되 동일한 semantic
  component와 focus management를 공유한다.
- 열 때마다 preview POST를 새로 호출한다. 이전 preview를 IndexedDB나 localStorage에
  저장하지 않으며 다른 GitHub user namespace로 재사용하지 않는다.
- loading, metadata warning, 권한 철회, rate limit, provider timeout을 구분해 표시한다.
  실패 시 `다시 불러오기`만 제공하고 publish를 자동 실행하지 않는다.
- dialog에 title, description, category, tags, 날짜, 예상 post path와 block body를 표시한다.
  `sourceLastEditedAt`을 “Notion에서 확인한 시각”과 혼동하지 않게 “원문 최종 수정”으로
  표시한다.
- focus trap, `Escape` 닫기, 닫은 뒤 trigger focus 복귀, heading/landmark, code overflow,
  keyboard toggle을 제공한다.
- preview를 보고 dialog를 닫아도 card의 column/visibility/position은 바뀌지 않는다.
  publish는 기존 drag-and-drop에서만 시작한다.

## 9. 이미지와 URL 보안

현재 content adapter는 외부 image와 Notion이 발급한 file URL을 모두 HTTPS URL로
평탄화한다. Notion file URL은 만료되거나 query에 capability 성격의 서명을 포함할 수
있으므로 preview 응답이나 영구 GitHub Markdown에 그대로 넣지 않는 것이 안전하다.

초기 preview에서는 다음 정책을 권장한다.

- 사용자가 Notion block에 직접 지정한 public external HTTPS image만 URL allowlist,
  길이, hostname parsing을 거쳐 표시한다.
- provider-hosted file은 caption과 `이미지는 게시 시 복사됩니다` placeholder만 반환한다.
- publish에서는 서버가 현재 Notion credential로 file을 가져와 MIME(`image/png`,
  `image/jpeg`, `image/gif`, `image/webp`, `image/avif`), redirect 횟수, byte 상한을 검증한
  뒤 content hash 기반 `public/assets/<hash>.<ext>` artifact로 commit한다. Markdown에는
  provider URL이 아니라 site-relative asset path만 넣는다.
- SVG, HTML, data URL, `javascript:`, userinfo 포함 URL, private/link-local IP로 resolve되는
  fetch 대상은 거절한다. redirect마다 동일한 SSRF 검사를 반복한다.

이 asset 복사는 category 기능 자체의 필수 조건은 아니지만 preview가 새로운 capability
URL 노출을 만들지 않기 위한 보안 gate다. 구현 범위를 나눌 경우 preview v1은 image
placeholder로 출시하고 asset 복사가 끝날 때까지 image fidelity를 제한한다.

## 10. 보안과 운영 요구사항

- 모든 preview/publish POST는 정확한 app origin을 확인하고 request body content length와
  JSON nesting/field count를 제한한다.
- provider response, rich text, property 이름/값, URL, block 수와 재귀 깊이는 server
  boundary에서 Zod와 명시적 상한으로 검증한다.
- preview response는 `Cache-Control: no-store`, `Pragma: no-cache`,
  `X-Content-Type-Options: nosniff`를 사용한다. 민감 page title이 CDN/browser shared cache에
  남지 않게 route를 dynamic으로 유지한다.
- React renderer는 `dangerouslySetInnerHTML`을 사용하지 않는다. link는
  `http:`, `https:`, `mailto:`만 허용하며 새 창 링크에는 `rel="noreferrer noopener"`를
  적용한다. code와 text는 React text node로 렌더링한다.
- preview/publish 오류는 stable code만 client에 전달하고 provider body, request header,
  access token, encrypted cookie, signed media URL을 로그에 남기지 않는다.
- 사용자별 server cache, preview file, job, retry history를 만들지 않는다. rate limit과
  timeout은 요청 실패로 반환하고 사용자가 명시적으로 재시도한다.
- category/tag는 공개 GitHub repository에 게시되는 값임을 preview에 표시한다. 개인 정보가
  포함된 metadata를 자동으로 추가하거나 telemetry로 전송하지 않는다.
- content hash는 template marker, template artifact, local media artifact, Markdown의
  정렬된 path와 bytes를 모두 포함한다.
- template marker를 신뢰해 권한 검증을 생략하지 않는다. marker는 migration hint이지
  authorization source가 아니다.

## 11. 테스트 전략

### 11.1 단위/contract test

- `packages/notion`: 예약 property별 정상 fixture, 누락, null, 잘못된 type, malformed rich
  text, tag 개수/길이, pagination 중 권한 철회·429·timeout을 검증한다. token과 원시
  provider 응답이 반환 타입에 포함되지 않는지 확인한다.
- `apps/web/lib/publish`: preview와 publish가 동일 fixture에서 동일 slug/metadata/blocks를
  조립하는지 확인한다. Origin, 세션 만료, 타 사용자 connection, page ID mismatch,
  provider 권한 철회, malformed metadata를 검증한다. preview가 GitHub adapter나 commit을
  호출하지 않고 publish는 두 provider를 모두 재검증하는지 spy로 증명한다.
- `packages/publisher`: category slug의 한글/기호/case/collision fixture, tag dedupe/order,
  YAML/HTML escape, 경로 이탈, unknown field, 미래 schema version을 검증한다. artifact 순서와
  hash 결정성도 유지한다.
- `apps/web` UI: response strict parsing, loading/error/warning, dialog focus/keyboard,
  image placeholder, raw HTML text escaping, dialog 닫기 후 board 불변을 검증한다.

### 11.2 template integration test

다음 fixture를 임시 directory에서 실제 Astro build한다.

1. user site `/`와 project site `/<repository>/`
2. v1 글만 존재하는 repository를 template v2로 overlay
3. v1/v2 혼합 collection
4. 여러 category, `미분류`, 한글 category, 같은 날짜 글
5. HTML/Markdown 제어 문자가 있는 title/description/tag
6. local media asset이 있는 글

산출된 `dist`에서 home, category index, category detail, post permalink, base-prefixed link,
정렬, canonical metadata를 검사한다. v1 글이 `미분류`에 나타나고 기존 `/posts/<slug>/`
경로가 유지되어야 한다.

### 11.3 E2E와 전체 검증

mocked OAuth/provider를 사용하는 Playwright 시나리오는 다음을 포함한다.

1. 사용자 A가 page preview를 열어 metadata/body를 확인한다.
2. preview 후 Notion 권한 또는 원문을 바꾸면 publish가 이전 DTO를 쓰지 않고 다시
   조회하여 실패하거나 최신 값으로 commit한다.
3. 사용자 B가 A의 connection ID를 보내도 preview/publish 모두 접근할 수 없다.
4. preview가 새로고침 뒤 복구되지 않고 IndexedDB v12 record가 변하지 않는다.
5. publish 성공 뒤 기존의 메모리 `published` 표시와 새로고침 후 숨김 계약이 유지된다.

각 vertical slice 완료 전 좁은 test를 먼저 실행하고 최종 gate에서 다음 명령을 모두
통과시킨다.

```bash
mise exec -- corepack pnpm install --frozen-lockfile
mise exec -- corepack pnpm lint
mise exec -- corepack pnpm typecheck
mise exec -- corepack pnpm test
mise exec -- corepack pnpm test:integration
mise exec -- corepack pnpm build
```

실제 GitHub/Notion credential이 필요한 smoke test는 필수 CI와 분리하며, fixture/log에
실사용자 ID, token, cookie 또는 private page content를 commit하지 않는다.

## 12. 단계별 작업 리스트

아래 순서는 compatibility와 공유 조립 경계를 먼저 만들고 UI를 마지막에 연결한다.
각 단계는 수용 기준이 통과되기 전 다음 단계의 완료로 표시하지 않는다.

### P0. 계약과 fixture 고정

**작업**

- 기준 문서와 `docs/spec/gap-analysis.md`에 metadata source, preview endpoint, template v2, v1
  compatibility contract를 반영한다.
- v1 Markdown, 예약 Notion properties, 한글 category, malformed provider response fixture를
  만든다.

**의존성:** 없음.

**수용 기준**

- 문서에서 DB-free/HttpOnly/IndexedDB v12/서버 재검증/반복 commit 계약이 서로 모순되지
  않는다.
- fixture에 token, 실제 사용자 ID, private content가 없다.
- package boundary checker가 목표 의존성을 허용하며 adapter 간 import가 생기지 않는다.

**주요 위험:** 구현 전에 API 명칭이 바뀌어 문서가 drift할 수 있다.
**완화:** external request/response와 schema version을 contract test 이름에 고정하고 코드보다
문서를 먼저 갱신한다.

### P1. Notion metadata 정규화

**작업**

- `packages/notion` property union과 `NotionPageContent.publishingProperties`를 추가한다.
- `NotionRestContentAdapter`가 예약 property만 읽고 strict validation/상한을 적용하게 한다.
- provider error에 timeout/rate-limit mapping을 추가하고, 예약 이름의 잘못된 property
  type은 값 없는 `unsupported`로 전달한다.

**의존성:** P0.

**수용 기준**

- 누락 속성은 fallback 가능한 null/빈 값으로, 존재하지만 잘못된 타입은 명시적 실패로
  구분된다.
- people/file/formula/원시 property와 credential이 adapter 결과에 포함되지 않는다.
- page retrieve와 모든 block pagination이 현재 credential로 성공해야 content가 반환된다.

**주요 위험:** Notion API version별 property shape 변화.
**완화:** passthrough는 provider envelope에만 허용하고 사용하는 field는 strict fixture contract로
검증한다. `NOTION_API_VERSION` 변경 때 fixture를 함께 갱신한다.

### P2. 공유 문서 조립과 metadata 규칙

**작업**

- `apps/web/lib/publish`에 순수 `deriveBlogMetadata`와 shared
  `buildPublishDocument`를 만든다.
- 현재 `pageDescription`, `pageSlug`, block level 변환을 이 경계로 모아 preview/publish가
  공유하게 한다.
- category slug, tag dedupe/order, fallback, warning/error code를 결정적으로 구현한다.

**의존성:** P1.

**수용 기준**

- 같은 `NotionPageContent`는 실행 순서와 관계없이 byte-equivalent 문서 모델을 만든다.
- preview와 publish orchestration test가 동일 metadata/block 결과를 사용한다.
- present-but-invalid property는 조용히 fallback하지 않고 `422`가 된다.
- browser request 값이 title/category/tag/slug를 덮어쓸 경로가 없다.

**주요 위험:** preview와 publish가 다시 분기해 결과가 달라짐.
**완화:** 공유 함수 외부에서 metadata를 조립하지 못하게 하고 동일 fixture contract test를 둔다.

### P3. template v2 compatibility 먼저 배포

**작업**

- `PublisherManifest.templateVersion = 2`, marker artifact, v1/v2 content schema를 추가한다.
- home/category index/category detail route와 결정적 정렬을 구현한다.
- 이 단계의 Markdown writer는 아직 v1도 만들 수 있게 feature gate 또는 두 단계 release
  경계를 유지한다.

**의존성:** P0. P2와 병행 가능하지만 v2 Markdown 활성화보다 먼저 완료해야 한다.

**수용 기준**

- v1-only, v1/v2 mixed fixture가 user/project base 모두에서 실제 Astro build된다.
- v1 permalink가 유지되고 v1 글은 `미분류`에서 보인다.
- marker와 모든 template artifact가 결정적이고 repository 상대 안전 경로만 사용한다.
- unknown future content schema는 명시적으로 build 실패한다.

**주요 위험:** template v2가 기존 수동 Markdown이나 v1 글을 깨뜨림.
**완화:** compatibility schema를 먼저 배포하고 mixed repository fixture를 release gate로 둔다.

### P4. v2 Markdown 및 category 게시 활성화

**작업**

- `PublishDocument` strict schema와 frontmatter writer를 v2로 확장한다.
- template v2 artifact, marker, v2 Markdown을 함께 hash/commit한다.
- 같은 post slug의 재게시로 v1 파일을 v2로 자연스럽게 덮어쓴다.

**의존성:** P2, P3.

**수용 기준**

- category/tag/date/description이 server-derived 값으로 안전하게 frontmatter에 들어간다.
- category 변경 후 post URL은 유지되고 다음 build에서 category membership만 바뀐다.
- 반복 publish가 같은 content hash여도 매번 새 non-force commit을 만든다.
- 기존 GitHub repository scope/owner/public/push 재검증 test가 모두 유지된다.

**주요 위험:** category rename으로 외부 category link가 바뀜.
**완화:** post permalink는 유지하고 category route가 metadata 파생 경로임을 명시한다. category
redirect 이력이 필요해지는 시점은 DB/manifest index 도입을 별도 ADR로 판단한다.

### P5. media capability URL 차단

**작업**

- external image와 provider-hosted file을 adapter 모델에서 구분한다.
- provider file을 서버에서 제한적으로 fetch하고 content-addressed local asset artifact로 만든다.
- preview DTO에서는 구현 완료 전 provider image placeholder만 반환한다.

**의존성:** P1, P2. full-image preview보다 선행하며 P4와 병행 가능하다.

**수용 기준**

- OAuth token과 signed provider URL이 preview JSON, Markdown, log, commit message에 없다.
- MIME/byte/redirect/SSRF 제한과 잘못된 image 응답을 contract test한다.
- asset path와 bytes가 content hash에 포함되고 같은 bytes는 같은 path를 만든다.

**주요 위험:** 큰 파일, slow response, DNS rebinding, Notion URL 만료.
**완화:** 짧은 timeout, streaming byte cap, redirect별 DNS/IP 재검증, publish 요청 안에서 즉시 fetch,
명시적 사용자 재시도를 사용한다.

### P6. preview API

**작업**

- `POST /api/publish/preview` route와 strict request/response schema를 추가한다.
- session, Origin, owned connection, 최신 page access를 재검증한 뒤 P2 공유 문서를 안전한
  preview DTO로 projection한다.
- no-store/security header와 stable error mapping을 적용한다.

**의존성:** P2, P5의 placeholder 정책.

**수용 기준**

- request는 ID 두 개 외 필드를 거절하며 current user의 connection만 허용한다.
- 매 요청 최신 Notion page/blocks를 읽고 GitHub adapter/commit은 호출하지 않는다.
- 응답에 raw HTML/Markdown/property map/credential/signed provider URL이 없다.
- 권한 철회, page mismatch, 429, timeout, malformed metadata가 정의된 status/code로 나온다.

**주요 위험:** preview endpoint가 private content exfiltration 표면이 됨.
**완화:** HttpOnly session, 소유 connection, 현재 page access, exact Origin, no-store, 최소 DTO,
응답 크기 상한을 함께 강제한다.

### P7. 접근 가능한 preview UI

**작업**

- document card/tree action, responsive dialog/drawer, typed block renderer를 추가한다.
- loading/warning/error/retry/freshness 상태와 metadata 공개 안내를 구현한다.
- preview lifecycle을 React memory로 제한한다.

**의존성:** P6.

**수용 기준**

- container/판별 중 page에는 preview action이 없고 document에만 나타난다.
- raw HTML 없이 text/code/link/toggle/image placeholder를 안전하게 렌더링한다.
- keyboard-only open/탐색/close/focus restore와 mobile viewport가 통과한다.
- preview 전후 BoardRecord, visibility, position, column이 변하지 않고 새로고침 후 결과가
  복구되지 않는다.
- publish 시작 방식은 기존 drag-and-drop 하나로 유지된다.

**주요 위험:** 큰 문서가 dialog 성능과 접근성을 악화함.
**완화:** block/response 상한, 긴 code overflow, 필요한 경우 viewport rendering을 사용하되
heading/focus 순서를 깨지 않는다.

### P8. 통합 E2E, rollout과 운영 문서

**작업**

- mocked OAuth/Notion/GitHub E2E와 mixed template integration suite를 완성한다.
- README, PROJECT_SPEC, ARCHITECTURE, TECH_STACK, TODO와 Notion property 설정 안내를
  실제 동작에 맞춘다.
- compatibility-only template v2와 v2 writer의 두 release gate를 순서대로 수행한다.

**의존성:** P3~P7.

**수용 기준**

- 11장의 단위/contract/integration/E2E와 repository 전체 검증 명령이 모두 통과한다.
- 실제 provider smoke test에서 preview→원문 변경→publish 재검증과 category Pages route를
  확인한다.
- rollback 절차, v1 글의 `미분류` fallback, 재게시 migration, preview 비-WYSIWYG 제한,
  공개 metadata 안내가 사용자 문서에 있다.
- `docs/spec/gap-analysis.md` 상태가 실제 검증 결과와 일치한다.

**주요 위험:** GitHub Actions/Pages eventual consistency와 provider rate limit 때문에 smoke
test가 flaky함.
**완화:** deterministic local Astro build를 필수 gate로 두고 실제 provider smoke는 별도
재시도 가능한 운영 검사로 분리한다.

## 13. 의존성 요약과 release gate

```text
P0 계약/fixture
 ├─ P1 Notion metadata ─ P2 공유 문서 조립 ─┬─ P4 v2 게시
 │                                           ├─ P5 media 안전
 │                                           └─ P6 preview API ─ P7 preview UI
 └─ P3 template v2 compatibility ─────────────┘
                                                     │
                                                     ▼
                                              P8 E2E/rollout
```

release gate는 다음 순서를 바꾸지 않는다.

1. v1/v2를 모두 읽는 template v2가 mixed fixture에서 build된다.
2. 첫 template v2 overlay가 기존 글을 깨뜨리지 않는 것을 확인한다.
3. v2 Markdown writer와 category metadata publish를 활성화한다.
4. preview API를 연 뒤 UI를 노출한다.
5. provider-hosted image는 local asset 복사가 검증되기 전까지 placeholder로 유지한다.

## 14. 완료 정의

이 로드맵의 구현 완료는 다음 조건을 모두 만족할 때다.

- 사용자가 최신 Notion 문서의 metadata와 본문 구조를 publish 전에 안전하게 preview한다.
- publish는 preview를 신뢰하지 않고 Notion/GitHub 권한과 최신 원문을 다시 검증한다.
- 생성 블로그가 home, category index/detail, 기존 post permalink를 user/project base에서
  올바르게 build한다.
- 기존 v1 글은 삭제나 일괄 rewrite 없이 계속 노출되고 재게시 시 v2로 승격된다.
- credential과 capability URL이 HttpOnly 쿠키/서버 경계를 벗어나지 않는다.
- IndexedDB v12, React-memory publish state, 반복 commit, non-force conflict 계약이 유지된다.
- 전체 lint, typecheck, unit, integration, build와 핵심 E2E가 통과하고 문서/TODO가 실제
  구현과 일치한다.
