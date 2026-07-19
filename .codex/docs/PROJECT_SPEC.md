# 제품 명세

## 1. 제품 목표

각 사용자가 GitHub로 로그인하고 자신의 Notion 문서를 개인 칸반에서 관리한 뒤,
승인한 문서를 자신의 GitHub Pages 블로그에 게시한다.

여기서 “다중 사용자”는 여러 사용자가 하나의 팀 공간을 공유한다는 뜻이 아니다.
각 GitHub 사용자가 자신의 브라우저에서 완전히 독립된 칸반을 갖는다는 뜻이다.

## 2. MVP 범위

1. GitHub OAuth 로그인
2. 하나 이상의 Notion 워크스페이스 OAuth 연결
3. 허용된 페이지와 하위 페이지 탐색
4. `작성 중 → 검토 → 게시 준비 → 게시됨` 칸반 관리
5. GitHub App 설치 및 대상 repository 선택
6. 게시 준비 문서를 Astro 콘텐츠로 변환해 repository에 commit
7. GitHub Actions와 Pages 배포 상태 표시

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
  ownerGitHubUserId
  connectionId
  providerPageId
  title
  column
  position
  updatedAt
  sourceLastEditedAt

PublishTargetPreference
  ownerGitHubUserId
  repositoryFullName
  installationId
  branch
```

token, OAuth state, 쿠키 원문은 IndexedDB나 localStorage에 저장하지 않는다.

## 4. 상태 흐름

```text
draft → review → ready → publishing → published
                    ↘ failed → ready
published → draft (Notion 원문 변경 또는 사용자의 재작업)
```

- `publishing`은 브라우저가 추적하는 일시 상태다.
- 서버에 영속 job이 없으므로 새 기기에서는 GitHub commit/Actions 상태를 조회해
  현재 결과를 재구성한다.
- 동일 콘텐츠 hash가 이미 대상 repository에 반영됐다면 중복 commit을 만들지 않는다.

## 5. 주요 흐름

### 로그인

서버가 GitHub OAuth `state`를 발급하고 callback에서 검증한 뒤 code를 교환한다.
GitHub 사용자 정보를 조회해 암호화 세션 쿠키를 설정한다.

- 시작: `GET /auth/github/start?returnTo=/`
- callback: `GET /auth/github/callback`
- 현재 사용자: `GET /api/me`
- 로그아웃: `POST /auth/logout`
- OAuth scope: `read:user`
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
- 연결 해제: `POST /api/notion/connections/disconnect`
- 연결 쿠키 수명: 30일
- 브라우저 전체 최대 연결: 3개
- 암호화된 cookie value 최대 크기: 3,800 bytes

각 연결에는 소유 GitHub numeric ID가 포함되며 목록과 해제 요청은 현재 세션의
소유 연결만 다룬다. API 응답에는 Notion credential을 포함하지 않는다.

### 칸반

클라이언트는 `/api/me`에서 받은 GitHub 사용자 ID를 기준으로 IndexedDB를 연다.
Notion 페이지 식별자와 칸반 상태를 저장하며 다른 사용자 namespace를 절대 합치지 않는다.

### 게시

서버는 게시 요청마다 다음을 수행한다.

1. GitHub 세션 쿠키 검증
2. Notion 연결 및 페이지 접근 재검증
3. GitHub App installation과 repository 접근 재검증
4. 최신 Notion 콘텐츠 조회 및 안전한 변환
5. 결정적 콘텐츠 hash 확인 후 GitHub commit 생성
6. commit SHA와 Actions/Pages 조회 정보 반환

브라우저는 GitHub 상태를 polling한다. 서버는 job이나 결과를 저장하지 않는다.

## 6. 명시적 제약

- 칸반은 브라우저별 데이터다. 다른 기기와 자동 동기화되지 않는다.
- 브라우저 데이터를 지우면 칸반이 사라진다. 추후 export/import는 제공할 수 있다.
- 쿠키를 지우면 GitHub 및 Notion을 다시 연결해야 한다.
- 쿠키 크기 때문에 연결 가능한 Notion 워크스페이스 수가 제한된다.
- 서버 측 감사 로그, 영구 배포 이력, 자동 재시도는 없다.
- 게시 중 브라우저가 닫혀도 GitHub workflow는 계속될 수 있지만 UI 상태는 다음 접속 때
  GitHub에서 다시 확인해야 한다.

이 제약이 제품 요구사항과 충돌하는 시점이 DB 도입 재검토 기준이다.

## 7. 현재 구현 차이

- Next.js web scaffold, provider 경계, stateless 암호화 쿠키 codec이 존재한다.
- GitHub 로그인 route와 `/api/me`가 구현됐으며 실제 사용에는 OAuth App 설정이 필요하다.
- Notion OAuth 연결·목록·해제 route가 구현됐으며 실제 사용에는 Public Connection
  설정이 필요하다.
- Notion page tree, IndexedDB, 게시 기능은 아직 구현되지 않았다.
- 루트의 기존 Astro 단일 사용자 프로토타입은 신규 구조로 대체 후 제거할 예정이다.
