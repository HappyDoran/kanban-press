import { describe, expect, it } from "vitest";

import { createAstroTemplateManifest, DESIGN_TOKENS_CSS, RETIRED_TEMPLATE_PATHS } from "./index.js";

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
    expect(first.siteUrl).toBe("https://happydoran.github.io");
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
      readArtifact(first.artifacts, ".kanban-press/managed.json"),
    ).toBe('{\n  "publisher": "astro",\n  "templateVersion": 2\n}\n');
    expect(readArtifact(first.artifacts, "pnpm-workspace.yaml")).toBe(
      "allowBuilds:\n  esbuild: true\n",
    );
    const paths = first.artifacts.map(({ path }) => path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain(".kanban-press/managed.json");
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/components/Breadcrumbs.astro",
        "src/components/PostCard.astro",
        "src/lib/blog.ts",
        "src/pages/404.astro",
        "src/pages/archive.astro",
        "src/pages/posts/index.astro",
      ]),
    );
    // 지운 화면은 다시 만들지 않는다. 게시 commit이 저장소에서 지울 목록과 겹치지 않는다.
    expect(paths.filter((path) => RETIRED_TEMPLATE_PATHS.includes(path))).toEqual([]);

    const contentConfig = readArtifact(
      first.artifacts,
      "src/content.config.ts",
    );
    expect(contentConfig).toContain("schemaVersion: 1 as const");
    expect(contentConfig).toContain("schemaVersion: z.literal(2)");
    expect(contentConfig).toContain("category: retired");
    expect(contentConfig).toContain(".strict()");
    expect(readArtifact(first.artifacts, "src/lib/blog.ts")).toContain(
      'export const base = "/"',
    );
    const layout = readArtifact(first.artifacts, "src/layouts/BaseLayout.astro");
    const blogLib = readArtifact(first.artifacts, "src/lib/blog.ts");
    expect(blogLib).toContain('export const siteOwner = "HappyDoran"');
    expect(blogLib).toContain('title: siteOwner + ".log"');
    expect(blogLib).toContain('[".kanban-press", ".notion-kanban-blog"]');
    expect(layout).toContain("const siteName = site.title;");
    // 앱과 블로그가 같은 토큰 문자열을 쓴다(디자인 기획 10절).
    expect(layout).toContain(DESIGN_TOKENS_CSS);
    expect(layout).not.toContain("Gowun Batang");
    expect(layout).toContain('href={githubUrl} rel="me"');
    expect(layout).not.toContain(">주제</a>");
    const home = readArtifact(first.artifacts, "src/pages/index.astro");
    expect(home).toContain('class="hero-stats"');
    expect(home).toContain("{site.title}");
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

  it("serializes Pages deployments so back-to-back publishes do not collide", () => {
    const workflow = readArtifact(
      createAstroTemplateManifest({ defaultBranch: "main", owner: "owner", repository: "owner.github.io" }).artifacts,
      ".github/workflows/deploy.yml",
    );
    expect(workflow).toContain("concurrency:\n  group: pages\n  cancel-in-progress: false");
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
