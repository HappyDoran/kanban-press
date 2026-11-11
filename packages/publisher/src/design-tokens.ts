// 디자인 토큰의 정본(디자인 기획 2.4·10절, 교정쇄 × 원고지).
// 블로그 template의 BaseLayout과 게시 앱의 layout이 이 문자열을 그대로 `:root`에 넣는다.
// 글꼴 토큰(--font-*)은 쓰는 쪽이 정의한다(앱은 next/font, 블로그는 시스템 글꼴).
export const DESIGN_TOKENS_CSS = `:root {
  --color-bg-canvas: #ffffff;
  --color-bg-surface: #ffffff;
  --color-bg-column: #f3f8fc;
  --color-bg-selected: #e6f1fa;
  --color-text-primary: #16181d;
  --color-text-secondary: #586070;
  --color-border: #cdd3db;
  --color-border-strong: #16181d;
  --color-accent: #16181d;
  --color-accent-hover: #3a3f4a;
  --color-guide: #8ec3ea;
  --color-guide-soft: #e6f1fa;
  --color-guide-text: #2f6e9e;
  --color-proof: #c2185b;
  --color-focus: #2f6e9e;
  --color-success: #1a7a43;
  --color-danger: #a3161a;
  --color-warning-bg: #fff4d6;
  --radius-control: 0;
  --radius-card: 0;
  --radius-column: 0;
  --shadow-dialog: 0 16px 48px rgb(22 24 29 / 18%);
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --shell-max: 76rem;
  --reading-max: 45rem;
  --toc-width: 13.75rem;
}`;
