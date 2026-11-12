import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

import type {
  PublishArtifact,
  PublishBlock,
  PublishDocument,
} from "@kanban-press/publisher";

import { TaskLimiter } from "@/lib/shared/task-limiter";

import type {
  PublishSourceBlock,
  PublishSourceDocument,
} from "./document";

const MAX_IMAGE_COUNT = 100;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_IMAGE_BYTES = 64 * 1024 * 1024;
// 한 장씩 받으면 이미지가 많은 글이 서버 함수 시간을 넘기므로 4장씩 함께 받는다.
const IMAGE_CONCURRENCY = 4;
const MAX_REDIRECTS = 3;
const IMAGE_TIMEOUT_MS = 10_000;
const MAX_BLOCK_DEPTH = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MIME_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
] as const);

export interface ResolvedImageAddress {
  address: string;
  family: 4 | 6;
}

export interface ImageHttpResponse {
  body: AsyncIterable<Uint8Array>;
  close(): void;
  headers: Readonly<Record<string, string | undefined>>;
  status: number;
}

export interface PublishImageDependencies {
  request(
    url: URL,
    address: ResolvedImageAddress,
    signal: AbortSignal,
  ): Promise<ImageHttpResponse>;
  resolve(hostname: string): Promise<readonly ResolvedImageAddress[]>;
  timeoutMs?: number;
}

export class InvalidPublishImageError extends Error {
  readonly code = "invalid_publish_image";
  override readonly name = "InvalidPublishImageError";

  constructor(readonly reason: string) {
    super(`Invalid publish image: ${reason}`);
  }
}

export async function materializePublishImages(
  source: PublishSourceDocument,
  dependencies: PublishImageDependencies,
): Promise<{
  artifacts: PublishArtifact[];
  document: PublishDocument;
}> {
  // 본문 순서대로 이미지를 모아 4장씩 함께 받는다. 하나라도 실패하거나 전체 용량을 넘으면 남은 요청은 시작하지 않는다.
  const sources: string[] = [];
  collectImageUrls(source.blocks, 0, sources);
  if (sources.length > MAX_IMAGE_COUNT) {
    throw new InvalidPublishImageError("count_limit");
  }
  const limiter = new TaskLimiter(IMAGE_CONCURRENCY);
  let stopped = false;
  let totalBytes = 0;
  const downloads = await Promise.all(
    sources.map((sourceUrl) =>
      limiter.run(async () => {
        if (stopped) {
          return null;
        }
        try {
          const downloaded = await downloadImage(sourceUrl, dependencies);
          totalBytes += downloaded.bytes.byteLength;
          if (totalBytes > MAX_DOCUMENT_IMAGE_BYTES) {
            throw new InvalidPublishImageError("document_byte_limit");
          }
          return downloaded;
        } catch (error) {
          stopped = true;
          throw error;
        }
      }),
    ),
  );

  const artifacts: PublishArtifact[] = [];
  let imageIndex = 0;

  const convertBlocks = (blocks: readonly PublishSourceBlock[]): PublishBlock[] =>
    blocks.map((block): PublishBlock => {
      if (block.kind === "image") {
        const downloaded = downloads[imageIndex]!;
        imageIndex += 1;
        const filename = `image-${String(imageIndex).padStart(3, "0")}.${downloaded.extension}`;
        artifacts.push({
          bytes: downloaded.bytes,
          path: `src/assets/blog/${source.slug}/${filename}`,
        });
        return {
          assetPath: `../../assets/blog/${source.slug}/${filename}`,
          caption: block.caption,
          kind: "image",
        };
      }
      if ("children" in block) {
        return { ...block, children: convertBlocks(block.children) };
      }
      return block;
    });

  const document = { ...source, blocks: convertBlocks(source.blocks) };
  return { artifacts, document };
}

function collectImageUrls(blocks: readonly PublishSourceBlock[], depth: number, urls: string[]): void {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new InvalidPublishImageError("depth_limit");
  }
  for (const block of blocks) {
    if (block.kind === "image") {
      urls.push(block.sourceUrl);
    } else if ("children" in block) {
      collectImageUrls(block.children, depth + 1, urls);
    }
  }
}

export function createPublishImageDependencies(): PublishImageDependencies {
  return {
    request: requestPinnedImage,
    resolve: async (hostname) => {
      const addresses = await dnsLookup(hostname, {
        all: true,
        verbatim: true,
      });
      return addresses.flatMap((entry) =>
        entry.family === 4 || entry.family === 6
          ? [{ address: entry.address, family: entry.family }]
          : [],
      );
    },
  };
}

// 공개 unicast 주소만 허용한다. IPv4는 사설·예약 대역을 막고, IPv6는 2000::/3 안에서 특수 대역을 뺀다.
// IPv4-mapped IPv6(::ffff:127.0.0.1)는 2000::/3 밖이라 막힌다.
const blockedIPv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blockedIPv4.addSubnet(network, prefix, "ipv4");
}
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
const blockedIPv6 = new BlockList();
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blockedIPv6.addSubnet(network, prefix, "ipv6");
}

export function isPublicImageAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !blockedIPv4.check(address, "ipv4");
    case 6:
      return globalIPv6.check(address, "ipv6") && !blockedIPv6.check(address, "ipv6");
    default:
      return false;
  }
}

