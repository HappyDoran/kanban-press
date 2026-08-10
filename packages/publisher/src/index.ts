import type { ContentItemId } from "@notion-kanban-blog/domain";

export {
  createMarkdownArtifact,
  type PublishBlock,
  type PublishDocument,
  type PublishRichText,
} from "./markdown.js";

const ASTRO_VERSION = "7.1.1";
const encoder = new TextEncoder();
const githubNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

export interface AstroTemplateTarget {
  defaultBranch: string;
  owner: string;
  repository: string;
}

export interface PublisherManifest {
  artifacts: readonly PublishArtifact[];
  basePath: string;
  contentDirectory: "src/content/blog";
  publisher: "astro";
  schemaVersion: 1;
  siteUrl: string;
  templateVersion: 2;
}

export interface PublishSource {
  contentItemId: ContentItemId;
  markdown: string;
  slug: string;
  version: number;
}

export interface PublishArtifact {
  bytes: Uint8Array;
  path: string;
}

export interface ContentPublisher {
  createArtifacts(
    manifest: PublisherManifest,
    source: PublishSource,
  ): Promise<readonly PublishArtifact[]>;
}

export function createAstroTemplateManifest(
  target: AstroTemplateTarget,
): PublisherManifest {
  const owner = parseGitHubName(target.owner, "owner");
  const repository = parseGitHubName(target.repository, "repository");
  const defaultBranch = parseDefaultBranch(target.defaultBranch);
  const userSite = repository.toLowerCase() === `${owner.toLowerCase()}.github.io`;
  const siteUrl = `https://${owner}.github.io`;
  const basePath = userSite ? "/" : `/${repository}`;
  const artifacts = Object.entries(
    templateFiles({ basePath, defaultBranch, siteUrl }),
  )
    .map(([path, content]) => artifact(path, content))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    artifacts,
    basePath,
    contentDirectory: "src/content/blog",
    publisher: "astro",
    schemaVersion: 1,
    siteUrl,
    templateVersion: 2,
  };
}

