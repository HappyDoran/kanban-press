import { describe, expect, it } from "vitest";

import { createAstroTemplateManifest } from "./index.js";

const decoder = new TextDecoder();

describe("createAstroTemplateManifest", () => {
  it("creates a deterministic user-site template rooted at slash", () => {
    const first = createAstroTemplateManifest({
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    const second = createAstroTemplateManifest({
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });

    expect(first).toEqual(second);
    expect(first.basePath).toBe("/");
    expect(first.siteUrl).toBe("https://HappyDoran.github.io");
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
    expect(workflow).not.toContain("withastro/action");
    expect(readArtifact(first.artifacts, "pnpm-workspace.yaml")).toBe(
      "allowBuilds:\n  esbuild: true\n",
    );
    expect(first.artifacts.map(({ path }) => path)).toEqual(
      [...first.artifacts.map(({ path }) => path)].sort(),
    );
  });

  it("creates a project-site template with a repository base path", () => {
    const manifest = createAstroTemplateManifest({
      owner: "HappyDoran",
      repository: "notion-notes",
    });

    expect(manifest.basePath).toBe("/notion-notes");
    expect(readArtifact(manifest.artifacts, "astro.config.mjs")).toContain(
      'base: "/notion-notes"',
    );
  });

  it("rejects names that could inject config or escape artifact paths", () => {
    expect(() =>
      createAstroTemplateManifest({
        owner: "owner",
        repository: "../pages",
      }),
    ).toThrow("Invalid GitHub repository");
    expect(() =>
      createAstroTemplateManifest({
        owner: "owner\nmalicious",
        repository: "owner.github.io",
      }),
    ).toThrow("Invalid GitHub owner");
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
