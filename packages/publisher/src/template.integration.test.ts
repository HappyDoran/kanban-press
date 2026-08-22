import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAstroTemplateManifest,
  createMarkdownArtifact,
} from "./index.js";

const roots: string[] = [];
const execFile = promisify(execFileCallback);
const astroCli = fileURLToPath(
  new URL("../node_modules/astro/bin/astro.mjs", import.meta.url),
);
const nodeModules = fileURLToPath(new URL("../node_modules", import.meta.url));

const legacyPost = `---
title: Legacy Post
description: Existing v1 content
publishedAt: 2026-07-18T01:00:00.000Z
updatedAt: 2026-07-18T02:00:00.000Z
---

This post predates metadata schema versions.
`;

const v2Post = `---
schemaVersion: 2
title: Version Two
description: Strict v2 content
publishedAt: 2026-07-19T01:00:00.000Z
updatedAt: 2026-07-19T02:00:00.000Z
category: Engineering
categorySlug: engineering-a1b2c3d4
tags:
  - Notion
  - Publishing
---

This post uses v2 metadata.

## Start

First section.

## Build

Second section.

![Local image](../../assets/blog/version-two/image-001.png)

## Ship

Third section.
`;

const compatibilityPage = `---
import { getCollection } from "astro:content";

const posts = (await getCollection("blog")).sort((left, right) =>
  left.id.localeCompare(right.id),
);
---
<ul>
  {posts.map((post) => (
    <li
      data-category={post.data.category}
      data-category-slug={post.data.categorySlug}
      data-schema-version={post.data.schemaVersion}
    >
      {post.id}:{post.data.tags.join(",")}
    </li>
  ))}
</ul>
`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Astro template build", () => {
  const sites = [
    {
      expectedBase: "/",
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    },
    {
      expectedBase: "/notion-notes/",
      defaultBranch: "release/pages",
      owner: "HappyDoran",
      repository: "notion-notes",
    },
  ] as const;
  const collections = [
    { kind: "v1-only", posts: { "legacy-post.md": legacyPost } },
    {
      kind: "mixed-v1-v2",
      posts: { "legacy-post.md": legacyPost, "version-two.md": v2Post },
    },
  ] as const;

  it.each(
    sites.flatMap((site) =>
      collections.map((collection) => ({ ...site, ...collection })),
    ),
  )(
    "builds $kind content for $repository without changing post paths",
    async ({ defaultBranch, expectedBase, owner, posts, repository }) => {
      const { manifest, root } = await createFixture({
        defaultBranch,
        owner,
        repository,
      });
      await writeFixture(root, "src/pages/compatibility.astro", compatibilityPage);
      await Promise.all(
        Object.entries(posts).map(([name, content]) =>
          writeFixture(root, `src/content/blog/${name}`, content),
        ),
      );
      if ("version-two.md" in posts) {
        await writeFixture(
          root,
          "src/assets/blog/version-two/image-001.png",
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        );
      }

      await build(root);

      const indexHtml = await readFile(join(root, "dist/index.html"), "utf8");
      const legacyHtml = await readFile(
        join(root, "dist/posts/legacy-post/index.html"),
        "utf8",
      );
      const compatibilityHtml = await readFile(
        join(root, "dist/compatibility/index.html"),
        "utf8",
      );
      const postsHtml = await readFile(
        join(root, "dist/posts/index.html"),
        "utf8",
      );
      const categoriesHtml = await readFile(
        join(root, "dist/categories/index.html"),
        "utf8",
      );
      const uncategorizedHtml = await readFile(
        join(root, "dist/categories/uncategorized/index.html"),
        "utf8",
      );
      const notFoundHtml = await readFile(join(root, "dist/404.html"), "utf8");
      expect(indexHtml).toContain(`${expectedBase}posts/legacy-post/`);
      expect(indexHtml).toContain(`${expectedBase}posts/`);
      expect(indexHtml).toContain(`${expectedBase}categories/`);
      expect(indexHtml).toContain("본문으로 건너뛰기");
      expect(indexHtml).toContain('aria-current="page"');
      expect(indexHtml).not.toContain("<script");
      expect(legacyHtml).toContain("<h1>Legacy Post</h1>");
      expect(legacyHtml).toContain(
        `${expectedBase}categories/uncategorized/`,
      );
      expect(postsHtml).toContain("전체 글");
      expect(postsHtml).toContain(`${expectedBase}posts/legacy-post/`);
      expect(categoriesHtml).toContain("카테고리");
      expect(categoriesHtml).toContain(
        `${expectedBase}categories/uncategorized/`,
      );
      expect(uncategorizedHtml).toContain("Legacy Post");
      expect(notFoundHtml).toContain("페이지를 찾을 수 없습니다");
      expect(notFoundHtml).toContain(`${expectedBase}posts/legacy-post/`);
      expect(compatibilityHtml).toContain('data-category="미분류"');
      expect(compatibilityHtml).toContain('data-category-slug="uncategorized"');
      expect(compatibilityHtml).toContain('data-schema-version="1"');
      expect(compatibilityHtml).toContain("legacy-post:");

      if ("version-two.md" in posts) {
        expect(indexHtml).toContain(`${expectedBase}posts/version-two/`);
        const v2Html = await readFile(
          join(root, "dist/posts/version-two/index.html"),
          "utf8",
        );
        const engineeringHtml = await readFile(
          join(
            root,
            "dist/categories/engineering-a1b2c3d4/index.html",
          ),
          "utf8",
        );
        expect(v2Html).toContain("<h1>Version Two</h1>");
        expect(v2Html).toContain("Strict v2 content");
        expect(v2Html).toContain("#Notion");
        expect(v2Html).toContain('href="#start"');
        expect(v2Html).toMatch(/<img[^>]+src="[^"]+_astro\/image-001\.[^"]+\.png"/);
        expect(v2Html).toContain('aria-label="현재 위치"');
        expect(categoriesHtml).toContain(
          `${expectedBase}categories/engineering-a1b2c3d4/`,
        );
        expect(engineeringHtml).toContain("Version Two");
        expect(compatibilityHtml).toContain('data-category="Engineering"');
        expect(compatibilityHtml).toContain('data-schema-version="2"');
        expect(compatibilityHtml).toContain("version-two:Notion,Publishing");
      }

      expect(
        manifest.artifacts.every(
          (artifact) => !new TextDecoder().decode(artifact.bytes).includes(root),
        ),
      ).toBe(true);
    },
  );

  it("builds structured Notion blocks into semantic HTML", async () => {
    const { root } = await createFixture({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    const artifact = createMarkdownArtifact({
      blocks: [
        {
          children: [
            {
              children: [],
              kind: "listItem",
              richText: [{ text: "Nested" }],
              style: "numbered",
            },
          ],
          kind: "listItem",
          richText: [{ text: "Bullet" }],
          style: "bulleted",
        },
        {
          checked: true,
          children: [],
          kind: "toDo",
          richText: [{ text: "Done" }],
        },
        {
          children: [],
          icon: "📌",
          kind: "callout",
          richText: [{ text: "Notice" }],
        },
        {
          hasColumnHeader: true,
          hasRowHeader: true,
          kind: "table",
          rows: [
            [[{ text: "Name" }], [{ text: "Value" }]],
            [[{ text: "First" }], [{ bold: true, text: "Second" }]],
          ],
        },
        { expression: "E = mc^2", kind: "equation" },
        {
          caption: [{ text: "Reference" }],
          kind: "linkCard",
          url: "https://example.com/reference",
        },
        {
          caption: [{ text: "Attachment" }],
          kind: "media",
          mediaType: "file",
          url: null,
        },
      ],
      category: { name: "Engineering", slug: "engineering-a1b2c3d4" },
      description: "Structured content",
      publishedAt: "2026-07-19T01:00:00.000Z",
      schemaVersion: 2,
      slug: "structured-content",
      tags: [],
      title: "Structured Content",
      updatedAt: "2026-07-19T02:00:00.000Z",
    });
    await writeFixture(root, artifact.path, artifact.bytes);

    await build(root);

    const html = await readFile(
      join(root, "dist/posts/structured-content/index.html"),
      "utf8",
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<div class="notion-table-wrap">');
    expect(html).toContain('<th scope="col">Name</th>');
    expect(html).toContain('<th scope="row">First</th>');
    expect(html).toContain("<strong>Second</strong>");
    expect(html).toContain('class="notion-equation"');
    expect(html).toContain('href="https://example.com/reference"');
    expect(html).toContain("Attachment");
  });

  it("limits the home page to twelve posts while keeping every post discoverable", async () => {
    const { root } = await createFixture({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    await Promise.all(
      Array.from({ length: 13 }, (_, index) => {
        const number = String(index).padStart(2, "0");
        return writeFixture(
          root,
          `src/content/blog/post-${number}.md`,
          `---
schemaVersion: 2
title: Post ${number}
description: Description ${number}
publishedAt: 2026-07-${String(index + 1).padStart(2, "0")}T01:00:00.000Z
updatedAt: 2026-07-${String(index + 1).padStart(2, "0")}T02:00:00.000Z
category: ${index < 8 ? "Engineering" : "Notes"}
categorySlug: ${index < 8 ? "engineering-a1b2c3d4" : "notes-b1c2d3e4"}
tags: []
---

Post ${number} body.
`,
        );
      }),
    );

    await build(root);

    const indexHtml = await readFile(join(root, "dist/index.html"), "utf8");
    const postsHtml = await readFile(
      join(root, "dist/posts/index.html"),
      "utf8",
    );
    const categoriesHtml = await readFile(
      join(root, "dist/categories/index.html"),
      "utf8",
    );
    const css = await readBuiltCss(root);
    expect(indexHtml).toContain("Post 12");
    expect(indexHtml).not.toContain("Post 00");
    expect(postsHtml).toContain("Post 12");
    expect(postsHtml).toContain("Post 00");
    expect(categoriesHtml.indexOf("Engineering")).toBeLessThan(
      categoriesHtml.indexOf("Notes"),
    );
    expect(css).toContain("min-width:20rem");
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(indexHtml).not.toContain("<script");
  });

  it.each([
    {
      name: "a future schema version",
      frontmatter: v2Post.replace("schemaVersion: 2", "schemaVersion: 3"),
    },
    {
      name: "a missing v2 category",
      frontmatter: v2Post.replace("category: Engineering\n", ""),
    },
    {
      name: "an empty v2 category",
      frontmatter: v2Post.replace("category: Engineering", 'category: ""'),
    },
    {
      name: "an unsafe v2 category slug",
      frontmatter: v2Post.replace(
        "categorySlug: engineering-a1b2c3d4",
        "categorySlug: ../engineering",
      ),
    },
    {
      name: "more than ten v2 tags",
      frontmatter: v2Post.replace(
        "  - Notion\n  - Publishing",
        Array.from({ length: 11 }, (_, index) => `  - tag-${index}`).join("\n"),
      ),
    },
    {
      name: "normalized duplicate v2 tags",
      frontmatter: v2Post.replace("  - Publishing", "  - notion"),
    },
    {
      name: "an overlong v2 tag",
      frontmatter: v2Post.replace("  - Publishing", `  - ${"x".repeat(41)}`),
    },
    {
      name: "an extra v2 field",
      frontmatter: v2Post.replace("tags:\n", "unexpected: true\ntags:\n"),
    },
  ])("fails the build for $name", async ({ frontmatter }) => {
    const { root } = await createFixture({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    await writeFixture(root, "src/content/blog/invalid.md", frontmatter);

    await expect(build(root)).rejects.toThrow();
  });
});

async function createFixture(target: {
  defaultBranch: string;
  owner: string;
  repository: string;
}) {
  const root = await mkdtemp(join(process.cwd(), ".template-test-"));
  roots.push(root);
  const manifest = createAstroTemplateManifest(target);
  await symlink(nodeModules, join(root, "node_modules"), "dir");
  await Promise.all(
    manifest.artifacts.map((artifact) =>
      writeFixture(root, artifact.path, artifact.bytes),
    ),
  );
  return { manifest, root };
}

async function writeFixture(
  root: string,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function build(root: string): Promise<void> {
  await execFile(process.execPath, [astroCli, "build"], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

async function readBuiltCss(root: string): Promise<string> {
  const assetDirectory = join(root, "dist/_astro");
  const files = await readdir(assetDirectory);
  const stylesheets = files.filter((file) => file.endsWith(".css"));
  return (
    await Promise.all(
      stylesheets.map((file) => readFile(join(assetDirectory, file), "utf8")),
    )
  ).join("\n");
}
