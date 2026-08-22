# ADR 0001: DB 도입 보류와 재평가 gate

- 상태: Accepted
- 결정일: 2026-08-22

## 맥락

현재 제품은 사용자별 칸반을 GitHub numeric user ID로 분리한 IndexedDB에 저장하고,
credential은 암호화 HttpOnly cookie, 게시 콘텐츠와 배포 상태는 GitHub에 둔다.
서버가 영속화해야 할 공유 데이터나 작업 이력은 없다.

## 결정

P4 완료 시점에도 DB를 도입하지 않는다. 다음 중 하나가 실제 제품 요구사항으로 승인될
때 별도 ADR에서 데이터 모델, migration, 격리와 운영 책임을 설계한다.

- 여러 기기 간 칸반 동기화
- 팀 공동 작업과 역할 권한
- 영구 배포 이력 또는 감사 로그
- 예약 게시, webhook 처리 또는 서버 측 신뢰 가능한 재시도
- 암호화 cookie 예산을 넘는 Notion 연결 수

관측을 위한 구조화 로그는 사용자 데이터를 저장하는 감사 DB가 아니며 allowlist event만
런타임 표준 출력에 기록한다.

## 결과

- 현재 DB-free 경계와 단일 `apps/web` 서버를 유지한다.
- 승인된 요구가 없으므로 schema, ORM, queue, Worker를 추가하지 않는다.
- 위 gate가 발생하면 이 결정을 대체하는 ADR 없이는 DB를 추가하지 않는다.
