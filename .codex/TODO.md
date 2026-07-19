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
- [!] GitHub OAuth App 생성 및 local callback 등록
- [x] GitHub 로그인 vertical slice
  - 수용 기준: start/callback/logout과 `/api/me`가 동작한다.
  - 수용 기준: OAuth state 위조·만료·재사용과 잘못된 redirect를 거절한다.
  - 수용 기준: GitHub numeric ID가 IndexedDB namespace로 전달된다.

## P1 — Notion과 개인 칸반

- [!] Notion Public Integration 생성 및 callback 등록
- [x] Notion OAuth 연결/해제
  - 수용 기준: 연결 token은 암호화 HttpOnly 쿠키에만 존재한다.
  - 수용 기준: 연결 개수와 직렬화 크기 상한을 초과하면 안전하게 거절한다.
  - 수용 기준: 한 GitHub 사용자의 연결이 다른 사용자 namespace에 나타나지 않는다.
- [ ] Notion workspace와 page tree 조회
  - 수용 기준: integration에 공유된 root page와 하위 page만 표시한다.
  - 수용 기준: pagination, rate limit, 권한 철회를 처리한다.
- [ ] IndexedDB repository와 migration 구현
  - 수용 기준: GitHub user ID별 board record가 격리된다.
  - 수용 기준: token을 저장하지 않으며 schema validation을 통과한 값만 읽는다.
- [ ] 칸반 UI와 상태 전이 구현
  - 수용 기준: draft/review/ready/publishing/published/failed 전이가 규칙을 따른다.
  - 수용 기준: keyboard 조작과 새로고침 복구가 가능하다.

## P2 — GitHub Pages 게시

- [!] GitHub App 생성, 최소 repository 권한과 callback 등록
- [ ] installation/repository 선택
  - 수용 기준: 현재 로그인 사용자가 접근 가능한 installation repository만 선택한다.
- [ ] Astro 게시 manifest와 template 완성
  - 수용 기준: project site와 user site의 base path를 모두 build test한다.
- [ ] Notion block 변환 pipeline
  - 수용 기준: 제목, 본문, 코드, 이미지, toggle, link의 fixture test가 있다.
  - 수용 기준: 위험한 HTML과 경로 이탈을 차단한다.
- [ ] 요청 기반 게시 orchestration
  - 수용 기준: 최신 Notion 권한과 GitHub 권한을 매 요청 재검증한다.
  - 수용 기준: 동일 content hash는 중복 commit을 만들지 않는다.
  - 수용 기준: commit SHA를 반환하고 UI가 Actions/Pages 상태를 복구한다.

## P3 — 신뢰성과 운영

- [ ] 칸반 export/import와 충돌 안내
- [ ] provider rate limit, timeout, 사용자 재시도 UX
- [ ] secret redaction을 포함한 구조화 로그
- [ ] OAuth/IndexedDB/publish 핵심 E2E
- [ ] 접근성, 성능, 모바일 칸반 검증
- [ ] 쿠키 예산 또는 다기기 동기화 요구가 발생하면 DB 도입 ADR 작성
