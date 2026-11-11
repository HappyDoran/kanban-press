---
title: 제품 명세
kind: spec
last_verified: 2026-11-11
---

# 제품 명세

요구사항 번호(R1~R7)와 저장·상태·흐름 계약의 소유자다. 구현 상태와 우선순위는 [gap-analysis.md](gap-analysis.md)가 소유한다.

## 1. 제품 목표

각 사용자가 GitHub로 로그인하고 자신의 Notion 문서를 개인 칸반에서 관리한 뒤,
승인한 문서를 자신의 GitHub Pages 블로그에 게시한다.

여기서 “다중 사용자”는 여러 사용자가 하나의 팀 공간을 공유한다는 뜻이 아니다.
각 GitHub 사용자가 완전히 독립된 칸반을 갖는다는 뜻이다. 칸반의 보관 중 목록과 게시 완료 여부는
그 사용자의 블로그 저장소에 있으므로 같은 계정이면 어느 브라우저에서나 같다.

## 2. MVP 범위

- R1 GitHub OAuth 로그인
- R2 하나 이상의 Notion 워크스페이스 OAuth 연결
- R3 허용된 페이지와 하위 페이지 탐색
- R4 직접 고른 문서(`보관 중`)·화면 수명 `게시 중`·블로그 저장소 기준 `게시 완료` 칸반 표시
- R5 로그인 사용자의 공개 `<GitHub login>.github.io` repository 확인
- R6 게시 준비 문서를 Astro 콘텐츠로 변환해 repository에 commit
- R7 GitHub Actions와 Pages 배포 상태 표시

공동 칸반, 팀 권한, 서버 동기화, 예약 게시, 서버 재시도, 결제, 관리자 콘솔은
MVP 범위가 아니다.

확장 범위(2026-11-10 사용자 선택. 계약은 §5.1, 진행 상태는 gap-analysis):

- R8 블로그 글 관리: 제목 변경 시 옛 글 정리, 블로그에서 내리기, 게시 완료 열 복원(구현 완료)
- R9 블로그 탐색·노출: 태그 목록, 연·월 보관함, RSS·sitemap·Open Graph(구현 완료)
- R10 블로그 순서·묶음: 고정 글, 시리즈와 시리즈 안 순서(구현 완료)
- R11 블로그 주소·사이트 설정: 글 주소 지정, 사이트 소개 설정(구현 완료)

## 3. 식별자와 저장 계약

### GitHub 사용자

- GitHub의 불변 numeric user ID로 사용자를 구분한다(쿠키 소유자, 화면의 사용자 전환 판별).
- GitHub login은 표시와 `<login>.github.io` 대상 결정에만 쓴다.
- 서버는 사용자 계정 행이나 세션 행을 저장하지 않는다.

### 서버 쿠키

- GitHub 세션 쿠키(`kp_session`): 사용자 ID, login, GitHub credential, 만료 시각
- Notion 연결 쿠키(`kp_notion_connections`): 연결 ID, workspace 표시 정보, Notion credential

프로젝트 이름 변경(2026-11-10, `notion-kanban-blog` → `kanban-press`) 전 데이터 호환:
쿠키는 새 이름이 없을 때 옛 이름(`nkb_session`, `nkb_notion_connections`)을 읽고 옛 AAD
(`notion-kanban-blog.cookie.v1.<keyId>`)로 봉인된 값도 연다. 새로 쓸 때는 새 이름·새 AAD만 쓰고, 로그아웃과
마지막 Notion 연결 해제는 옛 이름 쿠키도 지운다. 블로그 저장소의 옛 폴더 `.notion-kanban-blog/`는
관리 표식으로 인정하고, 다음 게시에서 옛 표식을 지우며, 사이트 설정은 새 파일이 없을 때 옛 파일을 읽고 저장할 때
새 위치로 옮긴다.
- 모든 payload는 서버만 해독 가능한 AEAD envelope로 보호한다.
- 쿠키는 `HttpOnly`, `Secure`(production), `SameSite=Lax`, 제한된 `Path`를 사용한다.
- Notion 연결은 쿠키 예산 내 명시적 개수 상한을 둔다.

### 칸반(블로그 저장소의 별도 branch)

