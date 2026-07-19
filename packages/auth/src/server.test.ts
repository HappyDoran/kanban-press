import { randomBytes } from "node:crypto";

import { entityId } from "@notion-kanban-blog/domain";
import { describe, expect, it } from "vitest";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
  decodeBase64UrlKey,
} from "./server.js";

const NOW = 2_000_000_000;
const ACTIVE_KEY = randomBytes(32);
const OLD_KEY = randomBytes(32);

function sessionCodec(
  overrides: Partial<Parameters<typeof createSessionCookieCodec>[0]> = {},
) {
  return createSessionCookieCodec({
    activeKeyId: "current",
    keys: {
      current: ACTIVE_KEY,
      old: OLD_KEY,
    },
    now: () => NOW,
    ...overrides,
  });
}

const session = {
  accessToken: "github-secret-access-token",
  expiresAt: NOW + 3_600,
  githubLogin: "octocat",
  issuedAt: NOW,
  userId: entityId("GitHubUser", "583231"),
};

describe("stateless session cookie codec", () => {
  it("round-trips a session without exposing plaintext", async () => {
    const codec = sessionCodec();

    const cookieValue = await codec.seal(session);

    expect(cookieValue).toMatch(/^v1\.current\.[A-Za-z0-9_-]+\./);
    expect(cookieValue).not.toContain(session.accessToken);
    expect(cookieValue).not.toContain(session.githubLogin);
    expect(cookieValue).not.toContain(session.userId);
    await expect(codec.open(cookieValue)).resolves.toEqual(session);
  });

  it("uses a fresh nonce for every seal", async () => {
    const codec = sessionCodec();

    const first = await codec.seal(session);
    const second = await codec.seal(session);

    expect(second).not.toBe(first);
    await expect(codec.open(first)).resolves.toEqual(session);
    await expect(codec.open(second)).resolves.toEqual(session);
  });

  it("rejects tampering without leaking decryption details", async () => {
    const codec = sessionCodec();
    const cookieValue = await codec.seal(session);
    const segments = cookieValue.split(".");
    const ciphertext = segments[3];
    if (ciphertext === undefined) {
      throw new Error("Expected ciphertext");
    }
    segments[3] = `${ciphertext.slice(0, -1)}${
      ciphertext.endsWith("A") ? "B" : "A"
    }`;

    await expect(codec.open(segments.join("."))).resolves.toBeNull();
    await expect(codec.open("not-an-envelope")).resolves.toBeNull();
  });

  it("rejects expired and implausibly future-issued sessions", async () => {
    const codec = sessionCodec();

    const expired = await sessionCodec({ now: () => NOW - 10 }).seal({
      ...session,
      expiresAt: NOW,
      issuedAt: NOW - 100,
    });
    await expect(codec.open(expired)).resolves.toBeNull();

    const future = await sessionCodec({ now: () => NOW + 100 }).seal({
      ...session,
      expiresAt: NOW + 4_000,
      issuedAt: NOW + 100,
    });
    await expect(codec.open(future)).resolves.toBeNull();
  });

  it("opens old-key cookies during rotation and rejects unknown keys", async () => {
    const oldCodec = sessionCodec({ activeKeyId: "old" });
    const oldCookie = await oldCodec.seal(session);

    await expect(sessionCodec().open(oldCookie)).resolves.toEqual(session);
    await expect(
      sessionCodec({ keys: { current: ACTIVE_KEY } }).open(oldCookie),
    ).resolves.toBeNull();
  });

  it("validates key material and cookie lifetime", async () => {
    expect(() =>
      sessionCodec({ keys: { current: randomBytes(31) } }),
    ).toThrow("exactly 32 bytes");
    expect(() => decodeBase64UrlKey("not-a-32-byte-key")).toThrow(
      "32-byte base64url",
    );
    await expect(
      sessionCodec().seal({ ...session, expiresAt: session.issuedAt }),
    ).rejects.toThrow("later than");
  });

  it("rejects a decrypted payload that fails its schema", async () => {
    const unsafeCodec = createEncryptedCookieCodec({
      activeKeyId: "current",
      keys: { current: ACTIVE_KEY },
      now: () => NOW,
      parsePayload: (value) => value,
    });
    const malformedSession = await unsafeCodec.seal(
      { accessToken: "", githubLogin: "octocat", userId: "583231" },
      { expiresAt: NOW + 100, issuedAt: NOW },
    );

    await expect(sessionCodec().open(malformedSession)).resolves.toBeNull();
  });
});
