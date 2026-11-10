---
title: 제품 명세
kind: spec
last_verified: 2026-11-10
---

# 제품 명세

요구사항 번호(R1~R7)와 저장·상태·흐름 계약의 소유자다. 구현 상태와 우선순위는 [gap-analysis.md](gap-analysis.md)가 소유한다.

## 1. 제품 목표

각 사용자가 GitHub로 로그인하고 자신의 Notion 문서를 개인 칸반에서 관리한 뒤,
승인한 문서를 자신의 GitHub Pages 블로그에 게시한다.

여기서 “다중 사용자”는 여러 사용자가 하나의 팀 공간을 공유한다는 뜻이 아니다.
각 GitHub 사용자가 자신의 브라우저에서 완전히 독립된 칸반을 갖는다는 뜻이다.

## 2. MVP 범위

- R1 GitHub OAuth 로그인
- R2 하나 이상의 Notion 워크스페이스 OAuth 연결
- R3 허용된 페이지와 하위 페이지 탐색
- R4 영속 `보관 중`과 화면 수명 `게시 중 → 게시 완료` 칸반 표시
- R5 로그인 사용자의 공개 `<GitHub login>.github.io` repository 확인
- R6 게시 준비 문서를 Astro 콘텐츠로 변환해 repository에 commit
- R7 GitHub Actions와 Pages 배포 상태 표시

공동 칸반, 팀 권한, 서버 동기화, 예약 게시, 서버 재시도, 결제, 관리자 콘솔은
MVP 범위가 아니다.

## 3. 식별자와 저장 계약

### GitHub 사용자

- GitHub의 불변 numeric user ID가 로컬 데이터 namespace의 기준이다.
- GitHub login은 표시용이며 namespace key로 사용하지 않는다.
- 서버는 사용자 계정 행이나 세션 행을 저장하지 않는다.

### 서버 쿠키

- GitHub 세션 쿠키: 사용자 ID, login, GitHub credential, 만료 시각
- Notion 연결 쿠키: 연결 ID, workspace 표시 정보, Notion credential
- 모든 payload는 서버만 해독 가능한 AEAD envelope로 보호한다.
- 쿠키는 `HttpOnly`, `Secure`(production), `SameSite=Lax`, 제한된 `Path`를 사용한다.
- Notion 연결은 쿠키 예산 내 명시적 개수 상한을 둔다.

### 브라우저 IndexedDB

칸반과 사용자 설정만 저장한다.

```text
BoardRecord
  ownerGitHubUserId: GitHub numeric ID string
  connectionId: Notion connection UUID
  providerPageId: Notion page ID
  pageRole: document | container
  pageRoleOverride: null | document | container
  hasNavigableChildren: boolean | null
  structureSourceLastEditedAt: ISO 8601 string | null
  title: non-empty string
  column: stored
  position: non-negative finite number
  updatedAt: ISO 8601 string
  sourceLastEditedAt: ISO 8601 string
  isVisible: boolean
  visibilityOverride: null | shown | hidden
```

token, OAuth state, 쿠키 원문은 IndexedDB나 localStorage에 저장하지 않는다.

칸반 데이터베이스 이름은 `notion-kanban-blog.board.<GitHub numeric ID>` 형식으로
사용자별 분리한다. record에도 동일한 owner ID를 저장해 이중으로 검증한다.
현재 Dexie schema version은 12이며 compound primary key는
`[ownerGitHubUserId+connectionId+providerPageId]`다. 모든 read 전에 strict schema를
통과하지 못하거나 owner가 다른 record를 삭제한다. version 11 이하 데이터베이스는
migration하지 않고 열 때 비운다. 칸반은 다음 Notion 동기화로 다시 채워지며 이때
이전 표시·숨김 선택은 사라진다(2026-11-10 사용자 결정).
알 수 없는 필드는 거절하므로 credential 성격의 필드는 저장될 수 없다.
최상위 page는 기본 표시하고 하위 page와 data source 행 page는 기본 숨김이다.
`visibilityOverride`가 `shown` 또는 `hidden`이면 사용자의 선택이 기본값보다 우선한다.
`isVisible=false`인 문서는 Notion 계층 목록에는 남아 있지만 칸반에서는 숨긴다.
`pageRole`은 자동 구조 판별과 `pageRoleOverride`를 합성한 유효 역할이다.
`pageRoleOverride=null`이면 탐색 가능한 하위 구조가 있는 page는 `container`, 없으면
`document`가 된다. `pageRoleOverride`는 version 12 데이터에 남은 이전 수동 설정을
읽기 위해서만 유지하며 사용자가 변경하는 UI와 API는 제공하지 않는다.
`pageRole=container`인 page는 `Legacy`처럼 탐색 계층만 구성하며 칸반에 표시하거나
게시 대상으로 사용할 수 없다. 컨테이너 전환은 column, position,
`visibilityOverride`를 지우지 않는다. 다시 `document`가 되면 명시적 표시 선택 또는
현재 계층의 기본 표시 규칙을 적용해 기존 칸반 상태를 복원한다.
게시 상태와 결과는 IndexedDB에 쓰지 않는다.

