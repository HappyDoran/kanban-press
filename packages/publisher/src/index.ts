import type { ContentItemId } from "@notion-kanban-blog/domain";

export interface PublisherManifest {
  assetBaseUrl: string;
  contentDirectory: string;
  publisher: "astro";
  schemaVersion: 1;
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