function templateFiles({
  basePath,
  defaultBranch,
  siteUrl,
}: {
  basePath: string;
  defaultBranch: string;
  siteUrl: string;
}): Readonly<Record<string, string>> {
  const linkBase = basePath === "/" ? "/" : `${basePath}/`;
  return {
    ".github/workflows/deploy.yml": `name: Deploy to GitHub Pages

on:
  push:
    branches: [${JSON.stringify(defaultBranch)}]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false
      - name: Setup pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 11.15.0
      - name: Install dependencies
        run: pnpm install --no-frozen-lockfile
      - name: Build site
        run: pnpm run build
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v5
        with:
          path: ./dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
`,
    ".gitignore": `node_modules
dist
.astro
`,
    ".notion-kanban-blog/managed.json": `${JSON.stringify(
      { publisher: "astro", templateVersion: 2 },
      null,
      2,
    )}\n`,
    "astro.config.mjs": `import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  site: ${JSON.stringify(siteUrl)},
  base: ${JSON.stringify(basePath)},
  image: { service: passthroughImageService() },
  output: "static",
});
`,
    "package.json": `${JSON.stringify(
      {
        dependencies: { astro: ASTRO_VERSION },
        name: "notion-kanban-blog-site",
        packageManager: "pnpm@11.15.0",
        private: true,
        scripts: { build: "astro build" },
        type: "module",
      },
      null,
      2,
    )}\n`,
    "pnpm-workspace.yaml": `allowBuilds:
  esbuild: true
`,
    "src/content.config.ts": `import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const fields = {
  description: z.string().default(""),
  publishedAt: z.coerce.date(),
  title: z.string(),
  updatedAt: z.coerce.date(),
};

const v1 = z
  .object({
    ...fields,
    schemaVersion: z.undefined().optional(),
  })
  .transform((post) => ({
    ...post,
    category: "미분류",
    categorySlug: "uncategorized",
    schemaVersion: 1 as const,
    tags: [] as string[],
  }));

const tag = z.string().trim().min(1).max(40);
const v2 = z
  .object({
    ...fields,
    category: z.string().trim().min(1).max(80),
    categorySlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    schemaVersion: z.literal(2),
    tags: z
      .array(tag)
      .max(10)
      .superRefine((tags, context) => {
        const seen = new Set<string>();
        for (const [index, value] of tags.entries()) {
          const normalized = value
            .normalize("NFKC")
            .trim()
            .replace(/\\s+/gu, " ")
            .toLowerCase();
          if (seen.has(normalized)) {
            context.addIssue({
              code: "custom",
              message: "Tags must be unique after normalization",
              path: [index],
            });
          }
          seen.add(normalized);
        }
      }),
  })
  .strict();

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
  schema: z.union([v1, v2]),
});

export const collections = { blog };
`,
    "src/content/blog/.gitkeep": "",
    "src/components/Breadcrumbs.astro": `---
interface BreadcrumbItem {
  href?: string;
  label: string;
}

interface Props {
  items: readonly BreadcrumbItem[];
}

const { items } = Astro.props;
---
<nav class="breadcrumbs" aria-label="현재 위치">
  <ol>
    {items.map((item, index) => (
      <li>
        {item.href === undefined ? (
          <span aria-current="page">{item.label}</span>
        ) : (
          <a href={item.href}>{item.label}</a>
        )}
        {index < items.length - 1 && <span aria-hidden="true">/</span>}
      </li>
    ))}
  </ol>
</nav>
`,
    "src/components/PostCard.astro": `---
import type { CollectionEntry } from "astro:content";
import { formatDate, pathFor } from "../lib/blog";

interface Props {
  headingLevel?: "h2" | "h3";
  post: CollectionEntry<"blog">;
}

const { headingLevel = "h2", post } = Astro.props;
const Heading = headingLevel;
const visibleTags = post.data.tags.slice(0, 3);
const remainingTagCount = post.data.tags.length - visibleTags.length;
---
<article class="post-card">
  <a class="category-link" href={pathFor("categories/" + post.data.categorySlug + "/")}>
    {post.data.category}
  </a>
  <Heading><a class="post-card-title" href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a></Heading>
  {post.data.description && <p class="post-card-description">{post.data.description}</p>}
  <div class="post-card-meta">
    <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time>
    {visibleTags.length > 0 && (
      <ul class="tag-list" aria-label="태그">
        {visibleTags.map((tag) => <li>#{tag}</li>)}
        {remainingTagCount > 0 && <li aria-label={"태그 " + remainingTagCount + "개 더 있음"}>+{remainingTagCount}</li>}
      </ul>
    )}
  </div>
</article>
`,
    "src/lib/blog.ts": `import type { CollectionEntry } from "astro:content";

export const base = ${JSON.stringify(linkBase)};

export type BlogPost = CollectionEntry<"blog">;

export interface BlogCategory {
  count: number;
  name: string;
  posts: readonly BlogPost[];
  slug: string;
}

export function pathFor(path = ""): string {
  return base + path.replace(/^\\/+/, "");
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortPosts(posts: readonly BlogPost[]): BlogPost[] {
  return [...posts].sort((left, right) => {
    const byDate = right.data.publishedAt.valueOf() - left.data.publishedAt.valueOf();
    return byDate === 0 ? compareText(left.id, right.id) : byDate;
  });
}

export function categoriesFor(posts: readonly BlogPost[]): BlogCategory[] {
  const grouped = new Map<string, { name: string; posts: BlogPost[] }>();
  for (const post of sortPosts(posts)) {
    const existing = grouped.get(post.data.categorySlug);
    if (existing === undefined) {
      grouped.set(post.data.categorySlug, {
        name: post.data.category,
        posts: [post],
      });
    } else {
      existing.posts.push(post);
    }
  }

  return [...grouped.entries()]
    .map(([slug, category]) => ({
      count: category.posts.length,
      name: category.name,
      posts: category.posts,
      slug,
    }))
    .sort((left, right) =>
      right.count - left.count ||
      compareText(left.name, right.name) ||
      compareText(left.slug, right.slug),
    );
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function isDifferentDay(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) !== right.toISOString().slice(0, 10);
}
`,
    "src/layouts/BaseLayout.astro": `---
interface Props {
  description?: string;
  title: string;
}
const {
  description = "Notion에서 게시한 기록입니다.",
  title,
} = Astro.props;
import { base, pathFor } from "../lib/blog";

const pathname = Astro.url.pathname;
const section = pathname === base
  ? "home"
  : pathname.startsWith(pathFor("posts/"))
    ? "posts"
    : pathname.startsWith(pathFor("categories/"))
      ? "categories"
      : undefined;
---
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="description" content={description} />
    <title>{title === "Notion Blog" ? title : title + " · Notion Blog"}</title>
    <style is:global>
      :root {
        --color-bg-canvas: #f7f4ee;
        --color-bg-surface: #fffcf7;
        --color-bg-subtle: #efe9de;
        --color-text-primary: #211f1b;
        --color-text-secondary: #625c53;
        --color-border: #d9d2c6;
        --color-border-strong: #9b9285;
        --color-accent: #315c47;
        --color-accent-hover: #244736;
        --color-focus: #1769e0;
        --font-sans: Inter, Pretendard, system-ui, -apple-system, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        --shell-max: 70rem;
        --reading-max: 45rem;
        font-family: var(--font-sans);
        color: var(--color-text-primary);
        background: var(--color-bg-canvas);
      }
      * { box-sizing: border-box; }
      html { overflow-wrap: anywhere; }
      body { min-width: 20rem; margin: 0; line-height: 1.7; }
      a { color: var(--color-accent); text-underline-offset: 0.2em; }
      a:hover { color: var(--color-accent-hover); }
      a:focus-visible, summary:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
      h1, h2, h3, h4 { line-height: 1.2; text-wrap: balance; }
      h1 { font-size: clamp(2rem, 5vw, 3.25rem); }
      h2 { font-size: clamp(1.5rem, 3vw, 2rem); }
      img { max-width: 100%; height: auto; }
      code, pre { font-family: var(--font-mono); }
      pre { max-width: 100%; overflow-x: auto; padding: 1rem; border-radius: 0.375rem; background: var(--color-bg-subtle); }
      blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 0.25rem solid var(--color-border-strong); }
      .skip-link { position: fixed; z-index: 10; inset: 0 auto auto 0; padding: 0.75rem 1rem; transform: translateY(-120%); background: var(--color-text-primary); color: white; }
      .skip-link:focus { transform: translateY(0); }
      .site-header { border-bottom: 1px solid var(--color-border); }
      .site-header-inner, main, .site-footer-inner { width: min(var(--shell-max), calc(100% - 2.5rem)); margin-inline: auto; }
      .site-header-inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1.5rem; padding-block: 1rem; }
      .site-brand { color: var(--color-text-primary); font-size: 1.125rem; font-weight: 700; text-decoration: none; }
      .site-nav ul, .tag-list, .breadcrumbs ol, .category-list { display: flex; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
      .site-nav ul { gap: 0.25rem; }
      .site-nav a { display: inline-flex; min-height: 2.75rem; align-items: center; padding: 0.5rem 0.75rem; border-radius: 0.375rem; color: var(--color-text-primary); text-decoration: none; }
      .site-nav a:hover, .site-nav a[aria-current="page"] { background: var(--color-bg-subtle); color: var(--color-accent-hover); }
      main { min-height: 65vh; padding-block: 3rem 5rem; }
      .site-footer { border-top: 1px solid var(--color-border); color: var(--color-text-secondary); }
      .site-footer-inner { padding-block: 1.5rem; }
      .muted { color: var(--color-text-secondary); }
      .hero { max-width: var(--reading-max); margin-block-end: 3rem; }
      .hero p { max-width: 36rem; font-size: 1.125rem; color: var(--color-text-secondary); }
      .section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-block-end: 1.25rem; }
      .section-heading h2 { margin: 0; }
      .post-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 28rem), 1fr)); gap: 1rem; }
      .post-list { display: grid; gap: 1rem; }
      .post-card { min-width: 0; padding: 1.5rem; border: 1px solid var(--color-border); border-radius: 0.75rem; background: var(--color-bg-surface); transition: border-color 120ms cubic-bezier(.2,.8,.2,1); }
      .post-card:focus-within, .post-card:hover { border-color: var(--color-border-strong); }
      .post-card h2, .post-card h3 { margin-block: 0.5rem; }
      .post-card-title { color: var(--color-text-primary); text-decoration-thickness: 0.08em; }
      .post-card-description { display: -webkit-box; overflow: hidden; margin-block: 0.5rem 1rem; color: var(--color-text-secondary); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .post-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; color: var(--color-text-secondary); font-size: 0.875rem; }
      .category-link { font-size: 0.875rem; font-weight: 700; }
      .tag-list { gap: 0.35rem 0.75rem; }
      .tag-list li { white-space: nowrap; }
      .category-section { margin-block-start: 4rem; }
      .category-list { gap: 0.75rem; }
      .category-list a { display: inline-flex; min-height: 2.75rem; align-items: center; gap: 0.4rem; padding: 0.5rem 0.875rem; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-bg-surface); text-decoration: none; }
      .category-list a[aria-current="page"] { border-color: var(--color-accent); background: var(--color-bg-subtle); font-weight: 700; }
      .breadcrumbs { margin-block-end: 2rem; color: var(--color-text-secondary); font-size: 0.875rem; }
      .breadcrumbs ol { gap: 0.4rem; }
      .breadcrumbs li { display: flex; gap: 0.4rem; }
      .page-intro { max-width: var(--reading-max); margin-block-end: 2rem; }
      .page-intro h1 { margin-block-end: 0.5rem; }
      .empty-state { max-width: var(--reading-max); padding: 1.5rem; border: 1px solid var(--color-border); border-radius: 0.75rem; background: var(--color-bg-surface); }
      .empty-state h2 { margin-block-start: 0; }
      .post-header, .post-body, .post-navigation, .post-toc { width: min(100%, var(--reading-max)); margin-inline: auto; }
      .post-header { margin-block-end: 2.5rem; }
      .post-header h1 { margin-block: 0.5rem; }
      .post-description { font-size: 1.125rem; color: var(--color-text-secondary); }
      .post-meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: var(--color-text-secondary); }
      .post-header .tag-list { margin-block-start: 1rem; }
      .post-toc { margin-block-end: 2.5rem; padding: 1.25rem 1.5rem; border: 1px solid var(--color-border); border-radius: 0.75rem; background: var(--color-bg-surface); }
      .post-toc h2 { margin-block-start: 0; font-size: 1.25rem; }
      .post-toc ol { margin-block-end: 0; }
      .post-body { font-size: 1.125rem; line-height: 1.75; }
      .post-body a { text-decoration: underline; }
      .post-body h2 { margin-block-start: 3rem; }
      .post-body details { margin-block: 1rem; padding: 0.75rem 1rem; border: 1px solid var(--color-border); border-radius: 0.375rem; }
      .post-body summary { min-height: 2.75rem; cursor: pointer; font-weight: 700; }
      .post-navigation { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-block-start: 4rem; padding-block-start: 1.5rem; border-top: 1px solid var(--color-border); }
      .post-navigation a { padding-block: 0.75rem; }
      .post-navigation .next { text-align: end; }
      .home-link { width: min(100%, var(--reading-max)); margin: 2rem auto 0; }
      @media (min-width: 37.5rem) {
        .site-header-inner, main, .site-footer-inner { width: min(var(--shell-max), calc(100% - 4rem)); }
      }
      @media (max-width: 31.25rem) {
        .site-header-inner { align-items: flex-start; flex-direction: column; }
        .post-navigation { grid-template-columns: 1fr; }
        .post-navigation .next { text-align: start; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
      }
      @media (prefers-contrast: more) {
        .post-card, .category-list a, .post-toc, .empty-state { border-color: var(--color-text-primary); }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header class="site-header">
      <div class="site-header-inner">
        <a class="site-brand" href={base}>Notion Blog</a>
        <nav class="site-nav" aria-label="주요 탐색">
          <ul>
            <li><a href={base} aria-current={section === "home" ? "page" : undefined}>홈</a></li>
            <li><a href={pathFor("posts/")} aria-current={section === "posts" ? "page" : undefined}>전체 글</a></li>
            <li><a href={pathFor("categories/")} aria-current={section === "categories" ? "page" : undefined}>카테고리</a></li>
          </ul>
        </nav>
      </div>
    </header>
    <main id="main-content"><slot /></main>
    <footer class="site-footer">
      <div class="site-footer-inner">© Notion Blog · GitHub Pages로 게시됨</div>
    </footer>
  </body>
</html>
`,
    "src/pages/index.astro": `---
import { getCollection } from "astro:content";
import PostCard from "../components/PostCard.astro";
import BaseLayout from "../layouts/BaseLayout.astro";
import { categoriesFor, pathFor, sortPosts } from "../lib/blog";

const posts = sortPosts(await getCollection("blog"));
const latestPosts = posts.slice(0, 12);
const categories = categoriesFor(posts);
---
<BaseLayout title="Notion Blog">
  <section class="hero">
    <h1>Notion Blog</h1>
    <p>Notion에서 작성하고 GitHub Pages에 차분히 쌓아가는 기록입니다.</p>
  </section>
  {posts.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 게시된 글이 없습니다</h2>
      <p>새 글이 게시되면 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <>
      <section aria-labelledby="latest-posts-title">
        <div class="section-heading">
          <h2 id="latest-posts-title">최신 글</h2>
          <a href={pathFor("posts/")}>전체 글 보기</a>
        </div>
        <div class="post-grid">
          {latestPosts.map((post) => <PostCard headingLevel="h3" post={post} />)}
        </div>
      </section>
      <section class="category-section" aria-labelledby="categories-title">
        <div class="section-heading">
          <h2 id="categories-title">카테고리</h2>
          <a href={pathFor("categories/")}>모든 카테고리 보기</a>
        </div>
        <ul class="category-list">
          {categories.map((category) => (
            <li>
              <a href={pathFor("categories/" + category.slug + "/")}>
                <span>{category.name}</span>
                <span class="muted">글 {category.count}개</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  )}
</BaseLayout>
`,
    "src/pages/posts/index.astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import PostCard from "../../components/PostCard.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, sortPosts } from "../../lib/blog";

const posts = sortPosts(await getCollection("blog"));
---
<BaseLayout description="게시된 모든 글을 최신순으로 봅니다." title="전체 글">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "전체 글" }]} />
  <header class="page-intro">
    <h1>전체 글</h1>
    <p class="muted">글 {posts.length}개 · 최신순</p>
  </header>
  {posts.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 게시된 글이 없습니다</h2>
      <p>새 글이 게시되면 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <div class="post-list">{posts.map((post) => <PostCard post={post} />)}</div>
  )}