보관 중 목록만 사용자 블로그 저장소의 `kanban-press-board` branch에 저장한다([ADR 0003](../adr/0003-board-branch.md)).
나머지 칸반 상태는 저장하지 않고 열 때마다 계산한다.

```text
kanban-press-board branch / board.json
  version: 1
  pageIds: 하이픈 뺀 Notion page ID(소문자 32자) 배열, 중복 없음, 최대 2,000개, 추가한 순서
```

- 제목·본문·연결 ID·credential은 저장하지 않는다. 연결 ID는 브라우저마다 달라 page ID만 쓴다.
- branch는 처음 추가할 때 서버가 `board.json` 하나만 있는 부모 없는 commit으로 만든다. 블로그 배포
  workflow는 기본 branch push에만 돌므로 이 branch의 commit은 배포를 만들지 않는다.
- 공개 저장소라 page ID 목록은 공개된다. ID만으로 Notion 내용을 읽을 수는 없다.
- 파일이 없거나 형식이 틀리면 빈 목록으로 본다.

```text
KanbanRecord (화면 메모리)
  connectionId: 선택한 Notion connection UUID
  providerPageId: Notion page ID
  title, sourceLastEditedAt: Notion page 목록 값
  column: stored | publishing | published
  publishedUrl, publishActionsUrl, publishStartedAt: 화면의 게시 상태 또는 블로그 글 주소
```

- 카드: 선택한 연결의 문서 page 중 보관 중 목록에 있거나, 블로그에 글이 있거나, 이번 화면에서 게시 중인 것.
  보관 중 열은 최근에 추가한 문서가 위에 온다.
- 역할: page 목록의 `hasChildren`(직접 하위 page, database 행, 토글 안 page 중 하나라도 있음)이 참이면
  `Legacy` 같은 컨테이너로 탐색 계층만 만들고 칸반·게시 대상이 아니다. 아니면 문서다.

token, OAuth state, 쿠키 원문은 IndexedDB나 localStorage에 저장하지 않는다. 브라우저 localStorage에는
문서 사이드바 너비만 둔다.

## 4. 상태 흐름

```text
보관 중 목록(블로그 저장소 branch): 고른 문서 page → stored
화면 메모리: stored → publishing → published
                         └ 실패 ──→ 원래 열
블로그 저장소: 글 파일이 있으면 published, 블로그에서 내리면 stored
```

- `stored`는 보관 중 목록에 있고 블로그 저장소에 글이 없는 문서 page다. 문서 목록의 `추가`로 넣고
  보관 중 카드의 `×`로 뺀다. 빼도 Notion 원문과 블로그 글은 그대로다.
- `publishing`은 React 메모리에서만 합성하는 화면 상태다.
- `published`는 사용자 블로그 저장소에 그 page ID 접미사의 글 파일이 있는지로 정한다(§5.1 R8).
  칸반을 열 때마다 `/api/publish/posts`로 GitHub에서 다시 읽고, 읽지 못하면 게시 완료 열을 비운다.
  게시에 성공하면 현재 화면에서 바로 `published`로 옮긴다.
- `stored`·`published` 카드를 `publishing` column에 놓으면 게시(다시 게시)를 시작한다. 같은 column 안
  이동은 없다. `published` 카드는 `stored`로 끌어 옮길 수 없고 `블로그에서 내리기`(확인 후 실행)로만
  `stored`로 돌아간다. 내린 문서가 보관 중 목록에 없으면 목록에 넣는다.
- 상태 선택기는 제공하지 않는다. 게시는 카드를 `publishing`에 놓아 시작한다. 예외로 600px 미만 화면에서는
  게시 중 열까지 멀리 끌기 어려워 `stored`·`published` 카드에 `게시`·`다시 게시` 버튼을 둔다(놓기와 같은 동작).
  `publishing` 카드는 배포가 끝날 때까지 이동할 수 없다.
- `stored` 열에는 제목 검색을 둔다.
- `published` 카드에서는 게시된 글 열기를 제공한다.
- 게시 실패는 오류를 표시한 뒤 화면 상태를 원래 열로 되돌린다.
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

