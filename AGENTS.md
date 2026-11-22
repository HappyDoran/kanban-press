---
title: 저장소 작업 규범
kind: rule
last_verified: 2026-11-22
---

# Kanban Press

각 GitHub 사용자가 자신의 Notion 문서를 개인 칸반에서 관리해 자신의 `<login>.github.io` GitHub Pages 블로그에 게시하는 DB 없는 다중 사용자 앱이다. 현재 P0~P5 구현을 마친 상태다.

이 문서는 저장소 규칙의 도구 중립 진입점이며 규칙 본문은 아래 소유 문서가 가진다. `CLAUDE.md`는 이 파일의 symlink이고 Claude skill·agent도 `.codex/` canonical 파일의 symlink다. 본문을 복사하지 않는다.

## 권위 순서 (충돌 시 위가 이긴다)

1. 실행 가능한 계약: 소스 코드, 스키마, 설정, 구조 검사, 테스트. 문서가 코드와 다르면 코드가 현재 사실이고 문서를 고친다.
2. `TECH_RULES.md`: 기술 선택, package 책임, 의존 경계.
3. 아래 문서 맵의 소유 문서.
4. 이 문서의 절대 금지와 작업 흐름.

요구는 제품 명세가 정하며 코드가 요구와 다르면 요구를 낮추지 않고 구현 차이로 보고한다. 기술 또는 데이터 흐름을 바꾸면 코드보다 소유 문서를 먼저 갱신하고 같은 변경에서 함께 반영한다.

## 문서 맵 (사실 하나당 소유 문서 하나)

| 사실 | 소유 문서 | 갱신을 유발하는 변경 |
|---|---|---|
| 제품 목표·MVP 범위·요구사항 번호(R)·저장·상태·흐름 계약 | [제품 명세](docs/spec/PROJECT_SPEC.md) | 범위·요구·계약 변경, 결정 확정 |
| 요구사항 대비 현재 상태·백로그·미결 결정 | [gap-analysis.md](docs/spec/gap-analysis.md) | 단계 착수·완료, 결정 확정 |
| 기술 선택·package 책임·허용 의존 | [TECH_RULES.md](TECH_RULES.md) | 의존성 추가·교체, package 추가, 금지 패턴 |
| 런타임 구성·저장 위치·요청 경계·쿠키 envelope·장애 특성 | [아키텍처](docs/architecture/ARCHITECTURE.md) | 요청 흐름·저장 위치·암호화 형식 변경 |
| 구조적 결정의 이유(DB 도입 gate 등) | [docs/adr/](docs/adr/) | 기존 결정을 대체하는 결정 |
| 블로그 고도화 기획·현행 감사 기록 | [docs/planning/](docs/planning/) | 새 고도화 기획 착수 |
| 서비스 소개(사용자 관점 기능·사용 흐름·기술 스택) | [README.md](README.md) | 사용자에게 보이는 기능 추가·제거 |
| 실행·검증 명령·환경 변수·provider 설정 | [개발 가이드](docs/DEVELOPMENT.md) | script·명령·환경 변수 변경 |
| 작업 지원 체계·역할 소유 범위·검사 범위와 한계 | [AI_AGENT_HARNESS.md](docs/AI_AGENT_HARNESS.md) | 진입점·skill·역할·검사 흐름 변경 |
| 변경 이유와 검증 결과 | Git 커밋 본문 | 구조 규칙 도입, 예외 승인, 동작 변경 |

새 문서는 `kp-doc-policy`를 통과한 뒤에만 만들고 이 표에 한 줄 추가한다.

## 작업 유형별 필독

| 작업 | 시작 전 읽는 것 |
|---|---|
| 모든 코드 변경 | TECH_RULES.md, 아키텍처, `kp-testing`, `kanban-press` |
| 파일·package 배치, 의존 변경 | `kp-structure` |
| 문서·skill·agent 변경 | docs/AI_AGENT_HARNESS.md, `kp-doc-policy` |
| 범위 정리·변경, 아이디어를 요구로 옮기기 | docs/spec/PROJECT_SPEC.md, `kp-spec-discovery` |
| 기능 착수·완료, 다음 작업 선택 | docs/spec/gap-analysis.md, `kp-backlog` |
| 역할을 지정받은 작업 | `.codex/agents/kp-<역할>.md`, docs/AI_AGENT_HARNESS.md 역할 표 |
| 여러 역할로 나누는 작업 | `kp-parallel` |
| 완료 전 / 커밋 | `kp-review` / `kp-commit` |

