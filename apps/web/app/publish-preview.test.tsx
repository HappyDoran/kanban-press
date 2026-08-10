import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublishSourceDocument } from "../lib/publish/document";
import { createPublishPreviewResponse } from "../lib/publish/preview";
import {
  previewErrorMessage,
  PublishPreviewContent,
} from "./publish-preview";

const document: PublishSourceDocument = {
  blocks: [
    {
      kind: "paragraph",
      richText: [
        {
          bold: true,
          href: "https://example.com/article",
          text: "<script>alert('unsafe')</script>",
        },
      ],
    },
    {
      caption: [{ text: "이미지 설명" }],
      kind: "image",
      sourceUrl: "https://files.notion.example/image.png?token=secret",
    },
    {
      children: [{ kind: "divider" }],
      kind: "toggle",
      summary: [{ text: "자세히 보기" }],
    },
  ],
  category: { name: "개발", slug: "category-a1b2c3d4" },
  description: "프리뷰 설명",
  publishedAt: "2026-08-09T00:00:00.000Z",
  schemaVersion: 2,
  slug: "preview-post-a1b2c3d4",
  tags: ["Notion", "Preview"],
  title: "안전한 프리뷰",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe("PublishPreviewContent", () => {
  it("renders typed blocks as escaped React nodes with metadata and no image URL", () => {
    const preview = createPublishPreviewResponse(
      document,
      "2026-08-10T00:00:00.000Z",
    );
    const html = renderToStaticMarkup(
      createElement(PublishPreviewContent, { preview }),
    );

    expect(html).toContain("안전한 프리뷰");
    expect(html).toContain("예상 경로 /posts/preview-post-a1b2c3d4/");
    expect(html).toContain("#Notion");
    expect(html).toContain("&lt;script&gt;alert(&#x27;unsafe&#x27;)&lt;/script&gt;");
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain("이미지는 이 프리뷰에 표시되지 않습니다");
    expect(html).toContain("프리뷰 경고");
    expect(html).not.toContain("files.notion.example");
    expect(html).not.toContain("token=secret");
    expect(html).not.toContain("<script");
  });
});

describe("previewErrorMessage", () => {
  it("maps permission, metadata, rate limit, and retry errors to actionable guidance", () => {
    expect(previewErrorMessage("notion_access_denied")).toContain("권한");
    expect(previewErrorMessage("invalid_blog_metadata")).toContain("예약 속성");
    expect(previewErrorMessage("notion_rate_limited")).toContain("잠시");
    expect(previewErrorMessage("preview_unavailable")).toContain("다시 시도");
  });
});
