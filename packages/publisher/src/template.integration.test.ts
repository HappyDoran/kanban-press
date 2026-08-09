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

import {
  createAstroTemplateManifest,
  createMarkdownArtifact,
} from "./index.js";

const roots: string[] = [];
const decoder = new TextDecoder();
const execFile = promisify(execFileCallback);
const astroCli = fileURLToPath(
  new URL("../node_modules/astro/bin/astro.mjs", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Astro template build", () => {
  it.each([
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
  ])(
    "builds $repository with base $expectedBase",
    async ({ defaultBranch, expectedBase, owner, repository }) => {
      const root = await mkdtemp(join(process.cwd(), ".template-test-"));
      roots.push(root);
      const manifest = createAstroTemplateManifest({
        defaultBranch,
        owner,
        repository,
      });
      await symlink(
        fileURLToPath(new URL("../node_modules", import.meta.url)),
        join(root, "node_modules"),
        "dir",
      );
      for (const artifact of manifest.artifacts) {
        const destination = join(root, artifact.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, artifact.bytes);
      }
      const post = createMarkdownArtifact({
        blocks: [
          {
            kind: "heading",
            level: 2,
            richText: [{ text: "본문" }],
          },
          {
            children: [
              {
                kind: "paragraph",
                richText: [{ text: "접힌 내용" }],
              },
            ],
            kind: "toggle",
            summary: [{ text: "자세히 보기" }],
          },
        ],
        category: { name: "Engineering", slug: "engineering-a1b2c3d4" },
        description: "Build fixture",
        publishedAt: "2026-07-19T01:00:00.000Z",
        schemaVersion: 2,
        slug: "hello",
        tags: ["Notion", "Publishing"],
        title: "Hello",
        updatedAt: "2026-07-19T02:00:00.000Z",
      });
      const postPath = join(root, post.path);
      await mkdir(dirname(postPath), { recursive: true });
      await writeFile(postPath, post.bytes);

      await execFile(process.execPath, [astroCli, "build"], {
        cwd: root,
        env: { ...process.env, NO_COLOR: "1" },
      });

      const indexHtml = await readFile(join(root, "dist/index.html"), "utf8");
      const postHtml = await readFile(
        join(root, "dist/posts/hello/index.html"),
        "utf8",
      );
      expect(indexHtml).toContain(`${expectedBase}posts/hello/`);
      expect(postHtml).toContain("<h1>Hello</h1>");
      expect(postHtml).toContain("<h2 id=\"본문\">본문</h2>");
      expect(postHtml).toContain("<summary>자세히 보기</summary>");
      expect(decoder.decode(manifest.artifacts[0]?.bytes)).not.toContain(
        root,
      );
    },
  );
});