## 절대 금지

- 검증하지 않은 결과를 통과로, mock provider 결과를 실제 연동으로 보고하지 않는다. 실행하지 못한 검증은 못 했다고 적는다.
- 공개 저장소에 secret, 실제 사용자 ID, 실제 token을 commit하지 않는다.
- 파일·브랜치 삭제, 이력 재작성(`push --force`, `reset --hard`), 원격 리소스·외부 계정 설정 변경은 사용자 승인 없이 하지 않는다.
- 빈 문서·TBD 자리 문서·과제용 프롬프트 기록을 만들지 않는다.
- 문서와 사용자 문구는 한국어로 쓴다. 코드 식별자·프레임워크 용어는 원문을 유지한다.

### 고정 아키텍처

- 실행 서버는 `apps/web` 하나다. 별도 Worker, DB, 큐, 객체 저장소를 추가하지 않는다.
- GitHub 사용자는 서로 독립적이며 팀·조직·tenant 모델을 만들지 않는다.
- 칸반의 보관 중 목록은 사용자 `<login>.github.io` 저장소의 `kanban-press-board` branch에 page ID로만 두고, 게시 완료는 블로그 글 파일로 정한다([ADR 0003](docs/adr/0003-board-branch.md)). 그래서 같은 계정이면 어느 브라우저에서나 같다.
- 인증 및 provider token은 클라이언트 JavaScript나 브라우저 저장소(IndexedDB·localStorage)에 저장하지 않는다.
- GitHub 세션과 Notion 연결 정보는 암호화·무결성 보호된 `HttpOnly`,
  `Secure`, `SameSite=Lax` 쿠키에만 둔다.
- 게시 요청은 서버가 Notion과 GitHub 권한을 다시 확인한 후 GitHub repository에
  직접 반영한다. 장기 실행 Worker나 서버 측 재시도 이력을 가정하지 않는다.

### 안전 조건

- OAuth callback은 일회성 `state`, 짧은 만료 시간, 안전한 redirect allowlist를 검증한다.
- 쿠키 암호화에는 인증된 암호화(AEAD)를 사용하고 키 버전을 포함한다.
- 로그, 오류, URL, 응답 JSON에 access token과 쿠키 원문을 남기지 않는다.
- 모든 서버 mutation은 현재 GitHub 사용자와 Notion/GitHub 리소스 소유권을
  요청 시점에 다시 검증한다.
- Notion 연결 쿠키는 크기 상한과 연결 개수 상한을 둔다. 초과 시 명시적으로 거절한다.
- 브라우저가 보낸 데이터는 신뢰하지 않고 서버 경계에서 Zod로 재검증한다.

## 명령어와 로컬 함정

- 모든 명령은 `mise exec -- pnpm <script>`로 실행한다. 명령 목록은 [개발 가이드](docs/DEVELOPMENT.md) 검증 절이 소유한다.
- 생성물(`dist`, `.next`, `*.tsbuildinfo`)은 소스 변경으로 취급하지 않는다.
- 실제 provider smoke(`test:smoke`)는 gitignored `apps/web/.env.smoke.local`의 동의한 테스트 credential로만 사용자가 명시적으로 실행한다.

## 작업 흐름

1. 작업 범위와 완료 조건을 확인한다.
   기능 작업은 docs/spec/gap-analysis.md의 가장 앞선 미완료 단계에서 시작하고 끝나면 상태를 갱신한다.
2. 변경 범위의 소유 문서만 읽고 실제 코드·설정으로 현재 상태를 확인한다.
3. 코드와 소유 문서를 함께 바꾸고 frontmatter의 `last_verified`를 갱신한다.
4. 개발 가이드의 검증을 실행하고 `kp-review`를 적용한다. 완료 항목은 수용 기준과 실패 경로가 테스트로 증명되고, token과 사용자 데이터가 지정된 저장 경계를 벗어나지 않으며, 문서·환경 변수 예시·실제 구현과 gap-analysis 상태가 일치해야 한다.
5. 완료 보고와 커밋 본문에 실행한 검증과 실행하지 못한 검증을 구분해 적는다.
