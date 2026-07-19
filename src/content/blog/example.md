---
title: "Notion 칸반 블로그 시작하기"
description: "Notion의 네 가지 상태를 블로그 게시 파이프라인으로 사용하는 예시 글입니다."
category: "DevOps"
tags: ["Notion", "Astro", "GitHub Pages"]
publishedAt: "2026-07-19"
updatedAt: "2026-07-19"
notionPageId: "example"
draft: false
---

## 콘텐츠 흐름

`작성 중 → 검수 → 게시 준비 → 게시 완료`의 네 단계만 사용합니다.

- 검수 단계에서 카테고리와 태그를 추천합니다.
- 게시 준비 단계에서 Markdown을 생성합니다.
- GitHub Actions가 정적 사이트를 배포합니다.
