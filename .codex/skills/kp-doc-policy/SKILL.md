---
name: kp-doc-policy
description: 문서·skill·역할 정의를 만들거나 바꿀 때, 기존 소유 문서를 갱신할지 새 문서를 만들지 도입을 보류할지 판단하는 데 적용한다.
---

# kp-doc-policy

문서는 미리 만들지 않는다. 같은 지식을 코드·대화·이력에서 두 번 이상 비싸게 재구성했을 때 만든다.

## 판단 순서

1. AGENTS.md 문서 맵에서 같은 사실의 소유자를 찾는다. 있으면 새 문서 대신 그 문서를 갱신한다.
2. 아직 구현되지 않았거나 현재 코드·검증 증거로 채울 수 없으면 만들지 않는다. 빈 디렉터리·TBD 자리 문서도 만들지 않는다.
3. 제품 명세의 요구와 현재 코드가 다르면 요구를 낮추지 않고 docs/spec/gap-analysis.md에 차이를 적는다.
4. 반복 비용이 있고 내용을 채울 수 있을 때만 새 소유 문서를 만든다.

## 도입 조건이 생기면 만드는 문서

- ADR(`docs/adr/NNNN-<주제>.md`): 기존 결정을 대체하거나 같은 결정의 재논의가 반복될 때.
- 고도화 기획·감사(`docs/planning/`): 여러 단계에 걸친 새 범위를 착수할 때. 확정된 요구는 제품 명세로, 단계는 gap-analysis로 옮긴다.
- 가이드: 같은 추가 절차(새 route, 새 provider 등)를 세 번째로 반복할 때.
- runbook: 실제 배포·운영 대응 책임이 생겼을 때.

## 만들 때

1. AGENTS.md 문서 맵에 사실·소유 문서·갱신 유발 변경을 한 줄 추가한다.
2. `docs/` 아래와 루트 규범 문서(AGENTS.md, TECH_RULES.md)에는 `title`, `kind`(`rule|design|spec|guide|runbook|snapshot|history`), `last_verified` frontmatter를 둔다.
3. 현재 코드와 검증 가능한 사실만 쓰고, 다른 문서의 사실은 복사하지 않고 링크한다.
4. skill은 `name`·`description` frontmatter로 `.codex/skills/<name>/SKILL.md`에 두고 `.claude/skills/<name>/SKILL.md` symlink를 만든다. 역할 정의는 `.codex/agents/`와 `.claude/agents/` symlink로 같은 방식을 따른다.
5. 한국어·상대 링크를 확인하고 `mise exec -- pnpm structure:check`를 실행한다.