`/api/me`는 화면의 사용자 전환 판별에 쓰는 GitHub numeric ID를 문자열로 반환하지만
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
`block_id` 부모를 가진 page(toggle 등 페이지 내부 block의 자식)는 서버가 block retrieve로 부모를
page가 나올 때까지 거슬러 올라가 소유 page를 `parentPageId`로 채우고, 소유 page의 하위 문서 여부를
참으로 만든다. 이 조회는 목록 한 번에 최대 50회이며, 상한을 넘거나 읽지 못한 block의 page는 root로
승격하지 않고 계층 목록에서 숨긴다(칸반에는 문서로 보인다). rate limit은 목록 전체의 `429`로 알린다.

UI는 최상위 page만 먼저 보이고 page를 펼칠 때만 내부 구조를 조회한다. 페이지 내부 구조 API는 Notion Block Children API를 pagination하며
재귀 호출한다. 게시 본문 전체를 브라우저에 전달하지 않고 실제 page/database로
이어지는 탐색용 outline만 반환한다.

outline은 일반 toggle과 toggle heading을 `toggle`로, 제목이 있는 callout/list/tab
label/paragraph/quote/to-do 같은 자식 보유 block을 `group`으로, column·column_list와
원본 synced block 같은 시각적 wrapper를 투명하게 순회한다. duplicate synced block은
원본 block을 따라가며 순환 참조는 중단한다. `child_page`, `child_database`,
`link_to_page`의 page/database 참조는 provider ID를 별도로 반환한다. page/database
후손이 없는 toggle/group은 결과에서 제거한다. outline은 탐색 표시에만 쓰고 역할 판별에는
쓰지 않는다.

data source 행은 해당 child database 아래에 배치하고, outline에서 확인되지 않는 접근
가능 하위 page만 안전한 fallback으로 상위 page 바로 아래에 표시한다. Notion 권한
철회와 rate limit은 각각 명시적인 `403`, `429` 응답으로 전달한다.

### 칸반

칸반은 선택한 Notion 연결의 page 목록, `/api/board`(보관 중 목록), `/api/publish/posts`로 그린다
(§3 칸반, §4). GitHub 사용자가 바뀌면 이전 사용자의 화면 상태를 버린다. 문서 목록(계층)의 문서 행에는
`추가`(보관 중에 넣기)와 `보관 중`(누르면 빼기) 토글 하나를 둔다. 블로그에 글이 있는 문서 행은 토글 대신
누를 수 없는 `게시됨`을 보인다(다시 게시·내리기는 칸반의 게시 완료 카드에서 한다). 컨테이너는 폴더 아이콘과 펼치기만
제공한다. 게시 전 프리뷰는 칸반 카드에서만 연다.

- 보관 중 목록: `GET /api/board` → `{ pageIds }`. branch나 파일이 없으면 빈 배열.
- 추가·빼기: `POST /api/board`(추가), `DELETE /api/board`(빼기), body `{ connectionId, providerPageId }` 외 필드 거절
  → 바뀐 `{ pageIds }`.

추가·빼기는 같은 origin, 세션, 요청한 Notion 연결 소유권, `<login>.github.io` 소유권·쓰기 권한을 다시
확인한 뒤 서버가 최신 `board.json`을 읽어 바꾸고 읽은 blob SHA로 조건부 저장한다. 그 사이 다른 브라우저가
바꿨으면 서버가 같은 요청 안에서 다시 읽어 3번까지 시도하고, 그래도 바뀌면 `409 github_conflict`로 실패해
화면은 그 문서만 원래대로 돌린다. 한 탭의 추가·빼기는 브라우저가 하나씩 보낸다. 이미 목록 상태가 요청과 같으면
commit하지 않는다.

