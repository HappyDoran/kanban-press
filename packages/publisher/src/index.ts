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
  templateVersion: 1;
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
    templateVersion: 1,
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
      { publisher: "astro", templateVersion: 1 },
      null,
      2,
    )}\n`,
    "astro.config.mjs": `import { defineConfig } from "astro/config";

export default defineConfig({
  site: ${JSON.stringify(siteUrl)},
  base: ${JSON.stringify(basePath)},
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

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    description: z.string().default(""),
    publishedAt: z.coerce.date(),
    title: z.string(),
    updatedAt: z.coerce.date(),
  }),
});

export const collections = { blog };
`,
    "src/content/blog/.gitkeep": "",
    "src/layouts/BaseLayout.astro": `---
interface Props {
  description?: string;
  title: string;
}
const {
  description = "Notion에서 게시한 기록입니다.",
  title,
} = Astro.props;
const base = ${JSON.stringify(linkBase)};
---
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <style is:global>
      :root { font-family: Inter, Pretendard, system-ui, sans-serif; color: #211f1b; background: #f7f4ee; }
      * { box-sizing: border-box; }
      body { margin: 0; line-height: 1.7; }
      a { color: inherit; text-decoration: none; }
      header, main { width: min(48rem, calc(100% - 2rem)); margin: 0 auto; }
      header { padding: 1.25rem 0; border-bottom: 1px solid #d9d2c6; }
      main { padding: 3rem 0 6rem; }
      article img { max-width: 100%; height: auto; }
      .post { display: block; padding: 1.25rem 0; border-bottom: 1px solid #d9d2c6; }
      .muted { color: #716b62; }
    </style>
  </head>
  <body>
    <header><a href={base}><strong>Notion Blog</strong></a></header>
    <main><slot /></main>
  </body>
</html>
`,
    "src/pages/index.astro": `---
import { getCollection } from "astro:content";
import BaseLayout from "../layouts/BaseLayout.astro";

const posts = (await getCollection("blog")).sort(
  (left, right) => right.data.publishedAt.valueOf() - left.data.publishedAt.valueOf(),
);
const base = ${JSON.stringify(linkBase)};
---
<BaseLayout title="Notion Blog">
  <h1>게시된 글</h1>
  {posts.length === 0 ? (
    <p class="muted">아직 게시된 글이 없습니다.</p>
  ) : (
    posts.map((post) => (
      <a class="post" href={\`\${base}posts/\${post.id}/\`}>
        <h2>{post.data.title}</h2>
        <p class="muted">{post.data.description}</p>
      </a>
    ))
  )}
</BaseLayout>
`,
    "src/pages/posts/[...slug].astro": `---
import { getCollection, render } from "astro:content";
import BaseLayout from "../../layouts/BaseLayout.astro";

export async function getStaticPaths() {
  const posts = await getCollection("blog");
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---
<BaseLayout description={post.data.description} title={post.data.title}>
  <article>
    <h1>{post.data.title}</h1>
    <p class="muted">{post.data.publishedAt.toLocaleDateString("ko-KR")}</p>
    <Content />
  </article>
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
