import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { entityId } from "@kanban-press/domain";
import { z } from "zod";

import type { GitHubSession, SessionCodec, UnixTimestamp } from "./index.js";

// 쿠키 값: v1.<keyId>.<nonce>.<ciphertext>.<tag> (각 조각은 base64url, AES-256-GCM).
// 버전과 key ID를 AAD에 묶어, 다른 key나 버전으로 바꿔 끼운 쿠키는 복호화 단계에서 거절된다.
// 형식을 바꾸면 이미 발급된 사용자 쿠키를 열 수 없으므로 server.test.ts의 고정 쿠키가 깨진다.
const VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export interface CookieLifetime {
  expiresAt: UnixTimestamp;
  issuedAt?: UnixTimestamp;
}

export interface OpenedCookie<Payload> {
  expiresAt: UnixTimestamp;
  issuedAt: UnixTimestamp;
  payload: Payload;
}

export interface EncryptedCookieCodec<Payload> {
  /** 위조·만료·형식 오류는 이유를 구분하지 않고 모두 `null`이다. */
  open(cookieValue: string): Promise<OpenedCookie<Payload> | null>;
  seal(payload: Payload, lifetime: CookieLifetime): Promise<string>;
}

export interface EncryptedCookieCodecOptions<Payload> {
  activeKeyId: string;
  /** 다른 서버 시계가 조금 앞서 발급한 쿠키를 허용하는 폭(초). */
  clockToleranceSeconds?: number;
  /** key ID → 32-byte key. 회전 중에는 이전 key를 남겨 두면 기존 쿠키를 계속 연다. */
  keys: Readonly<Record<string, Uint8Array>>;
  now?: () => UnixTimestamp;
  /** 복호화된 payload를 검증한다. throw하면 `open`은 `null`을 돌려준다. */
  parsePayload: (value: unknown) => Payload;
}

const timestampSchema = z.number().int().nonnegative();
const envelopeSchema = z
  .object({
    expiresAt: timestampSchema,
    issuedAt: timestampSchema,
    payload: z.unknown(),
  })
  .refine((envelope) => envelope.expiresAt > envelope.issuedAt);

export function createEncryptedCookieCodec<Payload>(
  options: EncryptedCookieCodecOptions<Payload>,
): EncryptedCookieCodec<Payload> {
  const keys = new Map<string, Buffer>();
  for (const [keyId, key] of Object.entries(options.keys)) {
    assertKeyId(keyId);
    if (key.byteLength !== KEY_BYTES) {
      throw new Error("Cookie encryption keys must be exactly 32 bytes");
    }
    keys.set(keyId, Buffer.from(key));
  }
  assertKeyId(options.activeKeyId);
  const activeKey = keys.get(options.activeKeyId);
  if (activeKey === undefined) {
    throw new Error("The active cookie encryption key is missing");
  }
  const tolerance = options.clockToleranceSeconds ?? 30;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) {
    throw new Error("Cookie clock tolerance must be a non-negative integer");
  }
  const now = options.now ?? currentUnixTimestamp;

  return {
    async open(cookieValue) {
      try {
        const [version, keyId = "", ...encoded] = cookieValue.split(".");
        const key = keys.get(keyId);
        if (version !== VERSION || key === undefined || encoded.length !== 3) {
          return null;
        }
        const [nonce, ciphertext, tag] = encoded.map(decodeCanonicalBase64Url);
        if (
          nonce?.byteLength !== NONCE_BYTES ||
          !ciphertext?.byteLength ||
          tag?.byteLength !== TAG_BYTES
        ) {
          return null;
        }

        // 이름을 바꾸기 전(notion-kanban-blog) AAD로 봉인한 쿠키도 연다. 새로 봉인할 때는 새 AAD만 쓴다.
        const plaintext =
          decrypt(key, nonce, ciphertext, tag, aad(keyId)) ??
          decrypt(key, nonce, ciphertext, tag, legacyAad(keyId));
        if (plaintext === null) {
          return null;
        }

        const envelope = envelopeSchema.safeParse(
          JSON.parse(plaintext.toString()),
        );
        const current = now();
        if (
          !envelope.success ||
          current >= envelope.data.expiresAt ||
          envelope.data.issuedAt > current + tolerance
        ) {
          return null;
        }
        return {
          expiresAt: envelope.data.expiresAt,
          issuedAt: envelope.data.issuedAt,
          payload: options.parsePayload(envelope.data.payload),
        };
      } catch {
        return null;
      }
    },

    async seal(payload, lifetime) {
      const envelope = envelopeSchema.safeParse({
        expiresAt: lifetime.expiresAt,
        issuedAt: lifetime.issuedAt ?? now(),
        payload: options.parsePayload(payload),
      });
      if (!envelope.success) {
        throw new Error(
          "Cookie expiry must be later than its issue time and timestamps non-negative integers",
        );
      }

      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", activeKey, nonce, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(aad(options.activeKeyId));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(envelope.data)),
        cipher.final(),
      ]);
      return [
        VERSION,
        options.activeKeyId,
        nonce.toString("base64url"),
        ciphertext.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(".");
    },
  };
}

