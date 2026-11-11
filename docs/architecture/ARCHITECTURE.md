---
title: 아키텍처
kind: design
last_verified: 2026-11-11
---

# 아키텍처

## 1. 구성

```text
Browser
  └─ Next.js UI (칸반은 브라우저에 저장하지 않음)
          │ HTTPS + HttpOnly encrypted cookies
          ▼
apps/web (stateless Next.js)
  ├─ auth
  ├─ notion adapter
  ├─ github adapter
  └─ publisher
       ├────────────▶ Notion API
       └────────────▶ GitHub API ─▶ Actions ─▶ Pages
```

서버 런타임은 `apps/web` 하나이며 사용자 데이터, token, job을 서버 저장소에
영속화하지 않는다.

## 2. 저장 위치

| 데이터 | 저장 위치 | 신뢰 수준 |
|---|---|---|
| GitHub 세션과 credential | 암호화 HttpOnly 쿠키 | 서버에서 복호화·검증 |
| Notion connection과 credential | 암호화 HttpOnly 쿠키 | 서버에서 복호화·검증 |
| 보관 중 목록(page ID) | 사용자 GitHub repository `kanban-press-board` branch의 `board.json`([ADR 0003](../adr/0003-board-branch.md)) | 서버가 읽고 zod 검증, blob SHA 조건부 저장 |
| 칸반 카드와 문서/컨테이너 역할 | 저장하지 않음. Notion page 목록(하위 page 여부)으로 매번 계산 | 열 때마다 Notion API에서 조회 |
| 게시 중 상태와 실패 안내 | React 메모리 | 새로고침 시 소멸 |
| 게시 완료 여부와 글 주소 | 사용자 GitHub repository(글 파일의 page ID 접미사) | 열 때마다 GitHub API에서 조회 |
| 블로그 사이트 설정(이름·소개·링크) | 사용자 GitHub repository `.kanban-press/site.json` | 저장 시 서버 zod 검증, 빌드 시 template이 다시 검증 |
| 게시 전 프리뷰 DTO와 dialog 상태 | React 메모리 | 닫기·새로고침 시 소멸 |
| 게시 콘텐츠와 이력 | 사용자 GitHub repository | GitHub 권한으로 검증 |
| 배포 상태 | GitHub Actions/Pages | GitHub API에서 조회 |

## 3. package 경계와 코드 위치

package 책임과 허용 의존은 [TECH_RULES.md](../../TECH_RULES.md)의 책임과 의존 그래프 절이 소유한다.
`apps/web` 안의 층은 다음과 같다. route 파일(`app/api/**/route.ts`, `app/auth/**`)은 아래 함수를 부르기만 한다.

| 층 | 위치 | 하는 일 |
|---|---|---|
| 화면 | `app/notion-browser.tsx`, `kanban-board.tsx`, `notion-tree.tsx`, `publish-preview.tsx`, `github-pages-target.tsx` | 조립과 표시 |
| 화면 상태 | `app/use-workspace.ts`, `app/use-board.ts`, `lib/client/` | 세션·연결·칸반 상태, 브라우저 API 호출과 응답 검증, 게시→배포 확인 |
| 인증 | `lib/auth/` | 세션·연결 쿠키, GitHub·Notion OAuth |
| Notion | `lib/notion/` | 요청(`provider.ts`)·응답 변환(`convert.ts`)·읽기 순서(`content.ts`)·목록 route(`pages.ts`) |
| GitHub | `lib/github/pages.ts` | 저장소 확인·준비 상태·commit·배포 상태 |
| 게시 | `lib/publish/` | 보관 중 목록(`board-route.ts` 읽기·추가·빼기), 사이트 설정(`site-settings.ts` 형식, `site-settings-route.ts` 읽기·저장), 공통 요청 검증(`orchestration.ts`의 `authorizePageRequest`), 게시·내리기·게시 글 목록(`orchestration.ts`), 한 글의 저장소 파일 규칙(`blog-files.ts`), 문서 조립(`document.ts`), 이미지(`image-assets.ts`), 프리뷰 DTO(`preview.ts`) |
| provider 공통 | `lib/operations/` | 10초 timeout·`Retry-After`·allowlist 로그 |

## 4. 요청 경계

### 읽기 요청

1. 세션 쿠키를 해독하고 만료를 확인한다.
2. provider token을 해독한다.
3. provider API에서 현재 권한으로 데이터를 읽는다.
4. 필요한 최소 필드만 브라우저에 반환한다.

### mutation과 게시 요청