## 4. 상태 흐름

```text
IndexedDB: stored
화면 메모리: stored → publishing → published
                         └ 실패 ──→ stored
```

- IndexedDB에는 모든 문서를 `stored`로만 저장하고 표시 여부·정렬·구조 검사 결과만
  유지한다.
- `publishing`과 `published`는 React 메모리에서만 합성하는 화면 상태다.
- 게시 성공 시 record의 column이나 게시 결과를 저장하지 않고 `isVisible=false`로
  전환한다. 현재 화면은 메모리에 남은 card snapshot을 `published`로 계속 보여주지만,
  새로고침·탭 종료·컴포넌트 재마운트 후에는 완료 링크와 함께 칸반에서 사라진다.
- 완료 카드를 현재 화면에서 `stored`로 되돌리면 `isVisible=true`로 복구해 이후
  새로고침에서도 다시 보관 카드로 표시한다.
- `stored` 카드를 같은 column 안에서 드래그하면 보관 순서를 바꾸고 `publishing`
  column에 놓으면 게시를 시작한다. `published` 카드를 `publishing`에 놓으면 다시
  게시하고 `stored`에 놓으면 현재 완료 표시를 닫는다.
- 별도 게시 버튼과 상태 선택기는 제공하지 않는다. `publishing` 카드는 배포가 끝날
  때까지 이동할 수 없다.
- 모든 카드의 `×`는 Notion 원문이나 IndexedDB record를 삭제하지 않고
  `isVisible=false`로 바꿔 칸반에서 숨긴다. 계층 목록에서 다시 표시할 수 있다.
- `published` 카드에서는 게시된 글 열기를 제공한다.
- 게시 실패는 오류를 표시한 뒤 화면 상태를 `stored`로 되돌린다.
- 동일 문서를 다시 게시하면 콘텐츠가 같아도 새 commit과 Actions 실행을 만든다.

## 5. 주요 흐름

### 로그인

서버가 GitHub OAuth `state`를 발급하고 callback에서 검증한 뒤 code를 교환한다.
GitHub 사용자 정보를 조회해 암호화 세션 쿠키를 설정한다.
Vercel deployment URL처럼 요청 origin이 `APP_ORIGIN`과 다르면 state를 만들기 전에
동일한 로그인 시작 경로를 `APP_ORIGIN`으로 redirect한다. 따라서 state와 session cookie,
GitHub callback은 항상 등록된 canonical origin 하나에만 존재한다.

- 시작: `GET /auth/github/start?returnTo=/`
- callback: `GET /auth/github/callback`
- 현재 사용자: `GET /api/me`
- 로그아웃: `POST /auth/logout`
- OAuth scope: `read:user public_repo workflow`
- state 만료: 10분, 세션 만료: 7일

`/api/me`는 IndexedDB namespace에 사용할 GitHub numeric ID를 문자열로 반환하지만
credential은 반환하지 않는다. 로그아웃은 동일 origin `Origin`만 허용한다.

### Notion 연결과 탐색

로그인된 사용자가 Notion OAuth를 시작한다. callback 결과는 암호화된 연결 쿠키에
추가한다. 페이지 API는 해당 쿠키의 token으로 사용자가 integration에 공유한
페이지만 읽어 반환한다.

- 시작: `GET /auth/notion/start?returnTo=/`
- callback: `GET /auth/notion/callback`
- 연결 목록: `GET /api/notion/connections`
- 페이지 트리: `GET /api/notion/connections/:connectionId/pages`
- 페이지 내부 구조: `GET /api/notion/connections/:connectionId/pages/:pageId/outline`
- 연결 해제: `POST /api/notion/connections/disconnect`
- 연결 쿠키 수명: 30일
- 브라우저 전체 최대 연결: 3개
- 암호화된 cookie value 최대 크기: 3,800 bytes

