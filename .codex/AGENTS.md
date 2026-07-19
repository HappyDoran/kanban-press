# Notion Kanban Blog 작업 규칙

## 작업 기준

- 제품 요구사항은 `.codex/docs/PROJECT_SPEC.md`, 기술 선택은
  `.codex/docs/TECH_STACK.md`, 경계는 `.codex/docs/ARCHITECTURE.md`를 따른다.
- 구현 순서는 `.codex/TODO.md`의 가장 앞선 미완료 항목을 따른다.
- 기술 또는 데이터 흐름을 바꾸면 코드보다 문서를 먼저 갱신한다.
- 기존 단일 사용자 Astro 프로토타입은 참고만 하며 신규 앱에서 import하지 않는다.

## 고정 아키텍처

- 실행 서버는 `apps/web` 하나다. 별도 Worker, DB, 큐, 객체 저장소를 추가하지 않는다.
- GitHub 사용자는 서로 독립적이며 팀·조직·tenant 모델을 만들지 않는다.
- 사용자별 칸반은 브라우저 IndexedDB에 GitHub 사용자 ID namespace로 저장한다.
- 인증 및 provider token은 클라이언트 JavaScript나 IndexedDB에 저장하지 않는다.
- GitHub 세션과 Notion 연결 정보는 암호화·무결성 보호된 `HttpOnly`,
  `Secure`, `SameSite=Lax` 쿠키에만 둔다.
- 게시 요청은 서버가 Notion과 GitHub 권한을 다시 확인한 후 GitHub repository에
  직접 반영한다. 장기 실행 Worker나 서버 측 재시도 이력을 가정하지 않는다.

## 안전 조건

- OAuth callback은 일회성 `state`, 짧은 만료 시간, 안전한 redirect allowlist를 검증한다.
- 쿠키 암호화에는 인증된 암호화(AEAD)를 사용하고 키 버전을 포함한다.
- 로그, 오류, URL, 응답 JSON에 access token과 쿠키 원문을 남기지 않는다.
- 모든 서버 mutation은 현재 GitHub 사용자와 Notion/GitHub 리소스 소유권을
  요청 시점에 다시 검증한다.
- Notion 연결 쿠키는 크기 상한과 연결 개수 상한을 둔다. 초과 시 명시적으로 거절한다.
- 브라우저 저장 데이터는 신뢰하지 않고 서버 경계에서 Zod로 재검증한다.
- 공개 저장소에 secret, 실제 사용자 ID, 실제 token을 commit하지 않는다.

## 변경 원칙

- `packages/domain`은 provider와 UI에 독립적인 타입과 상태 규칙만 소유한다.
- `packages/auth`, `notion`, `github`, `publisher`는 각 외부 경계를 캡슐화한다.
- package 간 허용 의존성은 `tooling/scripts/check-package-boundaries.mjs`로 강제한다.
- 새 런타임 의존성은 실제 vertical slice에 필요한 시점에만 추가한다.
- 생성물(`dist`, `.next`, `*.tsbuildinfo`)은 소스 변경으로 취급하지 않는다.

## 검증 및 완료 기준

변경 범위에 맞춰 아래를 실행하며 최종 완료 전에는 전체 명령이 통과해야 한다.

```bash
mise exec -- corepack pnpm install --frozen-lockfile
mise exec -- corepack pnpm lint
mise exec -- corepack pnpm typecheck
mise exec -- corepack pnpm test
mise exec -- corepack pnpm test:integration
mise exec -- corepack pnpm build
```

완료 항목은 다음을 모두 만족해야 한다.

- 수용 기준과 실패 경로가 테스트로 증명된다.
- token과 사용자 데이터가 지정된 저장 경계를 벗어나지 않는다.
- 문서, 환경 변수 예시, 실제 구현이 일치한다.
- `.codex/TODO.md` 상태가 실제 검증 결과와 일치한다.