1. Origin/CSRF 조건과 세션을 확인한다.
2. 브라우저 payload를 schema로 검증한다.
3. Notion 페이지 접근과 GitHub repository 접근을 다시 확인한다.
4. 최신 원문을 서버에서 가져온다.
5. image capability URL을 제한된 HTTPS downloader로 읽어 로컬 asset artifact로 바꾼다.
6. Markdown을 포함한 artifact와 진단용 content hash를 생성한다.
7. 같은 page ID 접미사의 기존 파일 중 이번에 쓰지 않는 것을 삭제 목록에 넣고, 옛 slug에는 새 주소 안내 page를 쓴다.
8. 동일 artifact 여부와 관계없이 요청마다 GitHub에 새 commit을 만든다(쓰기와 삭제를 한 commit으로).

클라이언트가 전달한 markdown, repository 소유권, 사용자 ID를 그대로 신뢰하지 않는다.
Notion provider 응답은 adapter에서 예약 블로그 속성만 제한된 property union으로
정규화하고 앱 orchestration의 공유 `buildPublishDocument`가 metadata와 block을 조립한다.
publisher는 provider 독립 `PublishDocument`와 제한된 block union만 받는다. publisher가
생성하는 repository 상대 경로와 Markdown text, URL, code fence는 commit 전에 다시 검증한다.
목록·할 일·callout·table은 adapter에서 구조를 잃지 않는 provider 독립 block으로
정규화하고 preview와 publisher가 같은 중첩 모델을 소비한다. 사용자 입력 HTML은 허용하지
않으며 publisher가 생성한 table/callout wrapper 안의 rich text도 별도로 escape한다.
브라우저는 title, description, category, tag, slug 또는 Markdown을 게시 입력으로 전달하지
않으며 preview도 같은 공유 조립 경계를 사용한다.
GitHub adapter는 기본 branch head/tree 조회, blob/tree/commit 생성, non-force ref
update, repository 관리 경계·Pages readiness 판별과 Actions/Pages 상태 조회만 담당한다.
빈 repository와 marker가 있는 repository는 허용하고, marker가 없는 repository는 앱 v1의
허용 경로만 있는 legacy 형태일 때만 다음 게시에서 marker를 추가한다. 그 외 repository는
기존 콘텐츠 보호를 위해 mutation 전에 거절한다. content hash 계산과 Notion→publisher
정규화, 두 adapter의 호출 순서는 `apps/web` orchestration이 소유한다.

이미지 downloader는 `apps/web`의 게시 전용 경계다. HTTPS URL과 매 redirect의 hostname을
DNS로 해석해 public unicast 주소만 남기고 그 주소를 TLS socket lookup에 고정한다.
credential/fragment, private·reserved IP, protocol downgrade, redirect 3회 초과, 10초
timeout, 허용 MIME 외 응답, 이미지당 8 MiB·문서당 64 MiB·100개 초과를 거절한다.
성공 byte만 결정적 `src/assets/blog/<slug>/image-<순번>.<확장자>` artifact가 되며
publisher에는 provider URL 대신 검증된 로컬 상대 경로만 전달한다. 실패 오류는 URL을
포함하지 않는 안정적인 code로만 응답한다.

### 게시 전 프리뷰 요청

1. 동일 origin POST, 세션과 현재 사용자 소유 Notion connection을 검증한다.
2. 현재 credential로 page와 block pagination을 다시 읽는다.
3. publish와 같은 `buildPublishDocument`로 조립한다.
4. raw HTML, Markdown, provider property와 image URL을 제외한 versioned DTO만
   `no-store`로 반환한다.

프리뷰는 GitHub adapter를 생성하지 않고 repository를 조회·변경하지 않는다. 브라우저는
프리뷰 결과를 React 메모리에만 두며 게시 상태를 변경하지 않는다.
화면은 블로그 template과 같은 class와 `@kanban-press/publisher`의 `BLOG_CSS`로 그려
실제 글과 같은 heading·목록·표 구조를 보여준다. 블로그 안의 이동 링크는 href 없이 그린다.

### rollout 검증 경계

통합 E2E는 preview 응답을 publish 입력으로 전달하지 않고 같은 ID body로 두 endpoint를
따로 호출한다. fake provider state를 두 호출 사이에 바꿔 publish가 최신 Notion 원문과
Notion/GitHub 권한을 다시 읽는지 검증하며, 실제 publisher가 만든 v2 Markdown·category와
로컬 image·template artifact를 in-memory GitHub adapter에서 검사한다.

실제 provider smoke는 별도 Vitest mode와 gitignored `.env.smoke.local`을 사용한다.
Notion content retrieve, 제한된 image materialization, GitHub 고정 Pages repository와
readiness까지만 호출하는 read-only gate이며 commit/ref/Pages mutation을 수행하지 않는다.
smoke secret과 capability URL은 assertion message나 출력에 포함하지 않는다.

## 5. 쿠키 envelope

envelope에는 최소한 `version`, `keyId`, `issuedAt`, `expiresAt`, payload를 둔다.
AEAD nonce는 매번 새로 생성한다. 복호화 실패, 알 수 없는 key, 만료, schema 불일치는
인증 실패로 처리한다.

