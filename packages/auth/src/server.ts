import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { entityId } from "@notion-kanban-blog/domain";
import { z } from "zod";

import type {
  GitHubSession,
  SessionCodec,
  UnixTimestamp,
} from "./index.js";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const AAD_PREFIX = "notion-kanban-blog.cookie";

export interface CookieLifetime {
  expiresAt: UnixTimestamp;
  issuedAt?: UnixTimestamp;
}

export interface OpenedCookie<Payload> {
  expiresAt: UnixTimestamp;
  issuedAt: UnixTimestamp;
  payload: Payload;
}

export type CookiePayloadParser<Payload> = (value: unknown) => Payload;

export interface EncryptedCookieCodec<Payload> {
  open(cookieValue: string): Promise<OpenedCookie<Payload> | null>;
  seal(payload: Payload, lifetime: CookieLifetime): Promise<string>;
}

export interface EncryptedCookieCodecOptions<Payload> {
  activeKeyId: string;
  clockToleranceSeconds?: number;
  keys: Readonly<Record<string, Uint8Array>>;
  now?: () => UnixTimestamp;
  parsePayload: CookiePayloadParser<Payload>;
}

interface PlaintextEnvelope {
  expiresAt: UnixTimestamp;
  issuedAt: UnixTimestamp;
  payload: unknown;
}

class AesGcmCookieCodec<Payload> implements EncryptedCookieCodec<Payload> {
  readonly #activeKeyId: string;
  readonly #clockToleranceSeconds: number;
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #now: () => UnixTimestamp;
  readonly #parsePayload: CookiePayloadParser<Payload>;

  constructor(options: EncryptedCookieCodecOptions<Payload>) {
    validateKeyId(options.activeKeyId);

    const keys = new Map<string, Buffer>();
    for (const [keyId, key] of Object.entries(options.keys)) {
      validateKeyId(keyId);
      if (key.byteLength !== KEY_BYTES) {
        throw new Error("Cookie encryption keys must be exactly 32 bytes");
      }
      keys.set(keyId, Buffer.from(key));
    }

    if (!keys.has(options.activeKeyId)) {
      throw new Error("The active cookie encryption key is missing");
    }

    const clockToleranceSeconds = options.clockToleranceSeconds ?? 30;
    if (
      !Number.isSafeInteger(clockToleranceSeconds) ||
      clockToleranceSeconds < 0
    ) {
      throw new Error("Cookie clock tolerance must be a non-negative integer");
    }

    this.#activeKeyId = options.activeKeyId;
    this.#clockToleranceSeconds = clockToleranceSeconds;
    this.#keys = keys;
    this.#now = options.now ?? currentUnixTimestamp;
    this.#parsePayload = options.parsePayload;
  }

  async open(cookieValue: string): Promise<OpenedCookie<Payload> | null> {
    try {
      const segments = cookieValue.split(".");
      if (segments.length !== 5) {
        return null;
      }

      const [version, keyId, encodedNonce, encodedCiphertext, encodedTag] =
        segments;
      if (
        version !== ENVELOPE_VERSION ||
        keyId === undefined ||
        encodedNonce === undefined ||
        encodedCiphertext === undefined ||
        encodedTag === undefined ||
        !KEY_ID_PATTERN.test(keyId)
      ) {
        return null;
      }

      const key = this.#keys.get(keyId);
      if (key === undefined) {
        return null;
      }

      const nonce = decodeCanonicalBase64Url(encodedNonce);
      const ciphertext = decodeCanonicalBase64Url(encodedCiphertext);
      const tag = decodeCanonicalBase64Url(encodedTag);
      if (
        nonce === null ||
        nonce.byteLength !== NONCE_BYTES ||
        ciphertext === null ||
        ciphertext.byteLength === 0 ||
        tag === null ||
        tag.byteLength !== TAG_BYTES
      ) {
        return null;
      }

      const decipher = createDecipheriv(ALGORITHM, key, nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aadFor(version, keyId));
      decipher.setAuthTag(tag);

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      const envelope = parsePlaintextEnvelope(JSON.parse(plaintext.toString()));
      if (envelope === null) {
        return null;
      }

      const now = this.#now();
      if (
        now >= envelope.expiresAt ||
        envelope.issuedAt > now + this.#clockToleranceSeconds
      ) {
        return null;
      }

      return {
        expiresAt: envelope.expiresAt,
        issuedAt: envelope.issuedAt,
        payload: this.#parsePayload(envelope.payload),
      };
    } catch {
      return null;
    }
  }

