export {
  createMarkdownArtifact,
  type PublishBlock,
  type PublishBlockWith,
  type PublishDocument,
  type PublishRichText,
} from "./markdown.js";
export { BLOG_CSS } from "./blog-css.js";
export { DESIGN_TOKENS_CSS } from "./design-tokens.js";
export { countManuscriptPages } from "./manuscript.js";

import { BLOG_CSS } from "./blog-css.js";
import { DESIGN_TOKENS_CSS } from "./design-tokens.js";

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

/**
 * 예전 template이 만들었지만 지금은 만들지 않는 파일(2026-11-11 주제·시리즈·태그 화면 제거).
 * 남아 있으면 지운 함수를 import해 build가 깨지므로 게시 commit이 저장소에서 지운다.
 */
export const RETIRED_TEMPLATE_PATHS: readonly string[] = [
  "src/pages/categories/[slug].astro",
  "src/pages/categories/index.astro",
  "src/pages/series/[slug].astro",
  "src/pages/series/index.astro",
  "src/pages/tags/[slug].astro",
  "src/pages/tags/index.astro",
];

export function createAstroTemplateManifest(
  target: AstroTemplateTarget,
): PublisherManifest {
  const owner = parseGitHubName(target.owner, "owner");
  const repository = parseGitHubName(target.repository, "repository");
  const defaultBranch = parseDefaultBranch(target.defaultBranch);
  const userSite = repository.toLowerCase() === `${owner.toLowerCase()}.github.io`;
  // 호스트는 대소문자를 가리지 않지만 canonical·sitemap·RSS 주소를 한 모양으로 맞추려고 소문자로 쓴다.
  const siteUrl = `https://${owner.toLowerCase()}.github.io`;
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

# 연달아 게시해도 Pages 배포가 겹치지 않게 한 번에 하나만 배포한다. 기다리는 배포는 최신 것만 남는다.
concurrency:
  group: pages
  cancel-in-progress: false

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
    ".kanban-press/managed.json": `${JSON.stringify(
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
        name: "kanban-press-site",
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
    pinned: false,
    schemaVersion: 1 as const,
    tags: [] as string[],
  }));

const tag = z.string().trim().min(1).max(40);
// 2026-11-11 전에 게시한 글에 남은 주제·시리즈 field. build만 통과시키고 화면에는 쓰지 않는다.
const retired = z.unknown().optional();
const v2 = z
  .object({
    ...fields,
    category: retired,
    categorySlug: retired,
    manuscriptPages: z.number().int().positive().optional(),
    pinned: z.boolean().default(false),
    schemaVersion: z.literal(2),
    series: retired,
    seriesOrder: retired,
    seriesSlug: retired,
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
import { formatDate, pathFor, tagPath } from "../lib/blog";

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
    <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time>
  </div>
  <Heading><a class="post-card-title" href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a></Heading>
  {post.data.description && <p class="post-card-description">{post.data.description}</p>}
  {visibleTags.length > 0 && (
    <ul class="tag-list" aria-label="태그">
      {visibleTags.map((tag) => <li><a href={tagPath(tag)}>#{tag}</a></li>)}
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
 * 게시 앱이 저장한 사이트 설정(.kanban-press/site.json, R11). 빌드는 저장소 루트에서 실행된다.
 * 파일이 없거나 값이 틀리면 그 항목만 기본값을 쓴다.
 */
export const site: SiteSettings = readSiteSettings();

function readSiteSettings(): SiteSettings {
  const fallback: SiteSettings = {
    description: "Notion에서 쓰고 GitHub Pages에 쌓아 가는 개발 기록입니다.",
    links: [],
    title: siteOwner + ".log",
  };
  // 이름 변경 전 위치(.notion-kanban-blog/)도 새 파일이 없을 때 읽는다.
  const path = [".kanban-press", ".notion-kanban-blog"]
    .map((directory) => join(process.cwd(), directory, "site.json"))
    .find((candidate) => existsSync(candidate));
  if (path === undefined) {
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

export interface BlogTag {
  count: number;
  name: string;
  posts: readonly BlogPost[];
  slug: string;
}

/** 태그 slug. 영문·숫자 부분 + 정규화한 이름의 hash 8자라 한글 태그도 안정적이다. */
export function tagSlug(name: string): string {
  const normalized = name.normalize("NFKC").trim().replace(/\\s+/gu, " ").toLowerCase();
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 8);
  const ascii = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  return ascii ? ascii + "-" + hash : "tag-" + hash;
}

/** 태그 링크는 전체 글의 태그 거르기로 간다(R9). */
export function tagPath(name: string): string {
  return pathFor("posts/?tag=" + tagSlug(name));
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
    <!-- 제목 글꼴(디자인 기획 10.2, 결정 D5). 받지 못해도 시스템 명조로 읽힌다. -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@700&display=swap" />
    <style is:global>
${DESIGN_TOKENS_CSS}
      :root {
        --font-title: "Hahmlet", "Noto Serif KR", "AppleMyungjo", "Batang", serif;
        --font-sans: system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
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
            <li><a href={githubUrl} rel="me">GitHub</a></li>
          </ul>
        </nav>
      </div>
    </header>
    <main class="site-main" id="main-content"><slot /></main>
    <footer class="site-footer">
      <div class="site-footer-inner">
        <span>© {new Date().getUTCFullYear()} {siteOwner} · GitHub Pages로 게시됨</span>
        <span><a href={pathFor("archive/")}>보관함</a></span>
      </div>
    </footer>
  </body>
</html>
`,
    "src/pages/index.astro": `---
import { getCollection } from "astro:content";
import PostCard from "../components/PostCard.astro";
import BaseLayout from "../layouts/BaseLayout.astro";
import { pathFor, site, sortPosts, tagsFor } from "../lib/blog";

const posts = sortPosts(await getCollection("blog"));
// 고정 글(R10)은 최신 글 위에 따로 두고 최신 글에서는 뺀다.
const pinnedPosts = posts.filter((post) => post.data.pinned);
const latestPosts = posts.filter((post) => !post.data.pinned).slice(0, 12);
const tagCount = tagsFor(posts).length;
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
      <div><dt>태그</dt><dd>{tagCount}</dd></div>
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
    </>
  )}
</BaseLayout>
`,
    "src/pages/posts/index.astro": `---
import { getCollection } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import PostCard from "../../components/PostCard.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, pathFor, sortPosts, tagSlug, tagsFor } from "../../lib/blog";

const posts = sortPosts(await getCollection("blog"));
const tags = tagsFor(posts);
const searchText = (post: (typeof posts)[number]) =>
  [post.data.title, post.data.description, ...post.data.tags].join(" ").normalize("NFKC").toLowerCase();
---
<BaseLayout description="게시된 모든 글을 검색하고 태그로 거릅니다." title="전체 글">
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
    <>
      <form class="post-search" role="search" action={pathFor("posts/")} data-post-search>
        <label for="post-query">글 검색</label>
        <input id="post-query" name="q" type="search" autocomplete="off" placeholder="제목·설명·태그로 찾기" />
      </form>
      {tags.length > 0 && (
        <nav class="tag-filter" aria-label="태그로 거르기">
          <ul class="category-list">
            <li><a href={pathFor("posts/")} data-tag-filter="">전체 <span class="muted">{posts.length}</span></a></li>
            {tags.map((tag) => (
              <li><a href={pathFor("posts/?tag=" + tag.slug)} data-tag-filter={tag.slug}>#{tag.name} <span class="muted">{tag.count}</span></a></li>
            ))}
          </ul>
          <button class="tag-more" type="button" aria-expanded="false" data-tag-more hidden></button>
        </nav>
      )}
      <p class="post-status muted" role="status" data-post-status></p>
      <div class="post-list">
        {posts.map((post) => (
          <div data-post data-search={searchText(post)} data-tags={post.data.tags.map(tagSlug).join(" ")}>
            <PostCard post={post} />
          </div>
        ))}
      </div>
      <nav class="pagination" aria-label="쪽 이동" data-pagination hidden></nav>
    </>
  )}
</BaseLayout>
<script>
  // 검색·태그 거르기·쪽 나누기(R9). JavaScript가 없으면 모든 글과 모든 태그가 그대로 보인다.
  // 상태는 주소 query(q, tag, page)에 두어 새로고침·공유해도 같다.
  const PAGE_SIZE = 10;
  // 쪽 번호는 5개씩 묶어 보이고, 태그는 글이 많은 순으로 10개만 보인 뒤 더 보기로 편다(고른 태그는 늘 보인다).
  const PAGE_GROUP = 5;
  const TAG_LIMIT = 10;
  const moreTags = document.querySelector<HTMLButtonElement>("[data-tag-more]");
  let tagsExpanded = false;
  const items = [...document.querySelectorAll<HTMLElement>("[data-post]")];
  const form = document.querySelector<HTMLFormElement>("[data-post-search]");
  const input = document.querySelector<HTMLInputElement>("#post-query");
  const status = document.querySelector<HTMLElement>("[data-post-status]");
  const pager = document.querySelector<HTMLElement>("[data-pagination]");
  const tagLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-tag-filter]")];
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\\s+/g, " ").trim();

  function read() {
    const params = new URLSearchParams(location.search);
    const page = Number.parseInt(params.get("page") ?? "1", 10);
    return { page: Number.isFinite(page) && page > 0 ? page : 1, q: params.get("q") ?? "", tag: params.get("tag") ?? "" };
  }

  function write(next: { page: number; q: string; tag: string }) {
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.tag) params.set("tag", next.tag);
    if (next.page > 1) params.set("page", String(next.page));
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? "?" + query : ""));
    render();
  }

  function pageButton(label: string, page: number, ariaLabel: string, options: { current?: boolean; disabled?: boolean } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.disabled = options.disabled === true;
    if (options.current === true) button.setAttribute("aria-current", "page");
    // 화면을 옮기지 않고, 바뀐 쪽 번호에 초점을 둔다(버튼을 다시 그려 초점이 사라지지 않게).
    button.addEventListener("click", () => {
      write({ ...read(), page });
      pager?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    });
    return button;
  }

  function render() {
    const { page, q, tag } = read();
    if (input && input.value !== q) input.value = q;
    const terms = normalize(q).split(" ").filter(Boolean);
    const matched = items.filter(
      (item) =>
        (tag === "" || (item.dataset.tags ?? "").split(" ").includes(tag)) &&
        terms.every((term) => (item.dataset.search ?? "").includes(term)),
    );
    const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    const current = Math.min(page, pages);
    const shown = new Set(matched.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE));
    for (const item of items) item.hidden = !shown.has(item);
    tagLinks.forEach((link, index) => {
      const selected = link.dataset.tagFilter === tag;
      if (selected) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
      // index 0은 "전체"다.
      const item = link.closest("li");
      if (item) item.hidden = !tagsExpanded && !selected && index > TAG_LIMIT;
    });
    const hiddenTags = tagLinks.length - 1 - TAG_LIMIT;
    if (moreTags) {
      moreTags.hidden = hiddenTags <= 0;
      moreTags.textContent = tagsExpanded ? "태그 접기" : "태그 " + hiddenTags + "개 더 보기";
      moreTags.setAttribute("aria-expanded", String(tagsExpanded));
    }
    if (status) {
      status.textContent =
        matched.length === 0
          ? "조건에 맞는 글이 없습니다."
          : "글 " + matched.length + "개" + (pages > 1 ? " · " + current + "/" + pages + "쪽" : "");
    }
    if (pager) {
      pager.replaceChildren();
      pager.hidden = pages <= 1;
      if (pages > 1) {
        // 이전·다음은 앞뒤 묶음의 첫 쪽으로 간다(1–5 → 6–10).
        const first = Math.floor((current - 1) / PAGE_GROUP) * PAGE_GROUP + 1;
        const last = Math.min(first + PAGE_GROUP - 1, pages);
        pager.append(pageButton("이전", Math.max(1, first - PAGE_GROUP), "이전 " + PAGE_GROUP + "쪽", { disabled: first === 1 }));
        for (let number = first; number <= last; number += 1) {
          pager.append(pageButton(String(number), number, number + "쪽", { current: number === current }));
        }
        pager.append(pageButton("다음", last + 1, "다음 " + PAGE_GROUP + "쪽", { disabled: last === pages }));
      }
    }
  }

  form?.addEventListener("submit", (event) => event.preventDefault());
  moreTags?.addEventListener("click", () => {
    tagsExpanded = !tagsExpanded;
    render();
  });
  // 좁은 화면에서는 태그 줄이 옆으로 밀리므로, 주소로 고른 태그가 처음부터 보이게 그 줄만 옮긴다.
  const selectedTag = tagLinks.find((link) => link.dataset.tagFilter !== "" && link.dataset.tagFilter === read().tag);
  const tagRow = selectedTag?.closest("ul");
  if (selectedTag && tagRow && tagRow.scrollWidth > tagRow.clientWidth) {
    tagRow.scrollLeft += selectedTag.getBoundingClientRect().left - tagRow.getBoundingClientRect().left - 16;
  }
  input?.addEventListener("input", () => write({ ...read(), page: 1, q: input.value }));
  for (const link of tagLinks) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      write({ ...read(), page: 1, tag: link.dataset.tagFilter ?? "" });
    });
  }
  render();
</script>
`,
    "src/pages/posts/[...slug].astro": `---
import { getCollection, render } from "astro:content";
import Breadcrumbs from "../../components/Breadcrumbs.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import { base, formatDate, isDifferentDay, pathFor, siteOwner, sortPosts, tagPath } from "../../lib/blog";

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
// 이전 글은 바로 더 오래된 글, 다음 글은 바로 더 새 글이다(allPosts는 최신순).
const currentIndex = allPosts.findIndex((candidate) => candidate.id === post.id);
const previousPost = allPosts[currentIndex + 1];
const nextPost = currentIndex > 0 ? allPosts[currentIndex - 1] : undefined;
---
<BaseLayout description={post.data.description} title={post.data.title} type="article">
  <Breadcrumbs items={[
    { href: base, label: "홈" },
    { href: pathFor("posts/"), label: "전체 글" },
    { label: post.data.title },
  ]} />
  <article class:list={["article-layout", sectionHeadings.length >= 3 ? "with-toc" : "without-toc"]}>
    <header class="post-header">
      <h1>{post.data.title}</h1>
      <div class="post-meta">
        <span>게시 <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time></span>
        {isDifferentDay(post.data.publishedAt, post.data.updatedAt) && (
          <span>수정 <time datetime={post.data.updatedAt.toISOString()}>{formatDate(post.data.updatedAt)}</time></span>
        )}
        {post.data.manuscriptPages !== undefined && <span>200자 원고지 {post.data.manuscriptPages}매</span>}
      </div>
      {post.data.tags.length > 0 && (
        <ul class="tag-list" aria-label="태그">
          {post.data.tags.map((tag) => <li><a href={tagPath(tag)}>#{tag}</a></li>)}
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
      <div class="post-body"><Content /></div>
      <p class="post-end">(끝)</p>
      <footer class="post-colophon" aria-labelledby="colophon-title">
        <h2 id="colophon-title">판권</h2>
        <dl>
          <div><dt>쓴 사람</dt><dd>{siteOwner}</dd></div>
          <div><dt>초판</dt><dd><time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time></dd></div>
          {isDifferentDay(post.data.publishedAt, post.data.updatedAt) && (
            <div><dt>고침</dt><dd><time datetime={post.data.updatedAt.toISOString()}>{formatDate(post.data.updatedAt)}</time></dd></div>
          )}
          {post.data.manuscriptPages !== undefined && <div><dt>분량</dt><dd>200자 원고지 {post.data.manuscriptPages}매</dd></div>}
          <div><dt>원고·조판</dt><dd>Notion · Kanban Press</dd></div>
          <div><dt>찍은 곳</dt><dd>GitHub Pages</dd></div>
        </dl>
      </footer>
      {(previousPost !== undefined || nextPost !== undefined) && (
        <nav class="post-navigation" aria-label="이전 및 다음 글">
          <div>{previousPost && <a href={pathFor("posts/" + previousPost.id + "/")}><small>← 이전 글</small>{previousPost.data.title}</a>}</div>
          <div class="next">{nextPost && <a href={pathFor("posts/" + nextPost.id + "/")}><small>다음 글 →</small>{nextPost.data.title}</a>}</div>
        </nav>
      )}
      <p class="home-link"><a href={base}>홈으로</a></p>
    </div>
  </article>
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

import { absoluteUrl, escapeXml, sortPosts } from "../lib/blog";

export async function GET(context: APIContext): Promise<Response> {
  const posts = sortPosts(await getCollection("blog"));
  const pages: { lastmod?: Date; path: string }[] = [
    { path: "" },
    { path: "posts/" },
    { path: "archive/" },
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