async function downloadImage(
  sourceUrl: string,
  dependencies: PublishImageDependencies,
): Promise<{ bytes: Uint8Array; extension: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? IMAGE_TIMEOUT_MS,
  );

  try {
    let current = parseImageUrl(sourceUrl);
    const visited = new Set<string>();
    for (let redirects = 0; ; redirects += 1) {
      if (controller.signal.aborted) {
        throw new InvalidPublishImageError("timeout");
      }
      const key = current.href;
      if (visited.has(key)) {
        throw new InvalidPublishImageError("redirect_loop");
      }
      visited.add(key);

      const addresses = await abortable(
        dependencies.resolve(current.hostname),
        controller.signal,
      );
      if (
        addresses.length === 0 ||
        addresses.some(
          (entry) =>
            (entry.family !== 4 && entry.family !== 6) ||
            !isPublicImageAddress(entry.address),
        )
      ) {
        throw new InvalidPublishImageError("blocked_address");
      }

      const response = await abortable(
        // 서버 함수에는 IPv6 outbound가 없을 수 있어 검증한 주소 중 IPv4를 먼저 쓴다.
        dependencies.request(current, addresses.find((entry) => entry.family === 4) ?? addresses[0]!, controller.signal),
        controller.signal,
      );
      if (REDIRECT_STATUSES.has(response.status)) {
        response.close();
        if (redirects >= MAX_REDIRECTS) {
          throw new InvalidPublishImageError("redirect_limit");
        }
        const location = response.headers.location;
        if (!location) {
          throw new InvalidPublishImageError("invalid_redirect");
        }
        try {
          current = parseImageUrl(new URL(location, current).href);
        } catch {
          throw new InvalidPublishImageError("invalid_redirect");
        }
        continue;
      }
      if (response.status !== 200) {
        response.close();
        throw new InvalidPublishImageError("http_status");
      }
      try {
        const mime = response.headers["content-type"]
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const extension = mime ? MIME_EXTENSIONS.get(mime) : undefined;
        if (!extension) {
          throw new InvalidPublishImageError("mime_type");
        }
        const declaredLength = parseContentLength(
          response.headers["content-length"],
        );
        if (declaredLength !== null && declaredLength > MAX_IMAGE_BYTES) {
          throw new InvalidPublishImageError("byte_limit");
        }

        const chunks: Uint8Array[] = [];
        let length = 0;
        for await (const chunk of response.body) {
          if (controller.signal.aborted) {
            throw new InvalidPublishImageError("timeout");
          }
          length += chunk.byteLength;
          if (length > MAX_IMAGE_BYTES) {
            throw new InvalidPublishImageError("byte_limit");
          }
          chunks.push(chunk);
        }
        if (declaredLength !== null && declaredLength !== length) {
          throw new InvalidPublishImageError("content_length_mismatch");
        }
        const bytes = new Uint8Array(Buffer.concat(chunks));
        if (!matchesImageSignature(bytes, mime!)) {
          throw new InvalidPublishImageError("mime_content_mismatch");
        }
        return { bytes, extension };
      } finally {
        response.close();
      }
    }
  } catch (error) {
    if (error instanceof InvalidPublishImageError) {
      throw error;
    }
    throw new InvalidPublishImageError(
      controller.signal.aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseImageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidPublishImageError("url");
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new InvalidPublishImageError("url");
  }
  return url;
}

/**
 * 검증한 주소 하나만 돌려주는 DNS lookup. Node 20+는 autoSelectFamily 때문에 `{ all: true }`로 불러 배열을
 * 기대한다. 주소 하나로 답하면 `ERR_INVALID_IP_ADDRESS`로 모든 이미지가 `network` 실패가 된다.
 */
export function pinnedLookup(address: ResolvedImageAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

async function requestPinnedImage(
  url: URL,
  address: ResolvedImageAddress,
  signal: AbortSignal,
): Promise<ImageHttpResponse> {
  return await new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: {
          // 받을 수 없는 AVIF를 요청하면 협상하는 CDN이 AVIF를 줘 mime_type으로 실패한다.
          accept: "image/webp,image/png,image/jpeg,image/gif",
          "user-agent": "kanban-press-image-fetch/1",
        },
        lookup: pinnedLookup(address),
        method: "GET",
        signal,
      },
      (response) => {
        resolve({
          body: response,
          close: () => response.destroy(),
          headers: {
            "content-length": singleHeader(response.headers["content-length"]),
            "content-type": singleHeader(response.headers["content-type"]),
            location: singleHeader(response.headers.location),
          },
          status: response.statusCode ?? 0,
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseContentLength(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new InvalidPublishImageError("content_length");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidPublishImageError("content_length");
  }
  return parsed;
}

function matchesImageSignature(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "image/gif": {
      const signature = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
      return signature === "GIF87a" || signature === "GIF89a";
    }
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => bytes[index] === value,
      );
    case "image/webp":
      return (
        new TextDecoder("ascii").decode(bytes.subarray(0, 4)) === "RIFF" &&
        new TextDecoder("ascii").decode(bytes.subarray(8, 12)) === "WEBP"
      );
    default:
      return false;
  }
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw new InvalidPublishImageError("timeout");
  }
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new InvalidPublishImageError("timeout")),
        { once: true },
      );
    }),
  ]);
}