const sessionPayloadSchema = z
  .object({
    accessToken: z.string().min(1).max(4096),
    githubLogin: z.string().min(1).max(255),
    userId: z.string().min(1).max(255),
  })
  .strict();

type SessionPayload = Pick<GitHubSession, "accessToken" | "githubLogin" | "userId">;

/** GitHub 로그인 세션 쿠키. payload에는 token·login·user ID만 넣고 시각은 envelope가 가진다. */
export function createSessionCookieCodec(
  options: Omit<EncryptedCookieCodecOptions<SessionPayload>, "parsePayload">,
): SessionCodec {
  const codec = createEncryptedCookieCodec<SessionPayload>({
    ...options,
    parsePayload: (value) => {
      const payload = sessionPayloadSchema.parse(value);
      return { ...payload, userId: entityId("GitHubUser", payload.userId) };
    },
  });

  return {
    async open(cookieValue) {
      const opened = await codec.open(cookieValue);
      return (
        opened && {
          ...opened.payload,
          expiresAt: opened.expiresAt,
          issuedAt: opened.issuedAt,
        }
      );
    },
    seal: ({ accessToken, expiresAt, githubLogin, issuedAt, userId }) =>
      codec.seal({ accessToken, githubLogin, userId }, { expiresAt, issuedAt }),
  };
}

/** 환경 변수의 base64url key를 32-byte key로 바꾼다. */
export function decodeBase64UrlKey(encodedKey: string): Uint8Array {
  const key = decodeCanonicalBase64Url(encodedKey);
  if (key?.byteLength !== KEY_BYTES) {
    throw new Error("Cookie encryption keys must be 32-byte base64url values");
  }
  return key;
}

function assertKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error("Cookie key IDs must use 1-32 URL-safe characters");
  }
}

function aad(keyId: string): Buffer {
  return Buffer.from(`kanban-press.cookie.${VERSION}.${keyId}`);
}

/** 프로젝트 이름을 바꾸기 전(2026-11-10) 쿠키의 AAD. 열 때만 쓴다. */
function legacyAad(keyId: string): Buffer {
  return Buffer.from(`notion-kanban-blog.cookie.${VERSION}.${keyId}`);
}

/** AES-256-GCM 복호화. 인증 실패면 null. */
function decrypt(key: Uint8Array, nonce: Buffer, ciphertext: Buffer, tag: Buffer, additionalData: Buffer): Buffer | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

function currentUnixTimestamp(): UnixTimestamp {
  return Math.floor(Date.now() / 1000);
}

/** 같은 bytes를 여러 문자열로 표현하는 비정규 base64url은 거절한다. */
function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  const canonical = Buffer.from(decoded.toString("base64url"));
  const input = Buffer.from(value);
  return canonical.byteLength === input.byteLength &&
    timingSafeEqual(canonical, input)
    ? decoded
    : null;
}
