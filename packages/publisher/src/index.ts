export {
  createMarkdownArtifact,
  type PublishBlock,
  type PublishBlockWith,
  type PublishDocument,
  type PublishRichText,
} from "./markdown.js";
export { BLOG_CSS } from "./blog-css.js";

import { BLOG_CSS } from "./blog-css.js";

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

export interface PublishArtifact {
  bytes: Uint8Array;
  path: string;
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
    templateFiles({ basePath, defaultBranch, owner, siteUrl }),
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
  owner,
  siteUrl,
}: {
  basePath: string;
  defaultBranch: string;
  owner: string;
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
  markdown: { shikiConfig: { theme: "github-light" } },
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
    pinned: false,
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
    pinned: z.boolean().default(false),
    schemaVersion: z.literal(2),
    series: z.string().trim().min(1).max(80).optional(),
    seriesOrder: z.number().finite().optional(),
    seriesSlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
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
import { formatDate, pathFor, tagSlug } from "../lib/blog";

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
  <div class="post-card-meta">
    <a class="category-link" href={pathFor("categories/" + post.data.categorySlug + "/")}>{post.data.category}</a>
    <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time>
  </div>
  <Heading><a class="post-card-title" href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a></Heading>
  {post.data.description && <p class="post-card-description">{post.data.description}</p>}
  {visibleTags.length > 0 && (
    <ul class="tag-list" aria-label="태그">
      {visibleTags.map((tag) => <li><a href={pathFor("tags/" + tagSlug(tag) + "/")}>#{tag}</a></li>)}
      {remainingTagCount > 0 && <li aria-label={"태그 " + remainingTagCount + "개 더 있음"}>+{remainingTagCount}</li>}
    </ul>
  )}
</article>
`,
    "src/lib/blog.ts": `import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CollectionEntry } from "astro:content";

export const base = ${JSON.stringify(linkBase)};
export const siteOwner = ${JSON.stringify(owner)};

export interface SiteSettings {
  description: string;
  links: { label: string; url: string }[];
  title: string;
}

/**
 * 게시 앱이 저장한 사이트 설정(.notion-kanban-blog/site.json, R11). 빌드는 저장소 루트에서 실행된다.
 * 파일이 없거나 값이 틀리면 그 항목만 기본값을 쓴다.
 */
export const site: SiteSettings = readSiteSettings();

function readSiteSettings(): SiteSettings {
  const fallback: SiteSettings = {
    description: "Notion에서 쓰고 GitHub Pages에 쌓아 가는 개발 기록입니다.",
    links: [],
    title: siteOwner + ".log",
  };
  const path = join(process.cwd(), ".notion-kanban-blog", "site.json");
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Record<keyof SiteSettings, unknown>>;
    const text = (input: unknown, max: number) => (typeof input === "string" ? input.trim().slice(0, max) : "");
    const links = Array.isArray(value.links) ? value.links : [];
    return {
      description: typeof value.description === "string" ? text(value.description, 200) : fallback.description,
      links: links
        .map((link: { label?: unknown; url?: unknown }) => ({ label: text(link?.label, 20), url: text(link?.url, 300) }))
        .filter((link) => link.label !== "" && link.url.startsWith("https://"))
        .slice(0, 4),
      title: text(value.title, 40) || fallback.title,
    };
  } catch {
    return fallback;
  }
}

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

export interface BlogTag {
  count: number;
  name: string;
  posts: readonly BlogPost[];
  slug: string;
}

/** 태그 주소. 카테고리 slug와 같은 규칙(영문·숫자 부분 + 정규화한 이름의 hash 8자)이라 한글 태그도 안정적이다. */
export function tagSlug(name: string): string {
  const normalized = name.normalize("NFKC").trim().replace(/\\s+/gu, " ").toLowerCase();
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 8);
  const ascii = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  return ascii ? ascii + "-" + hash : "tag-" + hash;
}

