import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createAstroTemplateManifest } from "./index.js";

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
      expect(indexHtml).toContain(`${expectedBase}posts/legacy-post/`);
      expect(legacyHtml).toContain("<h1>Legacy Post</h1>");
      expect(compatibilityHtml).toContain('data-category="미분류"');
      expect(compatibilityHtml).toContain('data-category-slug="uncategorized"');
      expect(compatibilityHtml).toContain('data-schema-version="1"');
      expect(compatibilityHtml).toContain("legacy-post:");

      if ("version-two.md" in posts) {
        expect(indexHtml).toContain(`${expectedBase}posts/version-two/`);
        expect(
          await readFile(
            join(root, "dist/posts/version-two/index.html"),
            "utf8",
          ),
        ).toContain("<h1>Version Two</h1>");
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
