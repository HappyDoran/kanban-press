// Notion REST 호출의 가장 아래 층: 요청 header, 실패 응답 분류, cursor pagination.
import { z } from "zod";

import {
  providerRequest,
  ProviderTransportError,
} from "../operations/provider-request";
import type { LogSink } from "../operations/structured-log";

export type NotionProviderErrorCode =
  | "access_denied"
  | "invalid_response"
  | "rate_limited"
  | "timeout"
  | "unavailable";

/** Notion 호출 실패. route는 code만 보고 사용자 응답을 고르며 provider 원문은 담지 않는다. */
export class NotionProviderError extends Error {
  override readonly name = "NotionProviderError";

  constructor(
    readonly code: NotionProviderErrorCode,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Notion provider request failed: ${code}`);
  }
}

export function invalidResponse(): NotionProviderError {
  return new NotionProviderError("invalid_response");
}

export interface NotionRequestOptions {
  accessToken: string;
  apiVersion: string;
  fetch?: typeof fetch;
  log?: LogSink;
  timeoutMs?: number;
}

/**
 * Notion REST JSON 요청. 실패 응답과 전송 오류는 `NotionProviderError`로 바꾸고,
 * JSON이 아닌 본문은 `null`로 돌려 호출한 쪽의 schema 검증에서 거절되게 한다.
 */
export async function notionJson(
  options: NotionRequestOptions,
  url: URL | string,
  operation: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await providerRequest({
      fetch: options.fetch ?? fetch,
      init: {
        body: body === undefined ? null : JSON.stringify(body),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.accessToken}`,
          "notion-version": options.apiVersion,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        method: body === undefined ? "GET" : "POST",
      },
      input: url,
      log: options.log,
      operation,
      provider: "notion",
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    throw error instanceof ProviderTransportError
      ? new NotionProviderError(error.code)
      : error;
  }
  if (!response.ok) {
    throw providerError(response);
  }
  return response.json().catch(() => null);
}

const listResponseSchema = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().min(1).nullable(),
  results: z.array(z.unknown()),
});

/**
 * `has_more`/`next_cursor` 목록을 끝까지 모은다.
 * 같은 cursor가 다시 오거나 결과가 `maxResults`를 넘으면 무한 반복 대신 거절한다.
 */
export async function listAll(
  fetchPage: (cursor: string | null) => Promise<unknown>,
  maxResults: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = listResponseSchema.safeParse(await fetchPage(cursor));
    if (!page.success || (page.data.has_more && page.data.next_cursor === null)) {
      throw invalidResponse();
    }
    results.push(...page.data.results);
    if (results.length > maxResults) {
      throw invalidResponse();
    }
    cursor = page.data.has_more ? page.data.next_cursor : null;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw invalidResponse();
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== null);
  return results;
}

/** 401·403은 권한 철회, 429는 1시간 이내로 자른 `Retry-After`, 나머지는 일시 장애로 본다. */
function providerError(response: Response): NotionProviderError {
  if (response.status === 401 || response.status === 403) {
    return new NotionProviderError("access_denied");
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    return new NotionProviderError(
      "rate_limited",
      Number.isSafeInteger(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter, 3_600) : null,
    );
  }
  return new NotionProviderError("unavailable");
}