  async seal(payload: Payload, lifetime: CookieLifetime): Promise<string> {
    const issuedAt = lifetime.issuedAt ?? this.#now();
    assertUnixTimestamp(issuedAt);
    assertUnixTimestamp(lifetime.expiresAt);
    if (lifetime.expiresAt <= issuedAt) {
      throw new Error("Cookie expiry must be later than its issue time");
    }

    const validatedPayload = this.#parsePayload(payload);
    const plaintext = Buffer.from(
      JSON.stringify({
        expiresAt: lifetime.expiresAt,
        issuedAt,
        payload: validatedPayload,
      } satisfies PlaintextEnvelope),
    );
    const nonce = randomBytes(NONCE_BYTES);
    const key = this.#keys.get(this.#activeKeyId);
    if (key === undefined) {
      throw new Error("The active cookie encryption key is missing");
    }

    const cipher = createCipheriv(ALGORITHM, key, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(aadFor(ENVELOPE_VERSION, this.#activeKeyId));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      this.#activeKeyId,
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }
}

export function createEncryptedCookieCodec<Payload>(
  options: EncryptedCookieCodecOptions<Payload>,
): EncryptedCookieCodec<Payload> {
  return new AesGcmCookieCodec(options);
}

export function createSessionCookieCodec(
  options: Omit<
    EncryptedCookieCodecOptions<GitHubSessionPayload>,
    "parsePayload"
  >,
): SessionCodec {
  const codec = createEncryptedCookieCodec({
    ...options,
    parsePayload: parseGitHubSessionPayload,
  });

  return {
    async open(cookieValue) {
      const opened = await codec.open(cookieValue);
      if (opened === null) {
        return null;
      }
      return {
        ...opened.payload,
        expiresAt: opened.expiresAt,
        issuedAt: opened.issuedAt,
      };
    },
    seal(session) {
      return codec.seal(
        {
          accessToken: session.accessToken,
          githubLogin: session.githubLogin,
          userId: session.userId,
        },
        {
          expiresAt: session.expiresAt,
          issuedAt: session.issuedAt,
        },
      );
    },
  };
}

export function decodeBase64UrlKey(encodedKey: string): Uint8Array {
  const key = decodeCanonicalBase64Url(encodedKey);
  if (key === null || key.byteLength !== KEY_BYTES) {
    throw new Error("Cookie encryption keys must be 32-byte base64url values");
  }
  return key;
}

interface GitHubSessionPayload {
  accessToken: string;
  githubLogin: string;
  userId: GitHubSession["userId"];
}

const githubSessionPayloadSchema = z
  .object({
    accessToken: z.string().min(1).max(4096),
    githubLogin: z.string().min(1).max(255),
    userId: z.string().min(1).max(255),
  })
  .strict();

function parseGitHubSessionPayload(value: unknown): GitHubSessionPayload {
  const { accessToken, githubLogin, userId } =
    githubSessionPayloadSchema.parse(value);

  return {
    accessToken,
    githubLogin,
    userId: entityId("GitHubUser", userId),
  };
}

function parsePlaintextEnvelope(value: unknown): PlaintextEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  const { expiresAt, issuedAt, payload } = value;
  if (
    !isUnixTimestamp(expiresAt) ||
    !isUnixTimestamp(issuedAt) ||
    expiresAt <= issuedAt
  ) {
    return null;
  }
  return { expiresAt, issuedAt, payload };
}

function validateKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error("Cookie key IDs must use 1-32 URL-safe characters");
  }
}

function assertUnixTimestamp(value: number): void {
  if (!isUnixTimestamp(value)) {
    throw new Error("Cookie timestamps must be non-negative integers");
  }
}

function isUnixTimestamp(value: unknown): value is UnixTimestamp {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentUnixTimestamp(): UnixTimestamp {
  return Math.floor(Date.now() / 1000);
}

function aadFor(version: string, keyId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}.${version}.${keyId}`);
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  const canonical = Buffer.from(decoded.toString("base64url"));
  const input = Buffer.from(value);
  if (
    canonical.byteLength !== input.byteLength ||
    !timingSafeEqual(canonical, input)
  ) {
    return null;
  }
  return decoded;
}