각 연결에는 소유 GitHub numeric ID가 포함되며 목록과 해제 요청은 현재 세션의
소유 연결만 다룬다. API 응답에는 Notion credential을 포함하지 않는다.

페이지 트리 API는 현재 연결로 검색 가능한 page metadata를 Notion pagination이
끝날 때까지 조회한다. 본문 block은 최초 목록 단계에서 조회하지 않는다. 응답은
page 검색과 data source 검색을 결합해 `page_id` 부모뿐 아니라 data source의
`database_parent`도 실제 상위 page로 해석한다. 응답은 `providerPageId`,
`parentPageId`, data source database ID, 제목, 아이콘 URL, 수정 시각, 하위 문서
여부만 포함한다. 접근 가능한 부모가 없는 직접 공유 page는 root로 승격한다.
단, `block_id` 부모를 가진 page는 toggle 등 페이지 내부 block의 자식이므로 root로
승격하지 않는다. 이 page는 최초 목록과 칸반에서 숨기고 해당 block outline을 펼쳤을
때만 렌더링한다.

UI는 최상위 page만 먼저 보이고 화면에 나타난 page의 내부 구조를 백그라운드에서
조회한다. 페이지 내부 구조 API는 Notion Block Children API를 pagination하며
재귀 호출한다. 게시 본문 전체를 브라우저에 전달하지 않고 실제 page/database로
이어지는 탐색용 outline만 반환한다.

outline은 일반 toggle과 toggle heading을 `toggle`로, 제목이 있는 callout/list/tab
label/paragraph/quote/to-do 같은 자식 보유 block을 `group`으로, column·column_list와
원본 synced block 같은 시각적 wrapper를 투명하게 순회한다. duplicate synced block은
원본 block을 따라가며 순환 참조는 중단한다. `child_page`, `child_database`,
`link_to_page`의 page/database 참조는 provider ID를 별도로 반환한다. page/database
후손이 없는 toggle/group은 결과에서 제거하므로 설명용 toggle만 있는 일반 문서는
컨테이너 후보가 되지 않는다.

data source 행은 해당 child database 아래에 배치하고, outline에서 확인되지 않는 접근
가능 하위 page만 안전한 fallback으로 상위 page 바로 아래에 표시한다. Notion 권한
철회와 rate limit은 각각 명시적인 `403`, `429` 응답으로 전달한다.

### 칸반

클라이언트는 `/api/me`에서 받은 GitHub 사용자 ID를 기준으로 IndexedDB를 연다.
Notion 페이지 식별자와 칸반 상태를 저장하며 다른 사용자 namespace를 절대 합치지 않는다.
Notion 연결 또는 새로고침으로 발견한 모든 page metadata는 최초 상태 `stored`와
안정적인 position으로 자동 동기화한다. 최상위 page만 `isVisible=true`, 하위 page는
`isVisible=false`로 시작한다. 같은 페이지를 다시 가져오면 기존 column, position과
사용자의 표시 override를 보존하고 원본 제목과 수정 시각만 갱신한다.
사용자는 계층 목록에서 각 page의 `칸반 표시/숨김`을 바꿀 수 있다. 숨김은 원본이나
칸반 record를 삭제하지 않으며 다시 표시했을 때 기존 상태를 복원한다.
page 역할은 구조 검사 결과로 자동 결정한다. 탐색 가능한 하위 outline이 있으면
컨테이너, 없으면 문서다. 컨테이너는 문서 아이콘과 칸반 표시 버튼 대신 탐색용 toggle로
렌더링되며, 하위 outline을 여는 기능만 제공한다. 일반 화면에는 `컨테이너로 사용`과
`문서로 사용` 버튼이나 역할 고급 설정을 노출하지 않는다.

아직 하위 구조가 확인되지 않은 page는 백그라운드에서 outline을 자동 조회한다.
화면에 렌더링된 page만 동시 3개 이하로 검사하고, 중첩 page는 상위 계층을 펼쳐 화면에
나타날 때 검사한다. outline에 탐색 가능한 `toggle`, `child_page`, `child_database`가
하나라도 있거나 page metadata에서 직접 하위 page가 확인되면 자동으로 컨테이너가 된다.
outline이 비어 있으면 일반 문서로 유지한다.

검사 결과는 `hasNavigableChildren`과 검사 당시 Notion `lastEditedAt`인
`structureSourceLastEditedAt`으로 IndexedDB에 캐시한다. 현재 `sourceLastEditedAt`과
일치할 때만 캐시를 사용하고 Notion 수정 시각이 바뀌면 자동으로 무효화한다. 실패한
검사는 캐시하지 않으며 다음 화면 진입 때 자동 재시도한다.