칸반은 dnd-kit의 pointer/keyboard sensor를 제공한다. `publishing` column으로 drop한 동작은 영속 column
변경이 아니라 게시 요청을 시작하는 UI 명령으로 해석한다. 카드를 놓아도 화면은 보던 스크롤 위치를 지킨다
(옮긴 카드 위치로 스크롤하는 dnd-kit 드롭 애니메이션을 쓰지 않는다). 새로고침하면 Notion 목록과 블로그 저장소를 다시
읽어 같은 칸반을 그린다.

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
게시 중·완료 상태를 변경하지 않는다. 실제 게시 요청은 프리뷰
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
64 MiB, 문서당 최대 100개다. 이미지는 본문 순서를 지키며 4장씩 함께 받는다. GitHub commit 하나는 파일 400개·72 MiB까지
쓴다(template·Markdown·옛 파일 정리를 포함해 이미지 상한보다 넉넉하게). `Content-Type`과 파일 signature, `Content-Length`와 실제
stream byte를 모두 검사하고
허용하지 않는 MIME, 누락된 MIME, redirect downgrade/loop/초과, DNS/IP 오류와 timeout은
commit 전에 `422 invalid_publish_image`로 실패한다. SVG와 MIME sniff fallback은
허용하지 않는다. 요청 `Accept`는 받을 수 있는 PNG·JPEG·GIF·WebP만 적고, 검증한 주소 중 IPv4가 있으면
IPv4로 연결한다. `422 invalid_publish_image`와 `422 invalid_blog_metadata` 응답은 `{ error, detail }`이며
`detail`은 고정 거절 이유(`byte_limit`, `mime_type`, `network` 등)나 예약 속성 이름만 담는다. 화면은
`detail`로 어떤 이미지·속성을 고쳐야 하는지 안내한다.

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
본문 옆 sticky 탐색으로 배치한다. 제목 글꼴(Hahmlet)만 Google Fonts에서 받으며(결정 D5), 이 글꼴이나
client JavaScript 없이도 320px, keyboard, reduced-motion과 고대비 환경에서 핵심 탐색과 읽기가 가능해야 한다.
글 끝에는 “(끝)”과 판권(쓴 사람·초판·고침·분량·원고·찍은 곳)을 두고, 분량은 게시할 때 본문 글자 수로 센
200자 원고지 매수(`manuscriptPages`, 값이 없으면 생략)다.
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
| `Blog Pinned`·`Blog Series`·`Blog Order` | `checkbox`·`select`·`number` | §5.1 R10 | 고정 안 함·시리즈 없음·순서 없음 |
| `Blog Slug` | `rich_text` | 글 주소 앞부분(§5.1 R11) | 제목에서 만든 slug |

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
링크는 일반 text로 낮추고 provider URL 또는 경로 이탈 이미지는 변환 실패로 처리한다. 2,048자를 넘는
링크 주소는 글자만 남기고, 그런 bookmark·embed는 주소 글자만 담은 문단으로 바꾼다.
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

slug는 정규화한 Notion 제목과 하이픈을 뺀 page ID 32자리 hex를 조합해 같은 제목과 한글
제목에서도 안정적이고 충돌 없이 생성한다. Notion page ID는 앞부분이 워크스페이스와 생성 시점마다
거의 같아 일부만 쓰면 다른 글과 겹치므로 ID 전체를 쓴다. template artifact와 문서 artifact를
경로순으로 정렬하고 각 경로와 byte content를 SHA-256에 넣어 content hash를 만든다.

GitHub 반영은 기본 branch의 현재 commit/tree를 읽고 artifact별 blob과 base tree를
기준으로 새 tree를 만든다. 새 tree가 현재 tree와 같아도 게시 요청마다 parent가 있는
새 commit을 생성한 뒤 non-force ref update를 수행한다. 따라서 동일 문서의 반복 게시와
응답 유실 후 재시도는 중복 commit을 만들 수 있으며 이는 허용된 동작이다. 동시 변경은
강제 덮어쓰기 대신 충돌로 실패한다.
막 생성한 빈 repository처럼 기본 branch ref가 아직 없으면 base tree와 parent 없는
최초 commit을 만든 뒤 기본 branch ref를 생성한다.