현재 cookie codec은 AES-256-GCM을 사용하며 직렬화 형식은
`v1.keyId.nonce.ciphertext.tag`다. `version`과 `keyId`는 AAD에 포함하고,
시간 정보와 payload는 암호문 안에 둔다. 공개 package 진입점에는 타입만 노출하며
구현은 Node 전용 `@kanban-press/auth/server`에서 import한다.

OAuth state 쿠키와 장기 세션 쿠키는 이름·수명·용도를 분리한다. production에서는
`Secure`를 강제한다. 연결 추가 전에 직렬화된 크기를 검사하고 정책 상한을 넘기지 않는다.

GitHub 로그인은 `/auth/github/start`에서 10분 수명의 state 쿠키를 만들고,
`/auth/github/callback`에서 query state와 상수 시간 비교한 뒤 즉시 쿠키를 삭제한다.
로그인 시작 요청의 origin이 `APP_ORIGIN`과 다르면 state cookie를 만들기 전에 canonical
`APP_ORIGIN`의 동일 경로로 redirect해 Vercel deployment alias 간 cookie 분리를 막는다.
GitHub가 PKCE를 지원하지 않으므로 authorization code와 client secret으로 token을
교환한다. callback code는 GitHub에서도 일회용이며, 애플리케이션은 state 쿠키 삭제로
브라우저에서의 재사용을 차단한다. 성공 세션은 7일 수명이다.

사용자 지정 복귀 경로는 `/`로 시작하는 동일 origin 상대 경로만 허용한다.
`//`, 역슬래시, 절대 URL, OAuth/auth API 경로는 거절한다.

Notion OAuth state에는 현재 GitHub user ID를 함께 봉인한다. callback과 연결 해제는
현재 GitHub 세션의 ID가 일치해야 한다. 연결 쿠키는 여러 사용자의 레코드를 포함할 수
있지만 목록·변경 시 현재 소유자 레코드만 노출한다. 전체 3개 또는 암호문 3,800 bytes를
넘는 새 연결은 저장하지 않고 방금 발급된 token을 revoke한다.

GitHub OAuth credential에는 공개 repository 직접 게시를 위한 `public_repo`와
`.github/workflows/deploy.yml` 생성·수정을 위한 `workflow` scope를 요청한다. 이
scope들은 사용자 repository에 대한 쓰기 권한이므로 제품은 서버에서 대상을
`<현재 login>.github.io` 하나로 더 좁힌다. 매 요청마다 token scope, repository owner
numeric ID, public 여부와 push 권한을 확인하며 credential은 응답, URL, 로그,
브라우저 저장소에 포함하지 않는다.

## 6. 장애 특성

- Notion/GitHub API 실패는 요청 실패로 반환하며 브라우저에서 명시적으로 재시도한다.
- 모든 provider 요청은 `lib/operations/provider-request.ts`를 거치며 10초 timeout과 caller abort를 합성한다. fetch가 abort를 무시해도 timeout으로 끝난다. 429의 bounded
  `Retry-After`만 브라우저에 전달하고 timeout은 provider별 504 오류로 구분한다.
- provider 장애 로그는 provider, operation, 안정적인 오류 code, HTTP status,
  bounded retry/소요 시간만 기록하는 allowlist JSON logger를 통한다.
- GitHub는 동시에 몰리는 쓰기 요청을 제한한다. commit은 UTF-8 텍스트 artifact를 tree 요청에 inline하고
  이미지 같은 바이너리 blob만 하나씩 차례로 만든다(글 하나 게시 = 이미지 수 + tree·commit·ref 요청).
- Notion 429를 받으면 브라우저는 아직 보내지 않은 구조 확인을 `Retry-After` 시각까지 멈춘다. 실패한 요청은
  사용자가 다시 시도한다.
- commit 이후 응답이 유실된 상태에서 재시도하면 중복 commit이 생길 수 있다.
- 같은 artifact로 만든 Git tree가 현재 tree와 같아도 새 commit을 만든다.
- ref update 사이에 다른 변경이 생기면 force push하지 않고 게시 충돌로 반환한다.
  브라우저는 한 탭의 게시·내리기 commit 요청을 한 번에 하나씩 보내 자기 요청끼리의 충돌을 막는다
  (`lib/client/publish.ts`). 다른 탭·기기와 동시에 게시하면 여전히 충돌할 수 있다.
- GitHub Actions/Pages 상태는 GitHub가 source of truth다.
- 생성하는 deploy workflow는 `concurrency: pages`로 Pages 배포를 직렬화한다. 기다리던 중간 배포가 취소되면
  그 commit을 포함한 기본 branch 최신 commit의 배포 상태를 따른다.
- 서버 재시작은 사용자 상태에 영향을 주지 않지만 쿠키 암호화 키는 안정적으로 유지해야 한다.
