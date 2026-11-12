---
title: AI Agent 작업 지원 체계
kind: design
last_verified: 2026-11-12
---

# AI Agent 작업 지원 체계

Agent가 과거 대화 없이 작업을 시작해 사실을 찾고, 변경을 검증하고, 근거를 남기게 하는 장치의 설계와 자동 검증 범위를 소유한다. 다른 사실은 [AGENTS.md](../AGENTS.md) 문서 맵의 소유자가 가진다.

```
AGENTS.md (= CLAUDE.md)  →  작업 범위·완료 조건 확인(gap-analysis)  →  소유 문서 선택
  →  실제 코드·설정 확인  →  작업 유형별 skill 적용  →  코드·소유 문서 변경
  →  README.md 검증  →  review  →  커밋 본문에 이유·검증 보존  →  다음 세션
```

## 진입점과 skill

진입점은 루트 AGENTS.md다. skill은 `.codex/skills/<name>/SKILL.md`, 역할 정의는 `.codex/agents/<name>.md`가 canonical이며 `.claude/` 아래는 symlink만 둔다. `.codex/skills/kanban-press/agents/openai.yaml`은 Codex UI 표시 정보다. 루트 규범 문서(AGENTS.md, TECH_RULES.md)와 `docs/` 아래 문서는 `title`, `kind`(`rule|design|spec|guide|runbook|snapshot|history`), `last_verified` frontmatter를 둔다. README.md는 frontmatter를 두지 않는다.

| skill | 적용 시점 |
|---|---|
| kanban-press | DB 없는 경계를 지키며 vertical slice를 구현·검증할 때 |
| kp-structure | 파일·package 배치, 의존 변경 |
| kp-doc-policy | 문서·skill·agent 생성·변경 |
| kp-testing | 동작·계약·신뢰 경계 변경 |
| kp-review | 완료 전, 리뷰 요청 |
| kp-commit | 커밋·푸시 |
| kp-spec-discovery | 범위 정리·변경 |
| kp-backlog | 기능 착수·완료, 다음 작업 선택 |
| kp-parallel | 여러 역할로 나누는 작업, 병렬 실행·병합 |

## 역할과 소유 범위

혼자 진행하며 작업을 역할 관점으로 나눈다. 역할의 공통 행동은 `.codex/agents/kp-<역할>.md`가 소유하고, 이 표는 각 역할이 쓸 수 있는 경로를 소유한다. 표 밖 경로가 필요하면 소유 역할에 요청한다. 실행 방식과 병합은 kp-parallel을 따른다.

| 역할 | agent | 쓰기 범위 | 주 입력 |
|---|---|---|---|
| 기획 | kp-planner | docs/spec/PROJECT_SPEC.md, docs/spec/gap-analysis.md, docs/planning/(BLOG_EXPERIENCE_DESIGN.md 제외) | 사용자 결정, 사업 제안 |
| 디자인 | kp-designer | apps/web/app/globals.css, packages/publisher/src/blog-css.ts(블로그·프리뷰 공용 CSS), docs/planning/BLOG_EXPERIENCE_DESIGN.md | 요구사항의 화면·흐름 |
| 프론트엔드 | kp-frontend | apps/web/components/(화면 컴포넌트·hook·테스트), apps/web/app/page.tsx·layout.tsx, apps/web/lib/client/, apps/web/lib/shared/task-limiter.ts·format-date.ts, apps/web/e2e/, apps/web/playwright.config.ts | 완료 조건, 디자인 기준, package 계약 |
| 백엔드 | kp-backend | apps/web/app/api/, apps/web/app/auth/, apps/web/lib/server/, apps/web/lib/shared/(프론트엔드 소유 두 파일 제외), packages/*(`blog-css.ts` 제외), docs/architecture/, docs/adr/ | 요구사항, TECH_RULES.md |
| AI 프롬프트 | kp-prompt-engineer | 해당 없음(모델 호출 없음, AI 처리 요구가 생기면 경로를 먼저 등록) | AI 처리 요구, 계약 |
| 사업 | kp-business | 없음(제안만) | 기획의 방향·남은 결정 |

README.md·TECH_RULES.md·AGENTS.md·`tooling/`·`.github/` 같은 공통 파일은 변경한 역할이 자기 사실만 고치고, 겹치는 변경은 병합 담당이 정리한다.

## 자동 검사와 한계

- `tooling/scripts/check-package-boundaries.mjs`: `packages/*`의 package 이름, 허용 내부 의존, `packages/*/src`의 `@kanban-press/*` import 선언 여부를 검사한다.
- `tooling/scripts/check-structure.mjs`: `CLAUDE.md`·`.claude/skills`·`.claude/agents`의 canonical symlink, 규범 문서 frontmatter, skill·agent `name`과 디렉터리·파일명 일치, Markdown 상대 링크, `.env*`·DB 파일 추적 금지를 검사한다. `tooling/scripts/check-structure.test.mjs`가 검사 자체의 회귀를 확인한다.
- 루트 `lint`는 두 검사를 먼저 실행하고 `test`는 harness 테스트를 먼저 실행한다.
- Git hook은 없다. `.github/workflows/ci.yml`이 `dev`·`prd` 대상 PR과 `dev` push에서 install, lint, typecheck, build, test, test:integration, Chromium E2E를 실행한다.

`apps/web`의 import 경계, Markdown 본문의 의미·`last_verified`의 진실성, 보안의 완전성, 역할 쓰기 범위 준수, 실제 provider 동작(`test:smoke`는 CI에서 실행하지 않음)은 검사하지 않으며 리뷰 대상이다.