상태 조회는 현재 화면 메모리에 있는 commit SHA로 deploy workflow run과 Pages
deployment를 조회한다. deploy workflow는 `concurrency`로 Pages 배포를 한 번에 하나만
실행하므로 연달아 게시하면 기다리던 중간 배포가 취소된다. 그래서 commit의 배포가
실패·취소됐어도 기본 branch의 최신 commit이 그 commit을 포함하면 최신 commit의 배포
상태를 그 글의 상태로 본다.
Pages 성공을 최우선으로 하고, Actions 실패 conclusion은 `failed`, 진행 상태는
`queued` 또는 `in_progress`로 반환한다. workflow가 아직 생성되지 않은 짧은 구간은
`queued`로 간주한다. 새로고침 이후에는 이전 실행을 복구하거나 polling하지 않는다.
한 탭에서 여러 글을 기다릴 때 클라이언트는 글마다 따로 조회하지 않고 이 탭이 마지막으로 만든
commit 하나만 10초에 최대 1번 조회한다. 이 탭의 commit은 하나씩 순서대로 쌓이므로 마지막 commit이
앞선 commit을 포함한다. 마지막 commit이 `failed`면 자기 commit을 한 번 더 조회해 그 결과를 쓴다.
따라서 함께 게시하는 글 수와 관계없이 상태 조회 GitHub API 사용량은 글 하나를 게시할 때와 같다.

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

publisher는 `.kanban-press/managed.json` marker를 결정적으로 생성한다. marker에는
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
하위 URL만 허용하며 저장하지 않는다. readiness와 provider 오류는 안정적인
오류 code로 구분해 repository 생성, OAuth 재동의, Pages 설정, 기존 파일 확인, Actions 로그
열기 중 가능한 복구 행동을 UI에 연결한다.

## 5.1 블로그 기능 확장 계약 (R8~R11)