</BaseLayout>
`,
    "src/pages/categories/index.astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, categoriesFor, pathFor } from "../../lib/blog";

const categories = categoriesFor(await getCollection("blog"));
---
<BaseLayout description="게시된 글을 카테고리별로 찾아봅니다." title="카테고리">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "카테고리" }]} />
  <header class="page-intro">
    <h1>카테고리</h1>
    <p class="muted">큰 주제별로 글을 둘러보세요.</p>
  </header>
  {categories.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 카테고리가 없습니다</h2>
      <p>글이 게시되면 카테고리가 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <ul class="category-list">
      {categories.map((category) => (
        <li>
          <a href={pathFor("categories/" + category.slug + "/")}>
            <span>{category.name}</span>
            <span class="muted">글 {category.count}개</span>
          </a>
        </li>
      ))}
    </ul>
  )}
</BaseLayout>
`,
    "src/pages/categories/[slug].astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import PostCard from "../../components/PostCard.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, categoriesFor, pathFor } from "../../lib/blog";

export async function getStaticPaths() {
  const categories = categoriesFor(await getCollection("blog"));
  return categories.map((category) => ({
    params: { slug: category.slug },
    props: { categories, category },
  }));
}

const { categories, category } = Astro.props;
---
<BaseLayout description={category.name + " 카테고리의 글입니다."} title={category.name}>
  <Breadcrumbs items={[{ href: base, label: "홈" }, { href: pathFor("categories/"), label: "카테고리" }, { label: category.name }]} />
  <header class="page-intro">
    <h1>{category.name}</h1>
    <p class="muted">글 {category.count}개</p>
  </header>
  <nav aria-label="카테고리 전환">
    <ul class="category-list">
      {categories.map((item) => (
        <li>
          <a href={pathFor("categories/" + item.slug + "/")} aria-current={item.slug === category.slug ? "page" : undefined}>
            {item.name} <span class="muted">{item.count}</span>
          </a>
        </li>
      ))}
    </ul>
  </nav>
  <div class="post-list category-section">
    {category.posts.map((post) => <PostCard post={post} />)}
  </div>
