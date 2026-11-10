---
name: kp-commit
description: 변경을 커밋·푸시할 때 변경 범위와 검증 근거를 정리한다.
---

# kp-commit

1. `kp-review`를 적용하고 README.md의 검증을 실행한다. 실행하지 못한 검증은 본문에 미검증으로 적는다.
2. git status·diff·브랜치·원격을 확인하고 요청한 작업에 속한 파일만 stage한다. 관련 없는 변경은 남긴다. 작업 브랜치는 `dev`이며 `prd`는 PR로만 반영한다.
3. secret, 실제 token·사용자 ID, `.env.*`(예시 파일 제외), smoke credential이 포함되지 않았는지 확인한다.
4. `git commit -m "<type>: <한국어 요약>" -m "<본문>"`. type은 feat·fix·refactor·docs·chore·test. 본문에 왜 바꿨는지, 구조적 결정이면 기각한 대안, 실행한 검증과 미검증을 적는다. 코드만 바꾸고 테스트를 바꾸지 않았으면 `테스트 제외: <사유>`를 적는다.
5. 검사 실패는 원인을 고치고 다시 검증한다. hook·CI를 우회하지 않는다.
6. push는 사용자가 요청했을 때만 하고, 이력 재작성·강제 push는 하지 않는다. push 후 로컬 HEAD와 원격 추적 브랜치가 같은지 확인한다.
