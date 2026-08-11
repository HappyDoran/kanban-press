import { entityId } from "@notion-kanban-blog/domain";
import {
  createAstroTemplateManifest,
  createMarkdownArtifact,
} from "@notion-kanban-blog/publisher";
import { describe, it } from "vitest";
import { z } from "zod";

import { GitHubPagesClient } from "../github/pages";
import { NotionRestContentAdapter } from "../notion/content";
import {
  buildPublishDocument,
  type PublishSourceBlock,
} from "./document";
import {
  createPublishImageDependencies,
  materializePublishImages,
} from "./image-assets";

const smokeEnvironmentSchema = z.object({
  GITHUB_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  SMOKE_GITHUB_ACCESS_TOKEN: z.string().min(1).max(4_096),
  SMOKE_GITHUB_LOGIN: z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  SMOKE_GITHUB_USER_ID: z.string().regex(/^[1-9]\d{0,19}$/),
  SMOKE_NOTION_ACCESS_TOKEN: z.string().min(1).max(4_096),
  SMOKE_NOTION_PAGE_ID: z.string().uuid(),
});

describe("actual provider read-only smoke", () => {
  it("retrieves current Notion content and validates GitHub Pages readiness without mutation", async () => {
    const environment = smokeEnvironmentSchema.parse(process.env);
    const notion = new NotionRestContentAdapter({
      accessToken: environment.SMOKE_NOTION_ACCESS_TOKEN,
      apiVersion: environment.NOTION_API_VERSION,
    });
    const github = new GitHubPagesClient({
      accessToken: environment.SMOKE_GITHUB_ACCESS_TOKEN,
      apiVersion: environment.GITHUB_API_VERSION,
    });

    const [page, repository] = await Promise.all([
      notion.getPageContent(environment.SMOKE_NOTION_PAGE_ID),
      github.getPagesRepository(
        entityId("GitHubUser", environment.SMOKE_GITHUB_USER_ID),
        environment.SMOKE_GITHUB_LOGIN,
      ),
    ]);
    if (page.providerPageId !== environment.SMOKE_NOTION_PAGE_ID) {
      throw new Error("Provider smoke returned a mismatched Notion page");
    }

    const source = buildPublishDocument(page);
    const capabilityUrls = imageSourceUrls(source.blocks);
    const materialized = await materializePublishImages(
      source,
      createPublishImageDependencies(),
    );
    const template = createAstroTemplateManifest({
      defaultBranch: repository.defaultBranch,
      owner: environment.SMOKE_GITHUB_LOGIN,
      repository: repository.fullName.split("/")[1] ?? "",
    });
    const markdown = createMarkdownArtifact(materialized.document);
    const artifacts = [
      ...template.artifacts,
      ...materialized.artifacts,
      markdown,
    ];
    const readiness = await github.getRepositoryReadiness(
      repository,
      artifacts.map((artifact) => artifact.path),
    );
    if (readiness.state !== "ready") {
      throw new Error(`Provider smoke readiness failed: ${readiness.state}`);
    }

    const serializedArtifacts = artifacts
      .map((artifact) => `${artifact.path}\n${new TextDecoder().decode(artifact.bytes)}`)
      .join("\n");
    if (
      serializedArtifacts.includes(environment.SMOKE_GITHUB_ACCESS_TOKEN) ||
      serializedArtifacts.includes(environment.SMOKE_NOTION_ACCESS_TOKEN) ||
      capabilityUrls.some((url) => serializedArtifacts.includes(url))
    ) {
      throw new Error("Provider smoke detected protected data in artifacts");
    }
  });
});

function imageSourceUrls(blocks: readonly PublishSourceBlock[]): string[] {
  return blocks.flatMap((block): string[] =>
    block.kind === "image"
      ? [block.sourceUrl]
      : block.kind === "toggle"
        ? imageSourceUrls(block.children)
        : [],
  );
}