page 역할 판별이 끝나기 전에는 개별 액션을 노출하지 않고 단일 `판별 중` 상태만
표시한다. 실패하면 `구조 다시 확인` 액션 하나만 표시한다. 유효한 outline cache로
자동 역할까지 저장된 뒤에만 문서의 칸반 표시 토글(화면 문구 `추가`·`칸반`, 접근 가능한 이름
`칸반에서 표시하기`·`숨기기`)을 렌더링한다. 게시 전 프리뷰는 칸반 카드에서만 연다. 컨테이너에는
역할이나 칸반 관련 액션을 렌더링하지 않는다.

칸반은 dnd-kit의 pointer/keyboard sensor를 제공한다. `stored` 내부 이동은 IndexedDB
단일 transaction에서 position 재정렬을 반영한다. `publishing` column으로 drop한
동작은 영속 column 변경이 아니라 게시 요청을 시작하는 UI 명령으로 해석한다.
새로고침하면 현재 GitHub user namespace에서 `isVisible=true`인 record만 다시 읽어
화면을 복구한다. 게시 성공으로 숨겨진 record는 Notion 계층 목록에서 사용자가 다시
표시할 수 있다.

### 게시

서버는 게시 요청마다 다음을 수행한다.

1. GitHub 세션 쿠키 검증
2. Notion 연결 및 페이지 접근 재검증
3. OAuth credential scope와 `<login>.github.io` repository 소유권·쓰기 권한 재검증
4. 최신 Notion 콘텐츠 조회 및 안전한 변환
5. 안전한 artifact와 진단용 콘텐츠 hash 생성 후 매 요청 GitHub commit 생성
6. commit SHA와 Actions/Pages 조회 정보 반환

브라우저는 GitHub 상태를 polling한다. 서버는 job이나 결과를 저장하지 않는다.

- 게시 요청: `POST /api/publish`
  - body: `{ connectionId, providerPageId }`
  - response: `{ commitSha, contentHash, created, pageUrl }`
- 상태 조회: `GET /api/publish/status?commitSha=<SHA>`
  - response: `{ commitSha, state, actionsUrl, pageUrl }`
  - state: `queued | in_progress | succeeded | failed`
- 게시 전 프리뷰: `POST /api/publish/preview`
  - body: `{ connectionId, providerPageId }` 외 필드 거절
  - response: `previewSchemaVersion: 1`, `templateVersion: 2`, 최신 원문 수정 시각,
    metadata와 제한된 block union, warning만 포함하는 strict DTO
  - `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`

게시 및 상태 조회 endpoint는 GitHub 세션과 고정 Pages repository 권한을 다시 확인한다.
게시 요청은 소유한 Notion connection을 다시 찾고 page retrieve와 block children
조회가 현재 credential로 모두 성공해야 진행한다. 브라우저가 제목, Markdown, slug,
repository 또는 commit SHA 외의 provider 결과를 대신 전달하지 않는다.

프리뷰 POST는 동일 origin, GitHub 세션, 현재 사용자가 소유한 Notion connection을
검증한 뒤 현재 credential로 page와 모든 block을 매 요청 다시 읽는다. 공유
`buildPublishDocument` 결과를 raw HTML이나 Markdown이 없는 client DTO로 투영하며
GitHub adapter, repository readiness, commit API를 호출하지 않는다. rich text 링크는
`http:`, `https:`, `mailto:`만 남기고 image URL은 provider 종류와 관계없이 DTO에서
제거해 placeholder와 warning으로 전달한다. 원시 Notion property, credential, cookie,
repository 정보는 응답하지 않는다. 프리뷰를 닫거나 새로고침하면 결과를 버리며
IndexedDB v12 record와 게시 중·완료 상태를 변경하지 않는다. 실제 게시 요청은 프리뷰
DTO를 재사용하지 않고 최신 Notion 원문과 GitHub 권한을 다시 검증한다.

rollout 통합 검증은 preview와 publish를 서로 독립된 요청으로 실행한다. mutable fake
provider의 원문 category, tag, 본문과 수정 시각을 preview 뒤 변경했을 때 publish artifact는
preview snapshot이 아니라 두 번째 Notion 조회 결과만 포함해야 한다. preview 뒤 Notion
접근 또는 GitHub 쓰기 권한이 철회되면 Markdown 생성·readiness·commit 전에 실패해야 한다.
통합 suite는 실제 publisher를 사용해 strict v2 frontmatter, category slug, 로컬 image
artifact와 template v2 marker가 한 commit artifact 집합에 연결되는지도 검증한다.

