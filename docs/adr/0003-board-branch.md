---
title: "ADR 0003: 보관 중 목록을 블로그 저장소의 별도 branch에 저장"
kind: history
last_verified: 2026-11-11
---

# ADR 0003: 보관 중 목록을 블로그 저장소의 별도 branch에 저장

- 상태: Accepted
- 결정일: 2026-11-11
- 대체: [ADR 0002](0002-stateless-board.md)의 "보관 중 = 연결의 모든 문서 page"

## 맥락

ADR 0002로 칸반 상태를 없애자 보관 중에 공유된 Notion 문서가 전부 올라와, 게시할 문서를 고르는 칸반의
쓰임이 사라졌다. 사용자는 문서 목록에서 직접 고른 문서만 보관 중에 두고, 그 목록이 다른 브라우저에서도
같기를 원했다. DB는 두지 않는다([ADR 0001](0001-db-adoption-gate.md)).

## 결정

보관 중 목록(page ID 배열)을 사용자 `<login>.github.io` 저장소의 `kanban-press-board` branch에
`board.json` 하나로 저장한다. 서버가 기존 GitHub OAuth credential(`public_repo`)로 읽고 쓴다.

검토한 대안:

- 브라우저 저장: 다른 브라우저에서 보관 중이 비어 처음 문제로 돌아간다.
- 비밀 gist: 저장소 목록에 드러나지 않지만 OAuth `gist` scope 추가와 재로그인이 필요하다.
- 기본 branch의 파일: 바꿀 때마다 블로그 배포가 돈다.

## 결과

- 같은 계정이면 어느 브라우저에서나 보관 중과 게시 완료가 같다. DB와 새 OAuth scope는 없다.
- 추가·빼기마다 그 branch에 commit이 하나 생긴다. 배포 workflow는 기본 branch에만 돌아 배포는 없다.
- 공개 저장소라 고른 page ID 목록이 공개된다. 제목·본문은 저장하지 않는다.
- 두 브라우저가 동시에 바꾸면 늦은 쪽이 conflict로 실패한다(서버 재시도 없음).
- 역할 판별(page 목록의 하위 page 여부)과 토글 안 page의 소유 page 찾기는 ADR 0002 그대로다.
