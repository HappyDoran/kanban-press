---
name: nkb-review
description: 변경 완료 전 코드·문서·검증을 검토하거나 리뷰 요청을 받을 때 적용한다.
---

# nkb-review

1. git diff로 범위를 확인하고 제품 명세의 해당 요구·계약과 gap-analysis 완료 조건을 비교한다.
2. docs/AI_AGENT_HARNESS.md 역할 소유 표 기준으로 변경이 작업자의 쓰기 범위 안인지 확인한다.
3. 변경이 건드린 경계를 본다: GitHub numeric ID namespace 격리, credential·쿠키 저장 경계, 요청 시점 소유권 재검증, Zod 입력 검증, repository 보호(unmanaged 거절·non-force ref update), 반복 게시의 중복 commit 허용, provider URL·식별자 로그 비잔존, 접근성.
4. 재현 가능한 결함은 위치·영향·입력 조건으로 보고한다. 취향은 결함과 구분한다.
5. 소유 문서와 `last_verified`가 바뀐 사실과 맞는지, 실행한 검증과 보고가 일치하는지 확인한다.
6. 구조 검사 통과를 의미적 보안 검토 완료로 보지 않는다. 이번 변경과 무관한 계정·원격 설정을 조작하지 않는다.