</BaseLayout>
`,
    "src/pages/posts/[...slug].astro": `---
import { getCollection, render } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, formatDate, isDifferentDay, pathFor, sortPosts } from "../../lib/blog";

export async function getStaticPaths() {
  const posts = sortPosts(await getCollection("blog"));
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { allPosts: posts, post },
  }));
}

const { allPosts, post } = Astro.props;
const { Content, headings } = await render(post);
const sectionHeadings = headings.filter((heading) => heading.depth === 2);
const categoryPosts = allPosts.filter((candidate) => candidate.data.categorySlug === post.data.categorySlug);
const currentIndex = categoryPosts.findIndex((candidate) => candidate.id === post.id);
const previousPost = currentIndex > 0 ? categoryPosts[currentIndex - 1] : undefined;
const nextPost = currentIndex < categoryPosts.length - 1 ? categoryPosts[currentIndex + 1] : undefined;
---
<BaseLayout description={post.data.description} title={post.data.title}>
  <Breadcrumbs items={[
    { href: base, label: "홈" },
    { href: pathFor("categories/" + post.data.categorySlug + "/"), label: post.data.category },
    { label: post.data.title },
  ]} />
  <article>
    <header class="post-header">
      <a class="category-link" href={pathFor("categories/" + post.data.categorySlug + "/")}>{post.data.category}</a>
      <h1>{post.data.title}</h1>
      {post.data.description && <p class="post-description">{post.data.description}</p>}
      <div class="post-meta">
        <span>게시 <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time></span>
        {isDifferentDay(post.data.publishedAt, post.data.updatedAt) && (
          <span>수정 <time datetime={post.data.updatedAt.toISOString()}>{formatDate(post.data.updatedAt)}</time></span>
        )}
      </div>
      {post.data.tags.length > 0 && (
        <ul class="tag-list" aria-label="태그">
          {post.data.tags.map((tag) => <li>#{tag}</li>)}
        </ul>
      )}
    </header>
    {sectionHeadings.length >= 3 && (
      <nav class="post-toc" aria-labelledby="toc-title">
        <h2 id="toc-title">목차</h2>
        <ol>{sectionHeadings.map((heading) => <li><a href={"#" + heading.slug}>{heading.text}</a></li>)}</ol>
      </nav>
    )}
    <div class="post-body"><Content /></div>
  </article>
  {(previousPost !== undefined || nextPost !== undefined) && (
    <nav class="post-navigation" aria-label="같은 카테고리의 이전 및 다음 글">
      <div>{previousPost && <a href={pathFor("posts/" + previousPost.id + "/")}>← 이전 글<br /><strong>{previousPost.data.title}</strong></a>}</div>
      <div class="next">{nextPost && <a href={pathFor("posts/" + nextPost.id + "/")}>다음 글 →<br /><strong>{nextPost.data.title}</strong></a>}</div>
    </nav>
  )}
  <p class="home-link"><a href={base}>홈으로</a></p>
</BaseLayout>
`,
    "src/pages/404.astro": `---
import { getCollection } from "astro:content";
import BaseLayout from "../layouts/BaseLayout.astro";
import { base, pathFor, sortPosts } from "../lib/blog";

const latestPosts = sortPosts(await getCollection("blog")).slice(0, 3);
---
<BaseLayout description="요청한 페이지를 찾을 수 없습니다." title="페이지를 찾을 수 없습니다">
  <section class="empty-state" aria-labelledby="not-found-title">
    <h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
    <p>주소가 바뀌었거나 글이 없습니다.</p>
    <p><a href={base}>홈으로 돌아가기</a></p>
  </section>
  {latestPosts.length > 0 && (
    <section class="category-section" aria-labelledby="latest-title">
      <h2 id="latest-title">최신 글</h2>
      <ul>
        {latestPosts.map((post) => <li><a href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a></li>)}
      </ul>
    </section>
  )}
</BaseLayout>
`,
    "tsconfig.json": `${JSON.stringify(
      { extends: "astro/tsconfigs/strict" },
      null,
      2,
    )}\n`,
  };
}

function parseGitHubName(value: string, field: string): string {
  const parsed = value.trim();
  if (!githubNamePattern.test(parsed)) {
    throw new Error(`Invalid GitHub ${field}`);
  }
  return parsed;
}

function parseDefaultBranch(value: string): string {
  const byteLength = encoder.encode(value).byteLength;
  const segments = value.split("/");
  const hasInvalidSegment = segments.some(
    (segment) =>
      segment.length === 0 ||
      segment.startsWith(".") ||
      segment.endsWith(".lock"),
  );
  const hasForbiddenCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 32 ||
      codePoint === 127 ||
      ["~", "^", ":", "?", "*", "["].includes(character)
    );
  });
  if (
    byteLength === 0 ||
    byteLength > 255 ||
    value === "@" ||
    value.startsWith("-") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("\\") ||
    hasForbiddenCharacter ||
    hasInvalidSegment
  ) {
    throw new Error("Invalid GitHub default branch");
  }
  return value;
}

function artifact(path: string, content: string): PublishArtifact {
  if (
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Artifact path must stay inside the repository");
  }
  return { bytes: encoder.encode(content), path };
}
