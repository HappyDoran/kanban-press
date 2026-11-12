import { describe, expect, it, vi } from "vitest";

import type { PublishSourceDocument } from "./document";
import {
  InvalidPublishImageError,
  isPublicImageAddress,
  materializePublishImages,
  pinnedLookup,
  type ImageHttpResponse,
  type PublishImageDependencies,
  type ResolvedImageAddress,
} from "./image-assets";

const SIGNED_URL =
  "https://files.notion.example/private.png?X-Amz-Signature=provider-secret";
const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 as const };
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function documentWithImages(urls: readonly string[]): PublishSourceDocument {
  return {
    blocks: urls.map((sourceUrl, index) => ({
      caption: [{ text: `이미지 ${index + 1}` }],
      kind: "image" as const,
      sourceUrl,
    })),
    description: "로컬 이미지 자산",
    publishedAt: "2026-08-09T00:00:00.000Z",
    schemaVersion: 2,
    slug: "safe-post-a1b2c3d4",
    tags: [],
    title: "안전한 이미지",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

function response({
  body = [PNG_SIGNATURE],
  contentLength,
  contentType = "image/png",
  location,
  status = 200,
}: {
  body?: readonly Uint8Array[];
  contentLength?: string;
  contentType?: string;
  location?: string;
  status?: number;
} = {}): ImageHttpResponse {
  const close = vi.fn();
  return {
    body: (async function* () {
      for (const chunk of body) {
        yield chunk;
      }
    })(),
    close,
    headers: {
      "content-length": contentLength,
      "content-type": contentType,
      location,
    },
    status,
  };
}

function dependencies(
  overrides: Partial<PublishImageDependencies> = {},
): PublishImageDependencies {
  return {
    request: vi.fn().mockResolvedValue(response()),
    resolve: vi.fn().mockResolvedValue([PUBLIC_ADDRESS]),
    ...overrides,
  };
}

describe("publish image assets", () => {
  it("pins every HTTPS redirect hop and emits only a local Astro asset path", async () => {
    const first = response({
      location:
        "https://cdn.notion.example/final.webp?X-Amz-Signature=redirect-secret",
      status: 302,
    });
    const second = response({
      body: [
        new TextEncoder().encode("RIFF"),
        new Uint8Array([4, 0, 0, 0]),
        new TextEncoder().encode("WEBP"),
      ],
      contentLength: "12",
      contentType: "image/webp; charset=binary",
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([PUBLIC_ADDRESS])
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);

    const result = await materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({ request, resolve }),
    );

    expect(resolve).toHaveBeenNthCalledWith(1, "files.notion.example");
    expect(resolve).toHaveBeenNthCalledWith(2, "cdn.notion.example");
    expect(request.mock.calls[0]?.[1]).toEqual(PUBLIC_ADDRESS);
    expect(request.mock.calls[1]?.[1]).toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(result.artifacts).toEqual([
      {
        bytes: new Uint8Array([
          82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80,
        ]),
        path: "src/assets/blog/safe-post-a1b2c3d4/image-001.webp",
      },
    ]);
    expect(result.document.blocks).toEqual([
      {
        assetPath:
          "../../assets/blog/safe-post-a1b2c3d4/image-001.webp",
        caption: [{ text: "이미지 1" }],
        kind: "image",
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("notion.example");
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("provider-secret");
  });

  it.each(["image/svg+xml", "text/html", "application/octet-stream", ""])(
    "rejects unsupported or missing MIME %s",
    async (contentType) => {
      const task = materializePublishImages(
        documentWithImages([SIGNED_URL]),
        dependencies({
          request: vi.fn().mockResolvedValue(response({ contentType })),
        }),
      );
      await expect(task).rejects.toMatchObject({
        code: "invalid_publish_image",
        reason: "mime_type",
      });
    },
  );

  it("connects to a verified IPv4 address when DNS also answers IPv6", async () => {
    const request = vi.fn().mockResolvedValue(response());
    await materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request,
        resolve: vi.fn().mockResolvedValue([{ address: "2606:4700::1", family: 6 }, PUBLIC_ADDRESS]),
      }),
    );
    expect(request.mock.calls[0]?.[1]).toEqual(PUBLIC_ADDRESS);
  });

  it("answers Node's all-addresses lookup with only the pinned address", () => {
    const lookup = pinnedLookup(PUBLIC_ADDRESS);
    const all = vi.fn();
    const single = vi.fn();
    lookup("cdn.example", { all: true }, all);
    lookup("cdn.example", {}, single);
    expect(all).toHaveBeenCalledWith(null, [PUBLIC_ADDRESS]);
    expect(single).toHaveBeenCalledWith(null, PUBLIC_ADDRESS.address, 4);
  });

  it("materializes images nested in structural Notion blocks", async () => {
    const source = documentWithImages([]);
    source.blocks = [
      {
        children: [
          {
            children: [
              {
                caption: [{ text: "중첩 이미지" }],
                kind: "image",
                sourceUrl: SIGNED_URL,
              },
            ],
            kind: "listItem",
            richText: [{ text: "목록" }],
            style: "bulleted",
          },
        ],
        icon: "📌",
        kind: "callout",
        richText: [{ text: "안내" }],
      },
    ];

    const result = await materializePublishImages(source, dependencies());

    expect(result.artifacts).toHaveLength(1);
    expect(JSON.stringify(result.document.blocks)).toContain(
      "../../assets/blog/safe-post-a1b2c3d4/image-001.png",
    );
    expect(JSON.stringify(result)).not.toContain("notion.example");
  });

  it("rejects bytes whose file signature does not match the declared MIME", async () => {
    const task = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockResolvedValue(
          response({
            body: [new TextEncoder().encode("<html>not an image</html>")],
            contentType: "image/png",
          }),
        ),
      }),
    );
    await expect(task).rejects.toMatchObject({
      reason: "mime_content_mismatch",
    });
  });

  it("enforces both declared and streamed byte limits", async () => {
    const declared = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockResolvedValue(
          response({ contentLength: String(8 * 1024 * 1024 + 1) }),
        ),
      }),
    );
    await expect(declared).rejects.toMatchObject({ reason: "byte_limit" });

    const streamed = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockResolvedValue(
          response({ body: [new Uint8Array(8 * 1024 * 1024 + 1)] }),
        ),
      }),
    );
    await expect(streamed).rejects.toMatchObject({ reason: "byte_limit" });

    const mismatch = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockResolvedValue(
          response({ contentLength: "4" }),
        ),
      }),
    );
    await expect(mismatch).rejects.toMatchObject({
      reason: "content_length_mismatch",
    });
  });

  it("limits total image bytes and image count before commit artifacts exist", async () => {
    const eightMiB = new Uint8Array(8 * 1024 * 1024);
    eightMiB.set(PNG_SIGNATURE);
    const total = materializePublishImages(
      documentWithImages(Array<string>(9).fill(SIGNED_URL)),
      dependencies({
        request: vi.fn().mockImplementation(() =>
          Promise.resolve(
            response({ body: [eightMiB], contentLength: String(eightMiB.length) }),
          ),
        ),
      }),
    );
    await expect(total).rejects.toMatchObject({
      reason: "document_byte_limit",
    });

    const request = vi.fn();
    const count = materializePublishImages(
      documentWithImages(Array<string>(101).fill(SIGNED_URL)),
      dependencies({ request }),
    );
    await expect(count).rejects.toMatchObject({ reason: "count_limit" });
    expect(request).not.toHaveBeenCalled();
  });

  it("downloads at most four images at once and keeps body order", async () => {
    let active = 0;
    let peak = 0;
    const request = vi.fn().mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return response();
    });
    const result = await materializePublishImages(
      documentWithImages(Array<string>(30).fill(SIGNED_URL)),
      dependencies({ request }),
    );
    expect(peak).toBe(4);
    expect(result.artifacts.map((artifact) => artifact.path).at(-1)).toBe(
      "src/assets/blog/safe-post-a1b2c3d4/image-030.png",
    );
  });

  it.each([
    "http://files.notion.example/image.png",
    "https://user:password@files.notion.example/image.png",
    "https://files.notion.example:8443/image.png",
    "https://files.notion.example/image.png#fragment",
  ])("rejects invalid image capability URL without network access: %s", async (url) => {
    const request = vi.fn();
    const resolve = vi.fn();
    await expect(
      materializePublishImages(
        documentWithImages([url]),
        dependencies({ request, resolve }),
      ),
    ).rejects.toMatchObject({ reason: "url" });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects redirect downgrade, loops, and more than three hops", async () => {
    const downgrade = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockResolvedValue(
          response({ location: "http://public.example/image.png", status: 302 }),
        ),
      }),
    );
    await expect(downgrade).rejects.toMatchObject({
      reason: "invalid_redirect",
    });

    const loop = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockResolvedValue(
          response({ location: SIGNED_URL, status: 302 }),
        ),
      }),
    );
    await expect(loop).rejects.toMatchObject({ reason: "redirect_loop" });

    let hop = 0;
    const redirectLimit = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request: vi.fn().mockImplementation(() =>
          Promise.resolve(
            response({
              location: `https://public.example/image-${++hop}.png`,
              status: 302,
            }),
          ),
        ),
      }),
    );
    await expect(redirectLimit).rejects.toMatchObject({
      reason: "redirect_limit",
    });
  });

  it("aborts an image request at the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const task = materializePublishImages(
        documentWithImages([SIGNED_URL]),
        dependencies({
          request: vi.fn(
            (
              _url: URL,
              _address: ResolvedImageAddress,
              signal: AbortSignal,
            ): Promise<ImageHttpResponse> =>
              new Promise<ImageHttpResponse>((_resolve, reject) => {
                signal.addEventListener(
                  "abort",
                  () => reject(new Error("provider URL must not escape")),
                  { once: true },
                );
              }),
          ),
          timeoutMs: 25,
        }),
      );
      const assertion = expect(task).rejects.toMatchObject({
        reason: "timeout",
      });
      await vi.advanceTimersByTimeAsync(26);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("image SSRF address policy", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "ff00::1",
  ])("blocks private or reserved address %s", (address) => {
    expect(isPublicImageAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])(
    "allows public unicast address %s",
    (address) => {
      expect(isPublicImageAddress(address)).toBe(true);
    },
  );

  it("rejects a hostname if any DNS answer is not public and never opens a socket", async () => {
    const request = vi.fn();
    const task = materializePublishImages(
      documentWithImages([SIGNED_URL]),
      dependencies({
        request,
        resolve: vi.fn().mockResolvedValue([
          PUBLIC_ADDRESS,
          { address: "169.254.169.254", family: 4 },
        ]),
      }),
    );
    await expect(task).rejects.toBeInstanceOf(InvalidPublishImageError);
    await expect(task).rejects.toMatchObject({ reason: "blocked_address" });
    expect(request).not.toHaveBeenCalled();
  });
});