export function tagsFor(posts: readonly BlogPost[]): BlogTag[] {
  const grouped = new Map<string, { name: string; posts: BlogPost[] }>();
  for (const post of sortPosts(posts)) {
    for (const name of post.data.tags) {
      const slug = tagSlug(name);
      const existing = grouped.get(slug);
      if (existing === undefined) {
        grouped.set(slug, { name, posts: [post] });
      } else if (!existing.posts.includes(post)) {
        existing.posts.push(post);
      }
    }
  }
  return [...grouped.entries()]
    .map(([slug, tag]) => ({ count: tag.posts.length, name: tag.name, posts: tag.posts, slug }))
    .sort((left, right) => right.count - left.count || compareText(left.name, right.name));
}

export interface BlogSeries {
  name: string;
  posts: readonly BlogPost[];
  slug: string;
}

/** 시리즈(R10): seriesOrder가 작을수록 앞, 없으면 뒤에 두고 같으면 게시일이 이른 글이 앞이다. */
export function seriesFor(posts: readonly BlogPost[]): BlogSeries[] {
  const grouped = new Map<string, { name: string; posts: BlogPost[] }>();
  for (const post of posts) {
    const { series, seriesSlug } = post.data;
    if (series === undefined || seriesSlug === undefined) {
      continue;
    }
    const existing = grouped.get(seriesSlug) ?? { name: series, posts: [] };
    existing.posts.push(post);
    grouped.set(seriesSlug, existing);
  }
  const order = (post: BlogPost) => post.data.seriesOrder ?? Number.POSITIVE_INFINITY;
  return [...grouped.entries()]
    .map(([slug, series]) => ({
      name: series.name,
      posts: series.posts.sort(
        (left, right) =>
          order(left) - order(right) ||
          left.data.publishedAt.valueOf() - right.data.publishedAt.valueOf() ||
          compareText(left.id, right.id),
      ),
      slug,
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

/** 게시일(UTC) 기준 연·월 묶음. 최근 달이 먼저다. */
export function archiveFor(posts: readonly BlogPost[]): { label: string; month: string; posts: BlogPost[] }[] {
  const grouped = new Map<string, BlogPost[]>();
  for (const post of sortPosts(posts)) {
    const month = post.data.publishedAt.toISOString().slice(0, 7);
    grouped.set(month, [...(grouped.get(month) ?? []), post]);
  }
  return [...grouped.entries()].map(([month, monthPosts]) => ({
    label: Number(month.slice(0, 4)) + "년 " + Number(month.slice(5, 7)) + "월",
    month,
    posts: monthPosts,
  }));
}

/** base path를 포함한 절대 주소(RSS·sitemap·Open Graph용). */
export function absoluteUrl(path: string, site: URL | undefined): string {
  return new URL(pathFor(path), site).href;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
  type?: "article" | "website";
}
const {
  description = "Notion에서 게시한 기록입니다.",
  title,
  type = "website",
} = Astro.props;
import { base, pathFor, site, siteOwner } from "../lib/blog";

const siteName = site.title;
const githubUrl = "https://github.com/" + siteOwner;
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
    <meta name="theme-color" content="#ffffff" />
    <link rel="canonical" href={new URL(Astro.url.pathname, Astro.site)} />
    <title>{title === "홈" ? siteName : title + " · " + siteName}</title>
    <meta property="og:type" content={type} />
    <meta property="og:site_name" content={siteName} />
    <meta property="og:title" content={title === "홈" ? siteName : title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={new URL(Astro.url.pathname, Astro.site)} />
    <meta property="og:locale" content="ko_KR" />
    <meta name="twitter:card" content="summary" />
    <link rel="alternate" type="application/rss+xml" title={siteName} href={pathFor("rss.xml")} />
    <style is:global>
      :root {
        --color-bg-canvas: #f6f7f9;
        --color-bg-surface: #ffffff;
        --color-text-primary: #1c2230;
        --color-text-secondary: #5b6475;
        --color-border: #e3e6ec;
        --color-border-strong: #d5dae3;
        --color-accent: #2453c7;
        --color-accent-hover: #1a3d96;
        --color-focus: #2453c7;
        --font-sans: system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        --radius-control: 6px;
        --radius-card: 8px;
        --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
        --shell-max: 67.5rem;
        --reading-max: 45rem;
        --toc-width: 13.75rem;
        color: var(--color-text-primary);
        background: var(--color-bg-surface);
        font-family: var(--font-sans);
      }
      * { box-sizing: border-box; }
      html { overflow-wrap: anywhere; word-break: keep-all; }
      body { min-width: 20rem; margin: 0; line-height: 1.6; }
      a { color: var(--color-accent); text-underline-offset: 0.2em; }
      a:hover { color: var(--color-accent-hover); }
      a:focus-visible, summary:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
      h1, h2, h3, h4 { line-height: 1.3; }
      .skip-link { position: fixed; z-index: 10; inset: 0 auto auto 0; padding: 0.75rem 1rem; transform: translateY(-120%); background: var(--color-text-primary); color: #ffffff; }
      .skip-link:focus { transform: translateY(0); }
${BLOG_CSS}
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header class="site-header">
      <div class="site-header-inner">
        <a class="site-brand" href={base} aria-current={section === "home" ? "page" : undefined}>{siteName}</a>
        <nav class="site-nav" aria-label="주요 탐색">
          <ul>
            <li><a href={pathFor("posts/")} aria-current={section === "posts" ? "page" : undefined}>전체 글</a></li>
            <li><a href={pathFor("categories/")} aria-current={section === "categories" ? "page" : undefined}>주제</a></li>
            <li><a href={githubUrl} rel="me">GitHub</a></li>
          </ul>
        </nav>
      </div>
    </header>
    <main class="site-main" id="main-content"><slot /></main>
    <footer class="site-footer">
      <div class="site-footer-inner">
        <span>© {new Date().getUTCFullYear()} {siteOwner} · GitHub Pages로 게시됨</span>
        <span><a href={pathFor("series/")}>시리즈</a> · <a href={pathFor("archive/")}>보관함</a> · <a href={pathFor("tags/")}>태그</a> · <a href={pathFor("rss.xml")}>RSS</a></span>
      </div>
    </footer>
  </body>
</html>
`,
    "src/pages/index.astro": `---
import { getCollection } from "astro:content";
import PostCard from "../components/PostCard.astro";
import BaseLayout from "../layouts/BaseLayout.astro";
import { categoriesFor, pathFor, site, sortPosts } from "../lib/blog";

const posts = sortPosts(await getCollection("blog"));
// 고정 글(R10)은 최신 글 위에 따로 두고 최신 글에서는 뺀다.
const pinnedPosts = posts.filter((post) => post.data.pinned);
const latestPosts = posts.filter((post) => !post.data.pinned).slice(0, 12);
const categories = categoriesFor(posts);
---
<BaseLayout title="홈" description={site.description || undefined}>
  <section class="hero" aria-labelledby="site-title">
    <h1 id="site-title">{site.title}</h1>
    {site.description && <p>{site.description}</p>}
    {site.links.length > 0 && (
      <ul class="hero-links" aria-label="프로필 링크">
        {site.links.map((link) => <li><a href={link.url} rel="me">{link.label}</a></li>)}
      </ul>
    )}
    <dl class="hero-stats" aria-label="블로그 통계">
      <div><dt>글</dt><dd>{posts.length}</dd></div>
      <div><dt>주제</dt><dd>{categories.length}</dd></div>
    </dl>
  </section>
  {posts.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 게시된 글이 없습니다</h2>
      <p>새 글이 게시되면 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <>
      {pinnedPosts.length > 0 && (
        <section aria-labelledby="pinned-posts-title">
          <div class="section-heading">
            <h2 id="pinned-posts-title">고정 글</h2>
          </div>
          <div class="post-grid">
            {pinnedPosts.map((post) => <PostCard headingLevel="h3" post={post} />)}
          </div>
        </section>
      )}
      <section aria-labelledby="latest-posts-title">
        <div class="section-heading">
          <h2 id="latest-posts-title">최신 글</h2>
          <a href={pathFor("posts/")}>전체 글 보기</a>
        </div>
        <div class="post-grid">
          {latestPosts.map((post) => <PostCard headingLevel="h3" post={post} />)}
        </div>
      </section>
      <section aria-labelledby="categories-title">
        <div class="section-heading">
          <h2 id="categories-title">주제</h2>
        </div>
        <ul class="category-list">
          {categories.map((category) => (
            <li>
              <a href={pathFor("categories/" + category.slug + "/")}>
                <span>{category.name}</span>
                <span class="muted">{category.count}</span>
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
import { base, pathFor, sortPosts } from "../../lib/blog";

const posts = sortPosts(await getCollection("blog"));
---
<BaseLayout description="게시된 모든 글을 최신순으로 봅니다." title="전체 글">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "전체 글" }]} />
  <header class="page-intro">
    <h1>전체 글</h1>
    <p class="muted">글 {posts.length}개 · 최신순 · <a href={pathFor("archive/")}>연·월 보관함</a></p>
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
<BaseLayout description="게시된 글을 주제별로 찾아봅니다." title="주제">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "주제" }]} />
  <header class="page-intro">
    <h1>주제</h1>
    <p class="muted">주제 {categories.length}개 · <a href={pathFor("tags/")}>태그 전체 보기</a></p>
  </header>
  {categories.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 주제가 없습니다</h2>
      <p>글이 게시되면 주제가 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <ul class="category-list">
      {categories.map((category) => (
        <li>
          <a href={pathFor("categories/" + category.slug + "/")}>
            <span>{category.name}</span>
            <span class="muted">{category.count}</span>
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
  <Breadcrumbs items={[{ href: base, label: "홈" }, { href: pathFor("categories/"), label: "주제" }, { label: category.name }]} />
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
  <div class="section-heading"><h2>글</h2></div>
  <div class="post-list">
    {category.posts.map((post) => <PostCard headingLevel="h3" post={post} />)}
  </div>
</BaseLayout>
`,
    "src/pages/posts/[...slug].astro": `---
import { getCollection, render } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, formatDate, isDifferentDay, pathFor, seriesFor, sortPosts, tagSlug } from "../../lib/blog";

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
// 시리즈 글은 시리즈 순서로, 아니면 같은 카테고리의 게시일 순으로 이전·다음 글을 고른다.
const series = seriesFor(allPosts).find((candidate) => candidate.slug === post.data.seriesSlug);
const sequence = series?.posts ?? allPosts.filter((candidate) => candidate.data.categorySlug === post.data.categorySlug);
const currentIndex = sequence.findIndex((candidate) => candidate.id === post.id);
const previousPost = currentIndex > 0 ? sequence[currentIndex - 1] : undefined;
const nextPost = currentIndex < sequence.length - 1 ? sequence[currentIndex + 1] : undefined;
---
<BaseLayout description={post.data.description} title={post.data.title} type="article">
  <Breadcrumbs items={[
    { href: base, label: "홈" },
    { href: pathFor("categories/" + post.data.categorySlug + "/"), label: post.data.category },
    { label: post.data.title },
  ]} />
  <article class:list={["article-layout", sectionHeadings.length >= 3 ? "with-toc" : "without-toc"]}>
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
          {post.data.tags.map((tag) => <li><a href={pathFor("tags/" + tagSlug(tag) + "/")}>#{tag}</a></li>)}
        </ul>
      )}
    </header>
    {sectionHeadings.length >= 3 && (
      <nav class="post-toc" aria-labelledby="toc-title">
        <h2 id="toc-title">목차</h2>
        <ol>{sectionHeadings.map((heading) => <li><a href={"#" + heading.slug}>{heading.text}</a></li>)}</ol>
      </nav>
    )}
    <div class="article-main">
      {series !== undefined && (
        <nav class="series-nav" aria-labelledby="series-title">
          <h2 id="series-title"><a href={pathFor("series/" + series.slug + "/")}>시리즈 · {series.name}</a> <span class="muted">{currentIndex + 1}/{series.posts.length}</span></h2>
          <ol>
            {series.posts.map((item) => (
              <li>
                {item.id === post.id ? (
                  <span aria-current="page">{item.data.title}</span>
                ) : (
                  <a href={pathFor("posts/" + item.id + "/")}>{item.data.title}</a>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div class="post-body"><Content /></div>
      {(previousPost !== undefined || nextPost !== undefined) && (
        <nav class="post-navigation" aria-label={series === undefined ? "같은 카테고리의 이전 및 다음 글" : "같은 시리즈의 이전 및 다음 글"}>
          <div>{previousPost && <a href={pathFor("posts/" + previousPost.id + "/")}><small>← 이전 글</small>{previousPost.data.title}</a>}</div>
          <div class="next">{nextPost && <a href={pathFor("posts/" + nextPost.id + "/")}><small>다음 글 →</small>{nextPost.data.title}</a>}</div>
        </nav>
      )}
      <p class="home-link"><a href={base}>홈으로</a></p>
    </div>
  </article>
</BaseLayout>
`,
    "src/pages/tags/index.astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, pathFor, tagsFor } from "../../lib/blog";

const tags = tagsFor(await getCollection("blog"));
---
<BaseLayout description="게시된 글의 태그를 모아 봅니다." title="태그">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "태그" }]} />
  <header class="page-intro">
    <h1>태그</h1>
    <p class="muted">태그 {tags.length}개</p>
  </header>
  {tags.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 태그가 없습니다</h2>
      <p>Notion의 Blog Tags 속성을 채워 게시하면 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <ul class="category-list">
      {tags.map((tag) => (
        <li>
          <a href={pathFor("tags/" + tag.slug + "/")}>
            <span>#{tag.name}</span>
            <span class="muted">{tag.count}</span>
          </a>
        </li>
      ))}
    </ul>
  )}
</BaseLayout>
`,
    "src/pages/tags/[slug].astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import PostCard from "../../components/PostCard.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, pathFor, tagsFor } from "../../lib/blog";

export async function getStaticPaths() {
  return tagsFor(await getCollection("blog")).map((tag) => ({ params: { slug: tag.slug }, props: { tag } }));
}

const { tag } = Astro.props;
---
<BaseLayout description={"#" + tag.name + " 태그의 글입니다."} title={"#" + tag.name}>
  <Breadcrumbs items={[{ href: base, label: "홈" }, { href: pathFor("tags/"), label: "태그" }, { label: "#" + tag.name }]} />
  <header class="page-intro">
    <h1>#{tag.name}</h1>
    <p class="muted">글 {tag.count}개</p>
  </header>
  <div class="post-list">
    {tag.posts.map((post) => <PostCard post={post} />)}
  </div>
</BaseLayout>
`,
    "src/pages/series/index.astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, pathFor, seriesFor } from "../../lib/blog";

const seriesList = seriesFor(await getCollection("blog"));
---
<BaseLayout description="연재 글을 시리즈별로 봅니다." title="시리즈">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "시리즈" }]} />
  <header class="page-intro">
    <h1>시리즈</h1>
    <p class="muted">시리즈 {seriesList.length}개</p>
  </header>
  {seriesList.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 시리즈가 없습니다</h2>
      <p>Notion의 Blog Series 속성을 채워 게시하면 이곳에 표시됩니다.</p>
    </section>
  ) : (
    <ul class="category-list">
      {seriesList.map((item) => (
        <li>
          <a href={pathFor("series/" + item.slug + "/")}>
            <span>{item.name}</span>
            <span class="muted">{item.posts.length}</span>
          </a>
        </li>
      ))}
    </ul>
  )}
</BaseLayout>
`,
    "src/pages/series/[slug].astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, formatDate, pathFor, seriesFor } from "../../lib/blog";

export async function getStaticPaths() {
  return seriesFor(await getCollection("blog")).map((series) => ({ params: { slug: series.slug }, props: { series } }));
}

const { series } = Astro.props;
---
<BaseLayout description={series.name + " 시리즈의 글입니다."} title={series.name}>
  <Breadcrumbs items={[{ href: base, label: "홈" }, { href: pathFor("series/"), label: "시리즈" }, { label: series.name }]} />
  <header class="page-intro">
    <h1>{series.name}</h1>
    <p class="muted">글 {series.posts.length}개 · 읽는 순서</p>
  </header>
  <ol class="archive-list series-list">
    {series.posts.map((post) => (
      <li>
        <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time>
        <a href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a>
      </li>
    ))}
  </ol>
</BaseLayout>
`,
    "src/pages/archive.astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../components/Breadcrumbs.astro";
import BaseLayout from "../layouts/BaseLayout.astro";
import { archiveFor, base, formatDate, pathFor } from "../lib/blog";

const months = archiveFor(await getCollection("blog"));
---
<BaseLayout description="게시된 글을 연·월별로 봅니다." title="보관함">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "보관함" }]} />
  <header class="page-intro">
    <h1>보관함</h1>
    <p class="muted">게시일 기준 연·월별 글</p>
  </header>
  {months.length === 0 ? (
    <section class="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">아직 게시된 글이 없습니다</h2>
      <p>새 글이 게시되면 이곳에 표시됩니다.</p>
    </section>
  ) : (
    months.map((month) => (
      <section class="archive-month" aria-labelledby={"month-" + month.month}>
        <h2 id={"month-" + month.month}>{month.label} <span class="muted">{month.posts.length}</span></h2>
        <ul class="archive-list">
          {month.posts.map((post) => (
            <li>
              <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time>
              <a href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a>
            </li>
          ))}
        </ul>
      </section>
    ))
  )}
</BaseLayout>
`,
    "src/pages/rss.xml.ts": `import { getCollection } from "astro:content";
import type { APIContext } from "astro";

import { absoluteUrl, escapeXml, site, sortPosts } from "../lib/blog";

/** 최근 글 20개. 본문 대신 설명만 넣는다(결정 D2). */
export async function GET(context: APIContext): Promise<Response> {
  const posts = sortPosts(await getCollection("blog")).slice(0, 20);
  const items = posts.map((post) => {
    const link = absoluteUrl("posts/" + post.id + "/", context.site);
    return [
      "<item>",
      "<title>" + escapeXml(post.data.title) + "</title>",
      "<link>" + escapeXml(link) + "</link>",
      '<guid isPermaLink="true">' + escapeXml(link) + "</guid>",
      "<pubDate>" + post.data.publishedAt.toUTCString() + "</pubDate>",
      "<category>" + escapeXml(post.data.category) + "</category>",
      "<description>" + escapeXml(post.data.description) + "</description>",
      "</item>",
    ].join("");
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel>',
    "<title>" + escapeXml(site.title) + "</title>",
    "<link>" + escapeXml(absoluteUrl("", context.site)) + "</link>",
    "<description>" + escapeXml(site.description || site.title) + "</description>",
    "<language>ko</language>",
    ...items,
    "</channel></rss>",
    "",
  ].join("\\n");
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
`,
    "src/pages/sitemap.xml.ts": `import { getCollection } from "astro:content";
import type { APIContext } from "astro";

import { absoluteUrl, categoriesFor, escapeXml, seriesFor, sortPosts, tagsFor } from "../lib/blog";

export async function GET(context: APIContext): Promise<Response> {
  const posts = sortPosts(await getCollection("blog"));
  const pages: { lastmod?: Date; path: string }[] = [
    { path: "" },
    { path: "posts/" },
    { path: "categories/" },
    { path: "tags/" },
    { path: "archive/" },
    { path: "series/" },
    ...seriesFor(posts).map((series) => ({ path: "series/" + series.slug + "/" })),
    ...categoriesFor(posts).map((category) => ({ path: "categories/" + category.slug + "/" })),
    ...tagsFor(posts).map((tag) => ({ path: "tags/" + tag.slug + "/" })),
    ...posts.map((post) => ({ lastmod: post.data.updatedAt, path: "posts/" + post.id + "/" })),
  ];
  const urls = pages.map(
    (page) =>
      "<url><loc>" +
      escapeXml(absoluteUrl(page.path, context.site)) +
      "</loc>" +
      (page.lastmod === undefined ? "" : "<lastmod>" + page.lastmod.toISOString().slice(0, 10) + "</lastmod>") +
      "</url>",
  );
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\\n");
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
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
    <section aria-labelledby="latest-title">
      <div class="section-heading"><h2 id="latest-title">최신 글</h2></div>
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
