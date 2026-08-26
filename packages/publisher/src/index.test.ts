import { describe, expect, it } from "vitest";

import { createAstroTemplateManifest } from "./index.js";

const decoder = new TextDecoder();

describe("createAstroTemplateManifest", () => {
  it("creates a deterministic user-site template rooted at slash", () => {
    const first = createAstroTemplateManifest({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    const second = createAstroTemplateManifest({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });

    expect(first).toEqual(second);
    expect(first.basePath).toBe("/");
    expect(first.siteUrl).toBe("https://HappyDoran.github.io");
    expect(first.schemaVersion).toBe(1);
    expect(first.templateVersion).toBe(2);
    expect(readArtifact(first.artifacts, "astro.config.mjs")).toContain(
      'base: "/"',
    );
    const workflow = readArtifact(
      first.artifacts,
      ".github/workflows/deploy.yml",
    );
    expect(workflow).toContain("uses: pnpm/action-setup@v6");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("pnpm install --no-frozen-lockfile");
    expect(workflow).toContain("uses: actions/upload-pages-artifact@v5");
    expect(workflow).toContain('branches: ["main"]');
    expect(workflow).not.toContain("withastro/action");
    expect(
      readArtifact(first.artifacts, ".notion-kanban-blog/managed.json"),
    ).toBe('{\n  "publisher": "astro",\n  "templateVersion": 2\n}\n');
    expect(readArtifact(first.artifacts, "pnpm-workspace.yaml")).toBe(
      "allowBuilds:\n  esbuild: true\n",
    );
    const paths = first.artifacts.map(({ path }) => path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain(".notion-kanban-blog/managed.json");
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/components/Breadcrumbs.astro",
        "src/components/PostCard.astro",
        "src/lib/blog.ts",
        "src/pages/404.astro",
        "src/pages/categories/[slug].astro",
        "src/pages/categories/index.astro",
        "src/pages/posts/index.astro",
      ]),
    );

    const contentConfig = readArtifact(
      first.artifacts,
      "src/content.config.ts",
    );
    expect(contentConfig).toContain("schemaVersion: 1 as const");
    expect(contentConfig).toContain("schemaVersion: z.literal(2)");
    expect(contentConfig).toContain('category: "미분류"');
    expect(contentConfig).toContain('categorySlug: "uncategorized"');
    expect(contentConfig).toContain(".strict()");
    expect(readArtifact(first.artifacts, "src/lib/blog.ts")).toContain(
      'export const base = "/"',
    );
    const layout = readArtifact(first.artifacts, "src/layouts/BaseLayout.astro");
    expect(layout).toContain('const siteOwner = "HappyDoran"');
    expect(layout).toContain('siteOwner + ".log"');
    expect(layout).toContain("siteOwner.match(/[A-Z]/g)");
    expect(layout).toContain('href={githubUrl} rel="me"');
    expect(layout).toContain(">주제</a>");
    const home = readArtifact(first.artifacts, "src/pages/index.astro");
    expect(home).toContain('class="hero-stats"');
    expect(home).toContain("배운 것을 기록하고");
    const post = readArtifact(first.artifacts, "src/pages/posts/[...slug].astro");
    expect(post).toContain('"article-layout"');
    expect(post).toContain('class="post-toc"');
  });

  it("creates a project-site template with a repository base path", () => {
    const manifest = createAstroTemplateManifest({
      defaultBranch: 'release/"pages"',
      owner: "HappyDoran",
      repository: "notion-notes",
    });

    expect(manifest.basePath).toBe("/notion-notes");
    expect(readArtifact(manifest.artifacts, "astro.config.mjs")).toContain(
      'base: "/notion-notes"',
    );
    expect(readArtifact(manifest.artifacts, "src/lib/blog.ts")).toContain(
      'export const base = "/notion-notes/"',
    );
    expect(
      readArtifact(manifest.artifacts, ".github/workflows/deploy.yml"),
    ).toContain('branches: ["release/\\"pages\\""]');
  });

  it("rejects names that could inject config or escape artifact paths", () => {
    expect(() =>
      createAstroTemplateManifest({
        defaultBranch: "main",
        owner: "owner",
        repository: "../pages",
      }),
    ).toThrow("Invalid GitHub repository");
    expect(() =>
      createAstroTemplateManifest({
        defaultBranch: "main",
        owner: "owner\nmalicious",
        repository: "owner.github.io",
      }),
    ).toThrow("Invalid GitHub owner");
    expect(() =>
      createAstroTemplateManifest({
        defaultBranch: "main\n  pull_request:",
        owner: "owner",
        repository: "owner.github.io",
      }),
    ).toThrow("Invalid GitHub default branch");
  });
});

function readArtifact(
  artifacts: ReturnType<typeof createAstroTemplateManifest>["artifacts"],
  path: string,
): string {
  const artifact = artifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) {
    throw new Error(`Missing artifact: ${path}`);
  }
  return decoder.decode(artifact.bytes);
}
