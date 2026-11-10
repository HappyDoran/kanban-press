export {
  createMarkdownArtifact,
  type PublishBlock,
  type PublishBlockWith,
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
  <div class="post-card-kicker">
    <a class="category-link" href={pathFor("categories/" + post.data.categorySlug + "/")}>
      {post.data.category}
    </a>
    <time datetime={post.data.publishedAt.toISOString()}>{formatDate(post.data.publishedAt)}</time>
  </div>
  <Heading><a class="post-card-title" href={pathFor("posts/" + post.id + "/")}>{post.data.title}</a></Heading>
  {post.data.description && <p class="post-card-description">{post.data.description}</p>}
  <div class="post-card-meta">
    {visibleTags.length > 0 && (
      <ul class="tag-list" aria-label="태그">
        {visibleTags.map((tag) => <li>#{tag}</li>)}
        {remainingTagCount > 0 && <li aria-label={"태그 " + remainingTagCount + "개 더 있음"}>+{remainingTagCount}</li>}
      </ul>
    )}
    <a class="post-card-read" href={pathFor("posts/" + post.id + "/")} aria-label={post.data.title + " 읽기"}>읽기 <span aria-hidden="true">→</span></a>
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

const siteOwner = ${JSON.stringify(owner)};
const siteName = siteOwner + ".log";
const brandMark = (siteOwner.match(/[A-Z]/g)?.join("").slice(0, 2) || siteOwner.slice(0, 2)).toUpperCase();
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
    <meta name="theme-color" content="#f4f1e9" />
    <link rel="canonical" href={new URL(Astro.url.pathname, Astro.site)} />
    <title>{title === "홈" ? siteName : title + " · " + siteName}</title>
    <style is:global>
      :root {
        --color-bg-canvas: #f4f1e9;
        --color-bg-surface: #fffdf8;
        --color-bg-subtle: #eae7dd;
        --color-text-primary: #17201c;
        --color-text-secondary: #59635e;
        --color-border: #d6d7cf;
        --color-border-strong: #89958e;
        --color-accent: #176b4d;
        --color-accent-soft: #dcece4;
        --color-accent-hover: #0e4f38;
        --color-focus: #005fcc;
        --shadow-card: 0 1rem 2.5rem rgba(34, 48, 41, 0.08);
        --font-sans: Inter, Pretendard, system-ui, -apple-system, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        --shell-max: 74rem;
        --reading-max: 45rem;
        font-family: var(--font-sans);
        color: var(--color-text-primary);
        background: var(--color-bg-canvas);
      }
      * { box-sizing: border-box; }
      html { overflow-wrap: anywhere; scroll-behavior: smooth; }
      body {
        min-width: 20rem;
        margin: 0;
        background:
          radial-gradient(circle at 8% 0%, rgba(23, 107, 77, 0.09), transparent 26rem),
          var(--color-bg-canvas);
        line-height: 1.7;
      }
      ::selection { background: var(--color-accent-soft); color: var(--color-text-primary); }
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
      .site-header { position: sticky; z-index: 5; top: 0; border-bottom: 1px solid rgba(137, 149, 142, 0.35); background: rgba(244, 241, 233, 0.92); backdrop-filter: blur(14px); }
      .site-header-inner, main, .site-footer-inner { width: min(var(--shell-max), calc(100% - 2.5rem)); margin-inline: auto; }
      .site-header-inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1.5rem; min-height: 4.75rem; }
      .site-brand { display: inline-flex; align-items: center; gap: 0.7rem; color: var(--color-text-primary); font-weight: 800; letter-spacing: -0.02em; text-decoration: none; }
      .brand-mark { display: grid; width: 2.15rem; height: 2.15rem; place-items: center; border-radius: 0.65rem; background: var(--color-text-primary); color: var(--color-bg-surface); font-size: 0.85rem; letter-spacing: 0; }
      .brand-copy { display: grid; line-height: 1.1; }
      .brand-copy small { margin-block-start: 0.25rem; color: var(--color-text-secondary); font-size: 0.65rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
      .site-nav ul, .tag-list, .breadcrumbs ol, .category-list { display: flex; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
      .site-nav ul { gap: 0.2rem; }
      .site-nav a { display: inline-flex; min-height: 2.75rem; align-items: center; padding: 0.5rem 0.75rem; border-radius: 999px; color: var(--color-text-secondary); font-size: 0.925rem; font-weight: 700; text-decoration: none; }
      .site-nav a:hover, .site-nav a[aria-current="page"] { background: var(--color-accent-soft); color: var(--color-accent-hover); }
      main { min-height: 70vh; padding-block: clamp(2.5rem, 7vw, 5rem) 6rem; }
      .site-footer { border-top: 1px solid var(--color-border); color: var(--color-text-secondary); }
      .site-footer-inner { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem 1.5rem; padding-block: 2rem; font-size: 0.875rem; }
      .muted { color: var(--color-text-secondary); }
      .eyebrow { margin: 0 0 1rem; color: var(--color-accent); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
      .hero { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2rem; margin-block-end: clamp(4rem, 9vw, 7rem); }
      .hero h1 { max-width: 14ch; margin: 0; font-size: clamp(2.65rem, 8vw, 5.75rem); letter-spacing: -0.065em; line-height: 0.98; }
      .hero h1 span { color: var(--color-accent); }
      .hero-copy { max-width: 34rem; }
      .hero-copy > p { margin-block: 0 1.5rem; color: var(--color-text-secondary); font-size: clamp(1.05rem, 2vw, 1.2rem); }
      .hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
      .button-link { display: inline-flex; min-height: 2.85rem; align-items: center; justify-content: center; padding: 0.6rem 1rem; border: 1px solid var(--color-text-primary); border-radius: 999px; background: var(--color-text-primary); color: var(--color-bg-surface); font-weight: 750; text-decoration: none; }
      .button-link:hover { background: var(--color-accent-hover); color: white; }
      .button-link.secondary { border-color: var(--color-border-strong); background: transparent; color: var(--color-text-primary); }
      .button-link.secondary:hover { border-color: var(--color-accent); background: var(--color-accent-soft); color: var(--color-accent-hover); }
      .hero-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin: 1.5rem 0 0; }
      .hero-stats div { padding: 1.1rem; border: 1px solid var(--color-border); border-radius: 1rem; background: rgba(255, 253, 248, 0.72); }
      .hero-stats dt { color: var(--color-text-secondary); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .hero-stats dd { margin: 0.2rem 0 0; font-size: 1.75rem; font-weight: 800; letter-spacing: -0.04em; }
      .section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-block-end: 1.5rem; }
      .section-heading h2 { margin: 0; }
      .section-heading > a { font-weight: 700; }
      .post-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr)); gap: 1rem; }
      .post-list { display: grid; gap: 1rem; }
      .post-card { display: flex; min-width: 0; min-height: 17rem; flex-direction: column; padding: 1.5rem; border: 1px solid var(--color-border); border-radius: 1.1rem; background: var(--color-bg-surface); transition: transform 180ms cubic-bezier(.2,.8,.2,1), border-color 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms cubic-bezier(.2,.8,.2,1); }
      .post-card:focus-within, .post-card:hover { transform: translateY(-0.2rem); border-color: var(--color-border-strong); box-shadow: var(--shadow-card); }
      .post-card-kicker { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; color: var(--color-text-secondary); font-size: 0.78rem; }
      .post-card h2, .post-card h3 { margin-block: 1.25rem 0.65rem; font-size: clamp(1.3rem, 2.4vw, 1.6rem); letter-spacing: -0.025em; }
      .post-card-title { color: var(--color-text-primary); text-decoration: none; }
      .post-card-title:hover { color: var(--color-accent-hover); }
      .post-card-description { display: -webkit-box; overflow: hidden; margin-block: 0 1rem; color: var(--color-text-secondary); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .post-card-meta { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem 1rem; margin-block-start: auto; color: var(--color-text-secondary); font-size: 0.85rem; }
      .post-card-read { margin-inline-start: auto; font-weight: 800; text-decoration: none; white-space: nowrap; }
      .category-link { display: inline-flex; padding: 0.15rem 0.55rem; border-radius: 999px; background: var(--color-accent-soft); font-size: 0.78rem; font-weight: 800; text-decoration: none; }
      .tag-list { gap: 0.35rem 0.75rem; }
      .tag-list li { white-space: nowrap; }
      .category-section { margin-block-start: 4rem; }
      .category-list { gap: 0.75rem; }
      .category-list a { display: inline-flex; min-height: 2.75rem; align-items: center; gap: 0.4rem; padding: 0.55rem 0.95rem; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-bg-surface); font-weight: 700; text-decoration: none; }
      .category-list a[aria-current="page"] { border-color: var(--color-accent); background: var(--color-bg-subtle); font-weight: 700; }
      .breadcrumbs { margin-block-end: 2rem; color: var(--color-text-secondary); font-size: 0.875rem; }
      .breadcrumbs ol { gap: 0.4rem; }
      .breadcrumbs li { display: flex; gap: 0.4rem; }
      .page-intro { max-width: var(--reading-max); margin-block-end: 2rem; }
      .page-intro h1 { margin-block-end: 0.5rem; }
      .empty-state { max-width: var(--reading-max); padding: 1.5rem; border: 1px solid var(--color-border); border-radius: 0.75rem; background: var(--color-bg-surface); }
      .empty-state h2 { margin-block-start: 0; }
      .post-header { width: min(100%, var(--reading-max)); margin-inline: auto; }
      .post-header { margin-block-end: 2.5rem; }
      .post-header h1 { margin-block: 0.5rem; }
      .post-description { font-size: 1.125rem; color: var(--color-text-secondary); }
      .post-meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: var(--color-text-secondary); }
      .post-header .tag-list { margin-block-start: 1rem; }
      .article-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2rem; width: min(100%, 62rem); margin-inline: auto; }
      .article-main, .post-body, .post-navigation { min-width: 0; width: min(100%, var(--reading-max)); margin-inline: auto; }
      .post-toc { padding: 1.25rem 1.5rem; border: 1px solid var(--color-border); border-radius: 0.9rem; background: rgba(255, 253, 248, 0.8); }
      .post-toc h2 { margin-block-start: 0; font-size: 1.25rem; }
      .post-toc ol { margin-block-end: 0; padding-inline-start: 1.2rem; }
      .post-toc a { color: var(--color-text-secondary); text-decoration: none; }
      .post-toc a:hover { color: var(--color-accent-hover); text-decoration: underline; }
      .post-body { font-size: 1.125rem; line-height: 1.75; }
      .post-body > :first-child { margin-block-start: 0; }
      .post-body p, .post-body ul, .post-body ol { margin-block: 0.7rem; }
      .post-body ul, .post-body ol { padding-inline-start: 1.75rem; }
      .post-body li + li { margin-block-start: 0.3rem; }
      .post-body a { text-decoration: underline; }
      .post-body h2, .post-body h3, .post-body h4 { line-height: 1.3; text-wrap: balance; }
      .post-body h2 { margin-block: 3rem 0.9rem; font-size: clamp(1.55rem, 3vw, 1.9rem); }
      .post-body h3 { margin-block: 2.25rem 0.8rem; font-size: clamp(1.3rem, 2.5vw, 1.55rem); }
      .post-body h4 { margin-block: 1.75rem 0.7rem; font-size: clamp(1.18rem, 2vw, 1.3rem); }
      .post-body img { display: block; margin: 1.5rem auto; border-radius: 0.375rem; }
      .post-body input[type="checkbox"] { width: 1rem; height: 1rem; margin-inline: 0 0.55rem; accent-color: var(--color-accent); }
      .post-body .notion-table-wrap { max-width: 100%; margin-block: 1.5rem; overflow-x: auto; }
      .post-body table { width: 100%; min-width: 28rem; border-spacing: 0; border-collapse: collapse; font-size: 1rem; }
      .post-body th, .post-body td { padding: 0.65rem 0.8rem; text-align: start; vertical-align: top; border: 1px solid var(--color-border); }
      .post-body th { background: var(--color-bg-subtle); font-weight: 700; }
      .post-body .notion-equation { max-width: 100%; margin-block: 1.25rem; padding: 0.9rem 1rem; overflow-x: auto; border: 1px solid var(--color-border); border-radius: 0.375rem; background: var(--color-bg-surface); text-align: center; }
      .post-body .notion-resource-card { display: grid; gap: 0.2rem; margin-block: 0.85rem; padding: 0.85rem 1rem; border: 1px solid var(--color-border); border-radius: 0.375rem; background: var(--color-bg-surface); color: var(--color-text-primary); text-decoration: none; }
      .post-body a.notion-resource-card:hover { border-color: var(--color-border-strong); }
      .post-body .notion-resource-label { color: var(--color-text-secondary); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
      .post-body details { margin-block: 1rem; padding: 0.75rem 1rem; border: 1px solid var(--color-border); border-radius: 0.375rem; }
      .post-body summary { min-height: 2.75rem; cursor: pointer; font-weight: 700; }
      .post-navigation { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-block-start: 4rem; padding-block-start: 1.5rem; border-top: 1px solid var(--color-border); }
      .post-navigation a { padding-block: 0.75rem; }
      .post-navigation .next { text-align: end; }
      .home-link { width: min(100%, var(--reading-max)); margin: 2rem auto 0; }
      @media (min-width: 37.5rem) {
        .site-header-inner, main, .site-footer-inner { width: min(var(--shell-max), calc(100% - 4rem)); }
      }
      @media (min-width: 52rem) {
        .hero { grid-template-columns: minmax(0, 1.45fr) minmax(15rem, 0.55fr); align-items: end; }
        .hero-copy { align-self: end; }
      }
      @media (min-width: 64rem) {
        .article-layout:not(.without-toc) { grid-template-columns: 14rem minmax(0, var(--reading-max)); align-items: start; }
        .article-layout.without-toc { grid-template-columns: minmax(0, var(--reading-max)); justify-content: center; }
        .post-toc { position: sticky; top: 6.25rem; max-height: calc(100vh - 8rem); overflow-y: auto; }
      }
      @media (max-width: 31.25rem) {
        .site-header { position: static; }
        .site-header-inner { align-items: flex-start; flex-direction: column; padding-block: 0.9rem; }
        .site-nav { width: 100%; }
        .site-nav ul { justify-content: space-between; }
        .site-nav a { padding-inline: 0.55rem; font-size: 0.85rem; }
        .hero h1 { font-size: clamp(2.5rem, 14vw, 3.6rem); }
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
        <a class="site-brand" href={base} aria-label={siteName + " 홈"}>
          <span class="brand-mark" aria-hidden="true">{brandMark}</span>
          <span class="brand-copy">{siteName}<small>Developer notes</small></span>
        </a>
        <nav class="site-nav" aria-label="주요 탐색">
          <ul>
            <li><a href={base} aria-current={section === "home" ? "page" : undefined}>홈</a></li>
            <li><a href={pathFor("posts/")} aria-current={section === "posts" ? "page" : undefined}>전체 글</a></li>
            <li><a href={pathFor("categories/")} aria-current={section === "categories" ? "page" : undefined}>주제</a></li>
            <li><a href={githubUrl} rel="me">GitHub</a></li>
          </ul>
        </nav>
      </div>
    </header>
    <main id="main-content"><slot /></main>
    <footer class="site-footer">
      <div class="site-footer-inner">
        <span>© {new Date().getUTCFullYear()} {siteOwner}</span>
        <span>Notion에서 쓰고 Astro로 빌드합니다.</span>
      </div>
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
const siteOwner = ${JSON.stringify(owner)};
---
<BaseLayout title="홈">
  <section class="hero">
    <div>
      <p class="eyebrow">{siteOwner} · Developer journal</p>
      <h1>배운 것을 기록하고, <span>만든 것을 나눕니다.</span></h1>
    </div>
    <div class="hero-copy">
      <p>개발하면서 마주친 문제와 해결 과정, 오래 기억하고 싶은 배움을 차분히 쌓아갑니다.</p>
      <div class="hero-actions">
        <a class="button-link" href={pathFor("posts/")}>글 둘러보기</a>
        <a class="button-link secondary" href={pathFor("categories/")}>주제로 찾기</a>
      </div>
      <dl class="hero-stats" aria-label="블로그 통계">
        <div><dt>Posts</dt><dd>{posts.length}</dd></div>
        <div><dt>Topics</dt><dd>{categories.length}</dd></div>
      </dl>
    </div>
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
          <h2 id="categories-title">주제</h2>
          <a href={pathFor("categories/")}>모든 주제 보기</a>
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
    <p class="eyebrow">Archive</p>
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
<BaseLayout description="게시된 글을 주제별로 찾아봅니다." title="주제">
  <Breadcrumbs items={[{ href: base, label: "홈" }, { label: "주제" }]} />
  <header class="page-intro">
    <p class="eyebrow">Topics</p>
    <h1>주제</h1>
    <p class="muted">큰 주제별로 글을 둘러보세요.</p>
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
  <Breadcrumbs items={[{ href: base, label: "홈" }, { href: pathFor("categories/"), label: "주제" }, { label: category.name }]} />
  <header class="page-intro">
    <p class="eyebrow">Topic</p>
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
    <div class:list={["article-layout", sectionHeadings.length >= 3 ? "with-toc" : "without-toc"]}>
      {sectionHeadings.length >= 3 && (
        <nav class="post-toc" aria-labelledby="toc-title">
          <h2 id="toc-title">목차</h2>
          <ol>{sectionHeadings.map((heading) => <li><a href={"#" + heading.slug}>{heading.text}</a></li>)}</ol>
        </nav>
      )}
      <div class="article-main">
        <div class="post-body"><Content /></div>
        {(previousPost !== undefined || nextPost !== undefined) && (
          <nav class="post-navigation" aria-label="같은 카테고리의 이전 및 다음 글">
            <div>{previousPost && <a href={pathFor("posts/" + previousPost.id + "/")}>← 이전 글<br /><strong>{previousPost.data.title}</strong></a>}</div>
            <div class="next">{nextPost && <a href={pathFor("posts/" + nextPost.id + "/")}>다음 글 →<br /><strong>{nextPost.data.title}</strong></a>}</div>
          </nav>
        )}
        <p class="home-link"><a href={base}>홈으로</a></p>
      </div>
    </div>
  </article>
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