실제 provider smoke는 일반 test suite와 분리한 명시적 read-only release gate다. 로컬의
`.env.smoke.local`에 별도 테스트용 Notion page와 GitHub credential/identity를 넣고 최신
Notion page·block pagination, 이미지 다운로드/로컬 변환, GitHub OAuth scope·고정 Pages
repository 소유권·readiness를 조회한다. smoke는 preview와 artifact를 메모리에서만 만들며
commit, ref update, Pages mutation은 호출하지 않는다. credential, provider URL과 원문은
출력하지 않고 성공한 단계 이름과 artifact 개수만 보고한다.

게시의 image block은 provider capability URL을 Markdown이나 GitHub artifact에 직접
기록하지 않는다. `apps/web`은 게시 요청 안에서만 각 HTTPS URL을 내려받아 허용된
`image/jpeg`, `image/png`, `image/gif`, `image/webp`인지 확인하고
`src/assets/blog/<post-slug>/image-<순번>.<확장자>` artifact로 만든다. Markdown에는
해당 content file에서 자산으로 향하는 검증된 상대 경로만 기록한다. 이미지 URL은
프리뷰 응답, 오류 응답, commit message, content hash 입력의 path/text와 로그에 남기지
않는다.

이미지 fetch는 URL credential과 fragment를 거절하고 HTTPS만 허용한다. 최초 요청과
모든 redirect hop은 DNS를 다시 검증해 loopback, private, link-local, multicast,
documentation/reserved 주소를 차단하며, 검증한 public IP를 실제 TLS 연결에 고정한다.
redirect는 최대 3회, 이미지당 timeout은 10초, 이미지당 최대 8 MiB, 문서 전체 최대
32 MiB, 문서당 최대 20개다. `Content-Type`과 파일 signature, `Content-Length`와 실제
stream byte를 모두 검사하고
허용하지 않는 MIME, 누락된 MIME, redirect downgrade/loop/초과, DNS/IP 오류와 timeout은
commit 전에 `422 invalid_publish_image`로 실패한다. SVG와 MIME sniff fallback은
허용하지 않는다.

`packages/publisher`는 GitHub owner와 repository 이름을 검증한 뒤 결정적인 Astro
template manifest를 생성한다. manifest에는 정렬된 repository 상대 경로와 byte
content, `siteUrl`, `basePath`, template version이 포함된다. user site인
`<owner>.github.io`는 `/`, project site는 `/<repository>`를 base로 사용한다.
template은 Astro content collection, 공통 header/main/footer와 skip link, 홈 최신 글,
전체 글, category index/detail, 기존 permalink의 글 상세, 404 정적 route와 GitHub Pages
workflow를 포함하며 절대 경로와 `..` 경로를 허용하지 않는다. 내부 링크는 모두
user/project site의 base path를 반영하며 핵심 탐색은 client JavaScript 없이 동작한다.
블로그 shell은 GitHub owner를 개인 브랜드로 사용하고 홈·전체 글·주제·GitHub의 네 가지
탐색만 제공한다. 홈은 블로그 소개, 전체 글·주제 수, 최신 글을 우선순위대로 보여준다.
글 상세는 45rem 읽기 폭을 유지하며 목차가 있는 글은 mobile에서 본문 앞에, 넓은 화면에서
본문 옆 sticky 탐색으로 배치한다. 외부 font나 client JavaScript 없이 320px, keyboard,
reduced-motion과 고대비 환경에서도 핵심 탐색과 읽기가 가능해야 한다.
로컬 image artifact는 Astro passthrough image service로 원본 byte를 유지한 채 build
asset으로 복사해 Sharp나 추가 native dependency를 요구하지 않는다.
생성 repository에는
lockfile을 포함하지 않으므로 workflow는 Node와 pnpm 버전을 명시하고 dependency
cache를 끈 뒤 `pnpm install --no-frozen-lockfile`로 설치한다. pnpm의 dependency
build 차단은 유지하되 Astro 빌드에 필요한 `esbuild`만 `pnpm-workspace.yaml`의
`allowBuilds`로 허용한다. 빌드된 `dist`는 Pages artifact로 업로드한 뒤 별도 deploy
job에서 배포한다.

게시 변환 경계는 provider 응답을 그대로 Markdown에 삽입하지 않는다. 서버
orchestration이 최신 Notion page를 조회한 뒤 제목, 설명, 게시/수정 시각과 아래의
정규화된 block만 `packages/publisher`에 전달한다.

