---
name: kp-structure
description: 파일·package를 추가하거나 옮기고 import·의존 경계를 바꿀 때 적용한다.
---

# kp-structure

1. TECH_RULES.md의 책임과 의존 그래프 표를 읽고 기존 package 책임에 배치할 수 있는지 먼저 판단한다. orchestration은 `apps/web`, provider 독립 규칙은 `packages/domain`, 외부 경계는 각 adapter package가 소유한다.
2. package끼리 adapter를 import하지 않고, 다른 package의 `src`를 상대경로로 참조하지 않는다. `@kanban-press/<name>` package exports로만 소비한다. Node 전용 구현은 `@kanban-press/auth/server`처럼 별도 진입점으로 분리한다.
3. 새 package는 `tooling/scripts/check-package-boundaries.mjs`의 `expectedPackages`·`allowedInternalDependencies`, TECH_RULES.md 책임 표, docs/AI_AGENT_HARNESS.md 역할 소유 표를 같은 변경에서 함께 바꾼다.
4. `mise exec -- pnpm lint`(package 경계·구조 검사 포함)와 `typecheck`를 실행한다. 경계 검사는 `packages/*/src`만 본다. `apps/web` 안의 서버·브라우저 경계(`app`·`components`·`lib/client`·`lib/shared`·`lib/server`)는 [아키텍처](../../../docs/architecture/ARCHITECTURE.md) 3절이 소유하고 `apps/web/eslint.config.mjs`가 검사하며, 책임 혼합은 리뷰에서 본다.
