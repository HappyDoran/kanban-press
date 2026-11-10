---
name: nkb-testing
description: 코드를 바꾸는 모든 작업에서 어떤 검증을 통과해야 완료인지 고르고, 어떤 코드에 테스트가 필수인지 판단할 때 적용한다.
---

# nkb-testing

코드 변경과 검증은 같은 작업·같은 커밋에서 움직인다. 실행 명령은 README.md가 소유한다.

| 실패 시 영향 | 검증 |
|---|---|
| 상태 전이·slug·Markdown 변환·escape·content hash | 정답 사례 Vitest 단위 테스트(`test`) |
| 쿠키 codec·OAuth state·redirect allowlist·소유권 재검증 | 위조·만료·재사용·타 사용자 입력 거부 단위 테스트 |
| provider 응답 정규화·timeout·429·이미지 downloader 제한 | fetch mock contract 테스트 |
| preview→원문/권한 변경→publish 연결 | mutable fake provider 통합 테스트(`test:integration`) |
| Astro template·base path·semantic HTML | publisher의 Astro fixture build 테스트 |
| IndexedDB 사용자 격리·drag 게시·접근성·320px·성능 예산 | production build Playwright E2E(`test:e2e`) |
| package 경계·문서 구조 | `lint`(경계·구조 검사)와 `typecheck` |
| 실제 Notion/GitHub 응답 | read-only `test:smoke`. 동의한 테스트 credential로 사용자가 명시적으로 실행 |

- 새 로직과 바뀐 동작의 테스트를 함께 갱신한다. 의도치 않은 실패는 기대값이 아니라 코드를 먼저 의심한다.
- 현재 구현하지 않은 기능을 통과 사례로 만들지 않는다. 단순 문구·스타일 변경에 구현을 복사한 테스트를 추가하지 않는다.
- IndexedDB schema를 바꾸면 이전 version DB를 비우고 다시 동기화하는 사례와 strict schema 거절 사례를 함께 테스트한다(이전 version은 migration하지 않는다).
- 보고에는 실행한 검증, 실행하지 못한 검증과 이유, mock provider와 실제 provider 확인을 구분한다.