2026-11-10 로컬 시뮬레이션(실제 게시 코드 → `HappyDoran.github.io` 임시 복사본 commit → Astro build)에서
올리기와 카테고리 이동은 동작했다. 아래는 그때 확인한 빈틈과 사용자가 고른 확장이다. 모두 DB 없이
저장소 파일, Notion 예약 속성, 요청마다의 권한 재검증만으로 만든다. 확정한 선택(D1~D4)은
[gap-analysis 미결 결정](gap-analysis.md#미결-결정) 표가 기록한다.

### R8 블로그 글 관리

- **옛 글 정리(결함 수정)**: 글 파일명은 `<제목 slug>-<page ID 32자>.md`라 제목을 바꿔 다시 게시하면
  옛 파일이 남아 같은 글이 둘이 됐다. 게시 commit은 같은 page ID 접미사를 가진 파일
  (`src/content/blog/*.md`, `src/assets/blog/<slug>/`, `public/posts/<slug>/index.html`) 중 이번에 쓰지 않는
  것을 지운다. 이미지가 줄어 남은 옛 이미지도 지워진다. 옛 slug에는 `public/posts/<옛 slug>/index.html`
  안내 page를 남긴다(D4: JavaScript 없이 상대 주소 `../<새 slug>/`로 이동, canonical은 새 글 절대 주소,
  `noindex`). 접미사가 없는 v1 글과 page ID 앞 12자를 접미사로 쓰던 옛 글은 어느 page의 것인지
  알 수 없으므로 건드리지 않는다.
- **블로그에서 내리기**(`POST /api/publish/unpublish`): `게시 완료` 카드에서 확인 dialog(D1)를 거쳐
  실행한다. 서버는 같은 origin, 세션, GitHub 저장소 소유권·쓰기 권한, 요청한 Notion 연결 소유권을 다시
  확인한 뒤 그 page ID 접미사의 글·이미지·옛 주소 안내 page만 지우는 commit 하나를 만든다. Notion 원문은
  읽지 않는다. 관리 표식이 없는 저장소는 `409 github_repository_not_managed`로 거절한다. Notion 원문은 지우지 않고 카드는
  `보관 중`으로 돌아간다. 지울 파일이 없으면 commit하지 않고 `404 blog_post_not_found`를 준다.
- **게시 완료 열 복원**(`GET /api/publish/posts`): 칸반을 열 때 저장소 tree의 `src/content/blog/*-<32자>.md`를
  읽어 접미사와 글 주소만 돌려주고, 접미사가 같은 카드를 `게시 완료`로 보여준다(§4). 이 값은 저장하지 않는다.
- **원문 수정 표시**: `/api/publish/posts`는 각 글 frontmatter의 `updatedAt`(게시 때 받은 Notion `last_edited_time`)도
  돌려준다. 칸반은 Notion page 목록의 수정 시각이 이 값보다 늦은 `게시 완료` 카드에 `원문 수정됨 · 다시 게시 필요`를
  표시한다. 두 값 모두 Notion이 준 분 단위 시각이라 오차 없이 비교하며, 게시 직후 같은 분 안의 수정은 구분하지 못한다.
  `updatedAt`을 읽지 못하면 표시하지 않고 게시 완료 열은 그대로 보여준다. 이번 화면에서 게시한 카드는 새로고침 전까지
  표시하지 않는다.
- 완료 조건: 제목 변경 재게시 후 글 파일이 하나뿐이다. 내리기 commit에 다른 글·template 파일 변경이
  없다. 다른 사용자 저장소나 남의 page ID 파일을 지울 수 없다. 새로고침 뒤에도 게시 완료 카드가 보인다.
  게시 뒤 Notion을 고치면 새로고침한 칸반의 그 카드에 원문 수정 표시가 붙고, 다시 게시하면 사라진다.

### R9 블로그 탐색·노출

- 태그: `/tags/`(태그와 글 수)와 `/tags/<태그 slug>/`. 글 카드·상세의 태그는 이 주소로 링크한다.
  태그 slug는 카테고리 slug와 같은 규칙(ASCII + hash)을 쓴다.
- 보관함: `/archive/`에 연·월별 글 목록.
- 노출: 정적 `rss.xml`(최근 20개, 제목·설명·링크·게시일·카테고리. 본문은 넣지 않는다, D2), `sitemap.xml`
  (홈·목록·카테고리·태그·보관함·글, 글은 수정일 `lastmod`), 모든 화면의 Open Graph(`og:type`은 글 상세만
  `article`)·description meta와 RSS `alternate` link. 생성 블로그에 새 npm 의존성을 추가하지 않고 Astro
  endpoint로 만든다. 보관함·태그·RSS는 footer에서, 보관함은 전체 글, 태그 전체는 주제 화면에서도 연결한다.
- 완료 조건: user/project base path build에서 모든 새 주소가 생성되고 링크가 base path를 따른다.
  JavaScript 없이 동작한다. RSS·sitemap이 XML 검증을 통과한다.

### R10 블로그 순서·묶음

순서는 칸반 드래그가 아니라 Notion 예약 속성으로 정한다(칸반 순서는 브라우저마다 달라 블로그의
기준이 될 수 없다).

| 예약 속성 | Notion 타입 | 의미 | 누락 시 |
|---|---|---|---|
| `Blog Pinned` | `checkbox` | 홈 최신 글 위 고정 | 고정 안 함 |
| `Blog Series` | `select` | 연재 묶음 이름 | 시리즈 없음 |
| `Blog Order` | `number` | 시리즈 안 순서(작을수록 앞) | 게시일 순 |

- 고정 글은 홈의 `고정 글` 절(최신 글 위)에 게시일 역순으로 보이고 최신 글 목록에서는 빠진다.
- 시리즈 이름이 비어 있으면 시리즈가 없는 글이다. 시리즈 slug는 카테고리 slug 규칙을 쓴다. 시리즈 안 순서는
  `Blog Order` 오름차순, 순서가 없으면 뒤로, 같으면 게시일이 이른 글이 앞이다. `Blog Order`는 시리즈가 있을 때만
  쓰고 절댓값 1,000,000 이하여야 한다.
- 시리즈 글 상세는 본문 위에 시리즈 목록(현재 글 `aria-current`, `n/전체`)을 두고, 이전·다음 글을 카테고리 대신
  시리즈 순서로 고른다. `/series/`와 `/series/<slug>/`를 만들고 sitemap과 footer에 넣는다.
- Markdown frontmatter에는 값이 있을 때만 `pinned`, `series`, `seriesSlug`, `seriesOrder`를 쓴다. 형식이 맞지
  않는 값은 §5 게시의 다른 예약 속성처럼 `422 invalid_blog_metadata`로 실패한다. 프리뷰 DTO도 같은 값을 갖고
  화면에 시리즈와 순서를 보여준다.
- 완료 조건: 속성이 없는 기존 글과 v1 글이 그대로 build된다. 고정·시리즈 fixture의 순서가 결정적이다.

### R11 블로그 주소·사이트 설정

- 글 주소: `Blog Slug`(`rich_text`, ASCII 소문자·숫자·`-` 1~80자)가 있으면 제목 대신 이 값을 쓴다.
  page ID 접미사는 유지해 R8 정리 규칙이 그대로 동작한다. 한글 제목은 현재 영문·숫자만 남아
  `11-333333333333` 같은 주소가 되므로 이 속성으로 읽기 좋은 주소를 줄 수 있다.
- `Blog Slug`가 비어 있으면 제목을 쓰고, 형식이 틀리면 `422 invalid_blog_metadata`다. 주소가 바뀐 옛 글은 R8
  정리 규칙대로 지우고 옛 주소 안내 page를 남긴다(D4).
- 사이트 설정(D3): 앱 상단 바의 게시 대상 상태를 펼친 곳의 `블로그 설정`에서 편집한다. `GET /api/blog/settings`는
  저장소의 `.kanban-press/site.json`을 읽어 주고(없거나 형식이 틀리면 기본값과 `stored: false`),
  `PUT /api/blog/settings`는 같은 origin·세션·저장소 소유권·쓰기 권한·관리 표식을 확인한 뒤 그 파일 하나만 commit한다.
  형식: 이름 1~40자, 소개 0~200자, 프로필 링크 최대 4개(이름 1~20자, `https` 주소). 게시 commit은 이 파일을 바꾸지 않는다.
- template은 빌드할 때 설정 파일을 읽어 사이트 이름(header·`<title>`·Open Graph·RSS), 홈 소개, 홈 프로필 링크에 쓴다.
  항목이 없거나 틀리면 그 항목만 기본값(`<login>.log`, 기본 소개, 링크 없음)을 쓰고 `https`가 아닌 링크는 버린다.
- 프리뷰는 설정 파일을 읽지 않고 기본 사이트 이름(`<login>.log`)으로 보여준다.
- 완료 조건: 주소를 바꿔 재게시하면 새 주소 하나만 남는다. 설정 파일이 없으면 지금 기본값으로 build된다.

## 6. 명시적 제약

- 보관 중 순서 바꾸기와 여러 연결을 합친 칸반은 없다. 칸반은 선택한 연결 하나의 문서를 보여 준다.
- 보관 중 목록을 바꿀 때마다 블로그 저장소의 `kanban-press-board` branch에 commit이 하나 생긴다.
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
- `429`의 `Retry-After`는 0~3,600초 정수만 신뢰해 응답 header로 전달한다. GitHub 시간당 한도를
  다 쓴 응답처럼 `Retry-After` 없이 `x-ratelimit-reset`만 오면 남은 초를 같은 범위로 잘라 쓴다. 브라우저는
  남은 대기 시간을 안내하고 만료 전 재시도 동작을 비활성화한다.
- 서버는 읽기와 mutation을 자동 재시도하지 않는다. 사용자가 명시적으로 다시 시도하며,
  특히 commit 응답 유실 뒤 재시도는 허용된 중복 commit을 만들 수 있다. 예외는 보관 중 목록의 SHA 조건부
  저장이 conflict로 거절된 경우다. 아무것도 쓰이지 않았으므로 같은 요청 안에서 다시 읽어 3번까지 시도한다.
- 게시 내용 거절(422)은 `publish_content_rejected` 이벤트로 `code`와 고정 `detail`만 남긴다.
- 분류하지 못한 게시·프리뷰 예외와 HTTP 실패가 아닌 provider 5xx(응답 형식·경계 검사)는 `unexpected_failure` 이벤트로 오류 이름과, 검사 오류면 실패한 필드
  경로(키·번호)만 남긴다. 값과 message는 남기지 않는다.
- 구조화 운영 로그는 allowlist field만 JSON 한 줄로 기록한다. token, cookie, OAuth code,
  provider URL, 사용자·page·repository 식별자, 임의 오류 message/stack은 기록하지 않는다.

## 7. 현재 구현 차이

구현 상태와 남은 차이는 [gap-analysis.md](gap-analysis.md)가 소유한다.
