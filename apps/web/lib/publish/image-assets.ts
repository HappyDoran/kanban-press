import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type {
  PublishArtifact,
  PublishBlock,
  PublishDocument,
} from "@notion-kanban-blog/publisher";

import type {
  PublishSourceBlock,
  PublishSourceDocument,
} from "./document";

const MAX_IMAGE_COUNT = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_IMAGE_BYTES = 32 * 1024 * 1024;
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
  const imageCount = countImages(source.blocks, 0);
  if (imageCount > MAX_IMAGE_COUNT) {
    throw new InvalidPublishImageError("count_limit");
  }

  const artifacts: PublishArtifact[] = [];
  let imageIndex = 0;
  let totalBytes = 0;

  const convertBlocks = async (
    blocks: readonly PublishSourceBlock[],
    depth: number,
  ): Promise<PublishBlock[]> => {
    if (depth > MAX_BLOCK_DEPTH) {
      throw new InvalidPublishImageError("depth_limit");
    }
    const converted: PublishBlock[] = [];
    for (const block of blocks) {
      if (block.kind === "image") {
        imageIndex += 1;
        const downloaded = await downloadImage(
          block.sourceUrl,
          dependencies,
        );
        totalBytes += downloaded.bytes.byteLength;
        if (totalBytes > MAX_DOCUMENT_IMAGE_BYTES) {
          throw new InvalidPublishImageError("document_byte_limit");
        }
        const filename = `image-${String(imageIndex).padStart(3, "0")}.${downloaded.extension}`;
        artifacts.push({
          bytes: downloaded.bytes,
          path: `src/assets/blog/${source.slug}/${filename}`,
        });
        converted.push({
          assetPath: `../../assets/blog/${source.slug}/${filename}`,
          caption: block.caption,
          kind: "image",
        });
        continue;
      }
      if (block.kind === "toggle") {
        converted.push({
          children: await convertBlocks(block.children, depth + 1),
          kind: "toggle",
          summary: block.summary,
        });
        continue;
      }
      converted.push(block);
    }
    return converted;
  };

  return {
    artifacts,
    document: {
      ...source,
      blocks: await convertBlocks(source.blocks, 0),
    },
  };
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

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false;
    }
    const value = parts.reduce(
      (result, part) => (result << 8n) | BigInt(part),
      0n,
    );
    return ![
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([network, prefix]) =>
      matchesPrefix(value, ipv4Value(network as string), prefix as number, 32),
    );
  }
  if (family === 6) {
    const value = ipv6Value(address);
    if (value === null) {
      return false;
    }
    const globalUnicast = matchesPrefix(
      value,
      ipv6Value("2000::") ?? 0n,
      3,
      128,
    );
    const special2001 = matchesPrefix(
      value,
      ipv6Value("2001::") ?? 0n,
      23,
      128,
    );
    const sixToFour = matchesPrefix(
      value,
      ipv6Value("2002::") ?? 0n,
      16,
      128,
    );
    const documentation = matchesPrefix(
      value,
      ipv6Value("2001:db8::") ?? 0n,
      32,
      128,
    );
    const documentation2024 = matchesPrefix(
      value,
      ipv6Value("3fff::") ?? 0n,
      20,
      128,
    );
    return (
      globalUnicast &&
      !special2001 &&
      !sixToFour &&
      !documentation &&
      !documentation2024
    );
  }
  return false;
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
        dependencies.request(current, addresses[0]!, controller.signal),
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
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
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

function countImages(
  blocks: readonly PublishSourceBlock[],
  depth: number,
): number {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new InvalidPublishImageError("depth_limit");
  }
  return blocks.reduce(
    (count, block) =>
      count +
      (block.kind === "image"
        ? 1
        : block.kind === "toggle"
          ? countImages(block.children, depth + 1)
          : 0),
    0,
  );
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
          accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
          "user-agent": "notion-kanban-blog-image-fetch/1",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
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

function matchesPrefix(
  value: bigint,
  network: bigint,
  prefix: number,
  bits: number,
): boolean {
  const shift = BigInt(bits - prefix);
  return value >> shift === network >> shift;
}

function ipv4Value(address: string): bigint {
  return address
    .split(".")
    .map(Number)
    .reduce((result, part) => (result << 8n) | BigInt(part), 0n);
}

function ipv6Value(address: string): bigint | null {
  if (address.includes(".")) {
    return null;
  }
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.reduce(
    (result, group) => (result << 16n) | BigInt(`0x${group}`),
    0n,
  );
}