블로그 metadata는 최신 page retrieve 응답의 예약 속성만 사용한다. 속성 이름은
대소문자를 포함해 정확히 일치하며 alias나 브라우저 입력은 허용하지 않는다.

| 예약 속성 | Notion 타입 | 게시 값 | 누락 시 fallback |
|---|---|---|---|
| `Blog Category` | `select` | category name | `미분류` |
| `Blog Tags` | `multi_select` | 중복 제거한 최대 10개 tag | `[]` |
| `Blog Description` | `rich_text` | annotation을 제거한 plain text | 첫 paragraph/quote/heading, 없으면 title |
| `Blog Published At` | `date` | range start | Notion `created_time` |

category는 trim 후 1~80자, tag는 각각 1~40자, description은 0~1,000자다.
속성이 존재하지만 타입, 값, 개수 또는 날짜가 계약에 맞지 않으면 fallback하지 않고
`422 invalid_blog_metadata`로 실패한다. Notion adapter는 이 네 속성만 제한된
`rich_text | select | multi_select | date | unsupported` union으로 정규화하며 원시
property, formula, relation, people, file 등의 값을 반환하지 않는다.
제목은 trim 후 1~2,000자여야 하며 Notion의 fallback인 `제목 없음`은 게시하지 않는다.

```text
NotionPageProperty
  { kind: rich_text, plainText }
  { kind: select, name }
  { kind: multi_select, names }
  { kind: date, start }
  { kind: unsupported, providerType }
```

category route slug는 category display name을 `NFKC`, trim, 연속 공백 축약,
lowercase한 값에서 ASCII 영숫자 base를 만들고 정규화 원문의 SHA-256 앞 8자를 붙인다.
ASCII base가 없으면 `category-<hash8>`을 사용하며 `미분류`는 `uncategorized`로 고정한다.
post slug는 기존 title과 Notion page ID 조합을 유지해 category 변경으로 URL이 바뀌지 않는다.

```text
PublishDocument
  schemaVersion: 2
  slug, title, description, publishedAt, updatedAt
  category: { name, slug }
  tags: string[]
  blocks:
    paragraph | heading | quote | code | image | toggle | divider
    listItem | toDo | callout | table | equation | linkCard | media
    image: { caption, assetPath }
    listItem: { style: bulleted | numbered, richText, children }
    toDo: { checked, richText, children }
    callout: { richText, children }
    table: { hasColumnHeader, hasRowHeader, rows: richText[][] }
    equation: { expression }
    linkCard: { caption, url }
    media: { mediaType: audio | file | pdf | video, caption, url? }
  richText:
    text, href?, bold?, italic?, strikethrough?, code?
```

`apps/web/lib/publish`의 공유 `buildPublishDocument`만 metadata fallback, category slug,
tag 정규화, post slug와 block level 변환을 조립한다. publish와 이후 preview는 이 함수를
사용하며 request body는 계속 `{ connectionId, providerPageId }`만 받는다. Astro template
v2는 content frontmatter를 다음 순서로 해석한다.

- `schemaVersion`이 없으면 v1으로 간주하고 `category=미분류`,
  `categorySlug=uncategorized`, `tags=[]`를 주입한다.
- `schemaVersion: 2`는 category, categorySlug와 tags를 필수로 strict 검증한다.
- 알 수 없는 schema version과 v2의 누락·추가 field는 build를 실패시킨다.

template v2 marker와 v1/v2 compatibility reader를 먼저 배포하고 user/project base path의
mixed collection build를 통과시킨 뒤에만 Markdown writer가 v2 frontmatter 출력을
활성화한다. 기존 `src/content/blog/<slug>.md`와 `/posts/<slug>/` 경로는 변경하지 않으며
v1 글을 일괄 rewrite하지 않는다. 기존 글은 다시 게시될 때 같은 경로에서 v2로 승격된다.

publisher는 `src/content/blog/<slug>.md`와 게시 orchestration이 내려받은 로컬 image
artifact를 생성한다. slug는 소문자 영숫자와
단일 `-` 구분만 허용해 절대 경로와 `..` 경로를 차단한다. 사용자 text의 HTML과
Markdown 제어 문자를 escape하고, 링크는 `https:`, `http:`, `mailto:`만 허용한다.
이미지는 `src/assets/blog/<slug>/image-<순번>.<확장자>`에서 현재 Markdown 기준
`../../assets/blog/<slug>/...`로 향하는 정규화된 상대 경로만 허용한다. 허용하지 않는
링크는 일반 text로 낮추고 provider URL 또는 경로 이탈 이미지는 변환 실패로 처리한다.
code fence 길이는 본문보다 길게 생성하고 language 식별자를
제한한다. toggle의 `<details>` wrapper만 publisher가 생성한 신뢰 HTML로 허용하며
summary와 자식 내용은 동일한 escape 규칙을 적용한다.

