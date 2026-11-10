// 게시 블로그 화면의 CSS(디자인 기획 2.3·7·10절, A 작업대형).
// 블로그 template의 BaseLayout과 게시 앱의 프리뷰가 같은 class와 이 CSS를 함께 쓴다.
// 그래서 element 선택자는 `.post-body` 같은 블로그 class 아래에만 두고, 토큰(`--color-*` 등)은 쓰는 쪽이 정의한다.
export const BLOG_CSS = `
.site-header { border-bottom: 1px solid var(--color-border); background: var(--color-bg-surface); }
.site-header-inner, .site-main, .site-footer-inner { width: min(var(--shell-max), calc(100% - 2.5rem)); margin-inline: auto; }
.site-header-inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1.5rem; min-height: 3.5rem; padding-block: 0.5rem; }
.site-brand { color: var(--color-text-primary); font-weight: 700; text-decoration: none; }
.site-nav ul, .tag-list, .breadcrumbs ol, .category-list { display: flex; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
.site-nav ul { gap: 0.25rem; }
.site-nav a { display: inline-flex; min-height: 2.75rem; align-items: center; padding-inline: 0.75rem; border-radius: var(--radius-control); color: var(--color-text-secondary); font-size: 0.875rem; font-weight: 500; text-decoration: none; }
.site-nav a:hover { color: var(--color-text-primary); }
.site-nav a[aria-current="page"], .site-brand[aria-current="page"] { color: var(--color-accent); }
.site-main { min-height: 70vh; padding-block: 2.5rem 4rem; }
.site-footer { border-top: 1px solid var(--color-border); color: var(--color-text-secondary); }
.site-footer-inner { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem 1.5rem; padding-block: 1.5rem; font-size: 0.875rem; }
.muted { color: var(--color-text-secondary); }

.hero { max-width: var(--reading-max); margin-block-end: 3rem; }
.hero h1 { margin: 0 0 0.75rem; font-size: clamp(1.75rem, 4vw, 2.125rem); line-height: 1.3; }
.hero p { margin: 0; color: var(--color-text-secondary); }
.hero-stats { display: flex; gap: 1rem; margin: 1rem 0 0; font-family: var(--font-mono); font-size: 0.8125rem; color: var(--color-text-secondary); }
.hero-stats div { display: flex; gap: 0.35rem; }
.hero-stats dd { margin: 0; color: var(--color-text-primary); }
.section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem 1rem; margin-block: 2.5rem 1rem; }
.section-heading h2 { margin: 0; font-size: 1.125rem; }
.post-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 28rem), 1fr)); gap: 1rem; }
.post-list { display: grid; gap: 1rem; max-width: var(--reading-max); }

.post-card { display: flex; min-width: 0; flex-direction: column; gap: 0.5rem; padding: 1.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-bg-surface); transition: border-color 120ms var(--ease); }
.post-card:hover, .post-card:focus-within { border-color: var(--color-accent); }
.post-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.75rem; }
.post-card h2, .post-card h3 { margin: 0; font-size: 1.125rem; line-height: 1.4; }
.post-card-title { color: var(--color-text-primary); text-decoration: none; }
.post-card-title:hover { color: var(--color-accent); text-decoration: underline; }
.post-card-description { display: -webkit-box; overflow: hidden; margin: 0; color: var(--color-text-secondary); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.category-link { color: var(--color-accent); font-family: var(--font-mono); font-size: 0.8125rem; text-decoration: none; }
.category-link:hover { text-decoration: underline; }
.tag-list { gap: 0.25rem 0.75rem; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.75rem; }
.tag-list li { white-space: nowrap; }
.tag-list a { color: inherit; text-decoration: none; }
.tag-list a:hover { color: var(--color-accent); text-decoration: underline; }
.archive-month { max-width: var(--reading-max); margin-block-end: 2rem; }
.archive-month h2 { margin: 0 0 0.5rem; font-size: 1.125rem; }
.archive-list { margin: 0; padding: 0; list-style: none; }
.archive-list li { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; padding-block: 0.5rem; border-bottom: 1px solid var(--color-border); }
.archive-list time { min-width: 8.5rem; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.8125rem; }
.category-list { gap: 0.5rem; }
.category-list a { display: inline-flex; min-height: 2.75rem; align-items: center; gap: 0.5rem; padding-inline: 0.875rem; border: 1px solid var(--color-border-strong); border-radius: var(--radius-control); background: var(--color-bg-surface); color: var(--color-text-primary); text-decoration: none; }
.category-list a:hover, .category-list a[aria-current="page"] { border-color: var(--color-accent); color: var(--color-accent); }
.category-list .muted { font-family: var(--font-mono); font-size: 0.75rem; }

.breadcrumbs { margin-block-end: 1.5rem; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.75rem; }
.breadcrumbs ol { gap: 0.4rem; }
.breadcrumbs li { display: flex; gap: 0.4rem; }
.breadcrumbs a { color: inherit; }
.page-intro { max-width: var(--reading-max); margin-block-end: 2rem; }
.page-intro h1, .post-header h1 { margin: 0 0 0.5rem; font-size: clamp(1.75rem, 4vw, 2.125rem); line-height: 1.3; }
.page-intro p { margin: 0; }
.empty-state { max-width: var(--reading-max); padding: 1.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-bg-surface); }
.empty-state :is(h1, h2) { margin-block-start: 0; font-size: 1.25rem; }

.post-header { margin-block-end: 2rem; }
.post-header h1 { margin-block-start: 0.5rem; }
.post-description { margin: 0 0 1rem; color: var(--color-text-secondary); font-size: 1.125rem; }
.post-meta { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.8125rem; }
.post-header .tag-list { margin-block-start: 0.75rem; }
/* 글 상세: 제목 → 목차 → 본문 순서. 좁은 화면은 한 열, 넓은 화면은 목차를 본문 왼쪽에 붙인다. */
.article-layout { display: grid; grid-template-columns: minmax(0, var(--reading-max)); }
.article-layout > * { min-width: 0; }
.post-toc { margin-block-end: 2rem; padding: 1rem 1.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-bg-surface); font-size: 0.875rem; }
.post-toc h2 { margin: 0 0 0.5rem; font-size: 0.875rem; }
.post-toc ol { margin: 0; padding-inline-start: 1.1rem; }
.post-toc a { color: var(--color-text-secondary); text-decoration: none; }
.post-toc a:hover { color: var(--color-accent); text-decoration: underline; }

.post-body { overflow-wrap: anywhere; font-size: 1rem; line-height: 1.75; }
.post-body > :first-child { margin-block-start: 0; }
.post-body p, .post-body ul, .post-body ol { margin-block: 0.75rem; }
.post-body ul, .post-body ol { padding-inline-start: 1.5rem; }
.post-body li + li { margin-block-start: 0.25rem; }
.post-body a { color: var(--color-accent); text-decoration: underline; text-underline-offset: 0.2em; }
.post-body h2, .post-body h3, .post-body h4 { line-height: 1.3; text-wrap: balance; }
.post-body h2 { margin-block: 2.5rem 0.75rem; font-size: clamp(1.55rem, 3vw, 1.9rem); }
.post-body h3 { margin-block: 2rem 0.75rem; font-size: clamp(1.3rem, 2.5vw, 1.55rem); }
.post-body h4 { margin-block: 1.5rem 0.5rem; font-size: clamp(1.18rem, 2vw, 1.3rem); }
.post-body code { font-family: var(--font-mono); font-size: 0.875em; }
.post-body :not(pre) > code { padding: 0.1em 0.3em; border-radius: 4px; background: var(--color-bg-canvas); }
.post-body pre { max-width: 100%; overflow-x: auto; padding: 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-bg-canvas); line-height: 1.6; }
.post-body blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid var(--color-border-strong); color: var(--color-text-secondary); }
.post-body hr { margin-block: 2rem; border: 0; border-top: 1px solid var(--color-border); }
.post-body img { display: block; max-width: 100%; height: auto; margin: 1.5rem auto; border-radius: var(--radius-control); }
.post-body figure { margin: 1.5rem 0; }
.post-body figcaption { margin-block-start: 0.5rem; color: var(--color-text-secondary); font-size: 0.875rem; text-align: center; }
.post-body input[type="checkbox"] { width: 1rem; height: 1rem; margin-inline: 0 0.5rem; accent-color: var(--color-accent); }
.post-body .notion-table-wrap { max-width: 100%; margin-block: 1.5rem; overflow-x: auto; }
.post-body table { width: 100%; min-width: 28rem; border-collapse: collapse; font-size: 0.9375rem; }
.post-body th, .post-body td { padding: 0.5rem 0.75rem; border: 1px solid var(--color-border); text-align: start; vertical-align: top; }
.post-body th { background: var(--color-bg-canvas); font-weight: 600; }
.post-body .notion-equation { max-width: 100%; margin-block: 1.25rem; padding: 0.75rem 1rem; overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-control); text-align: center; }
.post-body .notion-resource-card { display: grid; gap: 0.2rem; margin-block: 0.75rem; padding: 0.75rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-bg-surface); color: var(--color-text-primary); text-decoration: none; }
.post-body a.notion-resource-card:hover { border-color: var(--color-accent); }
.post-body .notion-resource-label { color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.75rem; }
.post-body details { margin-block: 1rem; padding: 0.5rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-control); }
.post-body summary { min-height: 2.75rem; align-content: center; cursor: pointer; font-weight: 600; }
.post-navigation { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-block-start: 3rem; padding-block-start: 1.5rem; border-top: 1px solid var(--color-border); }
.post-navigation a { display: block; padding-block: 0.5rem; text-decoration: none; }
.post-navigation small { display: block; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.75rem; }
.post-navigation .next { text-align: end; }
.home-link { margin-block: 2rem 0; }

@media (min-width: 37.5rem) {
  .site-header-inner, .site-main, .site-footer-inner { width: min(var(--shell-max), calc(100% - 4rem)); }
}
@media (min-width: 64rem) {
  .article-layout.with-toc { grid-template-columns: var(--toc-width) minmax(0, var(--reading-max)); column-gap: 3rem; align-items: start; }
  .article-layout.with-toc > .post-header, .article-layout.with-toc > .article-main { grid-column: 2; }
  .article-layout.with-toc > .post-toc { position: sticky; top: 1.5rem; grid-column: 1; grid-row: 2; max-height: calc(100vh - 3rem); margin: 0; overflow-y: auto; }
  .article-layout.with-toc > .article-main { grid-row: 2; }
}
@media (max-width: 37.4375rem) {
  .post-navigation { grid-template-columns: 1fr; }
  .post-navigation .next { text-align: start; }
}
@media (prefers-reduced-motion: reduce) {
  .post-card { transition: none; }
}
@media (prefers-contrast: more) {
  .post-card, .category-list a, .post-toc, .empty-state { border-color: var(--color-text-primary); }
}
`;