Notion 본문의 의미 구조는 일반 문단으로 평탄화하지 않는다. 글머리·번호 목록과
할 일은 중첩 자식을 유지하고, callout은 본문과 자식을 하나의 강조 영역으로,
table은 행·열 header 설정과 cell rich text를 보존한다. publisher가 생성하는 table과
callout HTML만 제한적으로 허용하며 모든 사용자 text, link와 cell content는 HTML 및
URL allowlist escape를 거친다. 프리뷰 DTO와 최종 Astro HTML은 동일한 block union을
렌더링해 게시 전 화면과 실제 결과의 구조적 차이를 막는다.
수식은 누락하지 않고 읽을 수 있는 수식 영역으로 보존한다. bookmark·embed·link preview는
허용된 HTTP(S) 링크 카드로 렌더링한다. audio·file·PDF·video의 외부 URL도 링크 카드로
내보내되, 만료되는 Notion file capability URL은 노출하지 않고 URL 없는 첨부 카드로 낮춘다.

글 전체 제목은 `h1` 하나로 유지하고 Notion heading 1·2·3은 최종 문서에서 각각
`h2`·`h3`·`h4` 의미 구조로 내린다. 의미 태그가 프리뷰 dialog 안에서 `h4`·`h5`·`h6`로
더 내려가더라도 시각 크기는 별도 Notion heading level class로 결정한다. 프리뷰와 최종
Astro HTML 모두 세 단계가 본문보다 크고 `heading 1 > heading 2 > heading 3 > 본문` 순서를
유지해야 하며, 브라우저 user-agent heading 기본값에 의존하지 않는다.

slug는 정규화한 Notion 제목과 page ID의 앞 12자리 hex를 조합해 같은 제목과 한글
제목에서도 안정적이고 충돌 없이 생성한다. template artifact와 문서 artifact를
경로순으로 정렬하고 각 경로와 byte content를 SHA-256에 넣어 content hash를 만든다.

GitHub 반영은 기본 branch의 현재 commit/tree를 읽고 artifact별 blob과 base tree를
기준으로 새 tree를 만든다. 새 tree가 현재 tree와 같아도 게시 요청마다 parent가 있는
새 commit을 생성한 뒤 non-force ref update를 수행한다. 따라서 동일 문서의 반복 게시와
응답 유실 후 재시도는 중복 commit을 만들 수 있으며 이는 허용된 동작이다. 동시 변경은
강제 덮어쓰기 대신 충돌로 실패한다.
막 생성한 빈 repository처럼 기본 branch ref가 아직 없으면 base tree와 parent 없는
최초 commit을 만든 뒤 기본 branch ref를 생성한다.

상태 조회는 현재 화면 메모리에 있는 commit SHA로 deploy workflow run과 Pages
deployment를 조회한다.
Pages 성공을 최우선으로 하고, Actions 실패 conclusion은 `failed`, 진행 상태는
`queued` 또는 `in_progress`로 반환한다. workflow가 아직 생성되지 않은 짧은 구간은
`queued`로 간주한다. 새로고침 이후에는 이전 실행을 복구하거나 polling하지 않는다.

### GitHub Pages repository

별도 GitHub App과 installation은 사용하지 않는다. 로그인 OAuth에서 공개 repository
쓰기 범위인 `public_repo`와 배포 workflow 파일을 생성·수정하기 위한 `workflow`를
요청하고, 암호화 세션 쿠키의 OAuth credential로 GitHub REST API를 호출한다.

- repository 확인: `GET /api/github/pages-repository`
- 고정 대상: 현재 로그인 사용자의 `<GitHub login>.github.io`
- repository 조건: 개인 계정 소유, public, 현재 사용자에게 push 권한이 있음
- 게시 반영: GitHub Contents/Git Data API로 생성된 정적 파일을 직접 commit

repository 확인 응답은 기본 branch와 함께 다음 readiness를 반환한다.

```text
GitHubPagesReadiness
  state: ready | pages_setup_required | repository_not_managed
  pagesSettingsUrl: GitHub repository Pages settings URL
  managedPaths: 이번 게시가 생성·갱신할 repository 상대 경로 목록
  conflictingPaths: 보호 때문에 게시를 차단한 기존 경로 목록
```

- `ready`: 빈 repository, 앱 marker가 있는 repository, 또는 앱이 생성한 v1 경로와
  `src/content/blog/*.md`만 가진 legacy repository이며 Pages source가 GitHub Actions다.
- `pages_setup_required`: repository는 게시 가능한 구조지만 Pages가 아직 없거나 source가
  GitHub Actions가 아니다. 앱은 commit 전에 중단하고 Settings의 Pages 화면을 안내한다.
- `repository_not_managed`: 비어 있지 않고 앱 marker/legacy 경로 규칙을 만족하지 않는다.
  기존 파일을 보호하기 위해 게시를 중단하고 충돌 경로를 표시한다.

publisher는 `.notion-kanban-blog/managed.json` marker를 결정적으로 생성한다. marker에는
publisher와 template version만 두며 token, 사용자 ID, repository ID를 넣지 않는다.
legacy repository는 다음 성공 게시에서 marker를 함께 받아 이후 앱 관리 repository가 된다.
현재 template version은 2이며 marker가 없는 repository는 v1 legacy로 취급한다.
workflow의 push branch는 고정 `main`이 아니라 검증된 repository `defaultBranch`를 사용한다.
게시 orchestration은 Notion 원문을 commit하기 직전에 readiness를 다시 확인하며 브라우저가
전달한 readiness나 경로 목록을 신뢰하지 않는다.

브라우저가 repository 이름이나 소유자를 선택하지 않는다. 서버는 매 확인·게시 요청마다
OAuth token의 `public_repo` 또는 상위 `repo` scope와 `workflow` scope, repository
owner numeric ID, 정확한 repository 이름, public 여부와 push 권한을 다시 확인한다.
OAuth credential은 HttpOnly 암호화 세션 쿠키 밖으로 전달하지 않는다.

상태 조회가 반환하는 `actionsUrl`은 현재 화면의 게시 중·실패·완료 카드에서 GitHub Actions
로그 링크로 제공한다. URL은 GitHub adapter가 검증한 `https://github.com/<owner>/<repo>/actions/`
하위 URL만 허용하며 IndexedDB에 저장하지 않는다. readiness와 provider 오류는 안정적인
오류 code로 구분해 repository 생성, OAuth 재동의, Pages 설정, 기존 파일 확인, Actions 로그
열기 중 가능한 복구 행동을 UI에 연결한다.

## 6. 명시적 제약

- 칸반은 브라우저별 데이터다. 다른 기기와 자동 동기화되지 않는다.
- 브라우저 데이터를 지우면 칸반이 사라지며 export/import는 제공하지 않는다.
- 쿠키를 지우면 GitHub 및 Notion을 다시 연결해야 한다.
- 쿠키 크기 때문에 연결 가능한 Notion 워크스페이스 수가 제한된다.
- 서버 측 감사 로그, 영구 배포 이력, 자동 재시도는 없다.
- 게시 중 브라우저가 닫혀도 GitHub workflow는 계속될 수 있지만 UI 상태는 다음 접속 때
  GitHub에서 다시 확인해야 한다.

이 제약이 제품 요구사항과 충돌하는 시점이 DB 도입 재검토 기준이다.

## 6.1 Provider 장애 복구 계약

- Notion과 GitHub의 OAuth 및 REST 요청은 각각 10초 안에 응답하지 않으면 중단한다.
- timeout은 provider별 안정적인 `notion_timeout` 또는 `github_timeout` 오류로 반환하며
  credential, 요청 URL, provider 응답 본문은 오류나 로그에 포함하지 않는다.
- `429`의 `Retry-After`는 0~3,600초 정수만 신뢰해 응답 header로 전달한다. 브라우저는
  남은 대기 시간을 안내하고 만료 전 재시도 동작을 비활성화한다.
- 서버는 읽기와 mutation을 자동 재시도하지 않는다. 사용자가 명시적으로 다시 시도하며,
  특히 commit 응답 유실 뒤 재시도는 허용된 중복 commit을 만들 수 있다.
- 구조화 운영 로그는 allowlist field만 JSON 한 줄로 기록한다. token, cookie, OAuth code,
  provider URL, 사용자·page·repository 식별자, 임의 오류 message/stack은 기록하지 않는다.

## 7. 현재 구현 차이

구현 상태와 남은 차이는 [gap-analysis.md](gap-analysis.md)가 소유한다.
