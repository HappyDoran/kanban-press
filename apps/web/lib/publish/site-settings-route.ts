// `/api/blog/settings`: 사이트 설정 읽기·저장(R11, 결정 D3). 저장은 설정 파일 하나만 바꾸는 commit이다.
import type { SessionCodec } from "@notion-kanban-blog/auth";

import { createGitHubAuthDependencies } from "../auth/github";
import { errorResponse, readSession } from "../auth/session";
import { GitHubPagesClient } from "../github/pages";

import { NO_STORE_HEADERS, notReadyResponse, pageErrorResponse, templatePaths } from "./orchestration";
import {
  defaultSiteSettings,
  serializeSiteSettings,
  SITE_SETTINGS_PATH,
  siteSettingsSchema,
} from "./site-settings";

const MAX_REQUEST_BYTES = 4_096;

type SiteSettingsClient = Pick<
  GitHubPagesClient,
  "commitArtifacts" | "getPagesRepository" | "getRepositoryReadiness" | "readFile"
>;

export interface SiteSettingsDependencies {
  appOrigin: string;
  createClient: (accessToken: string) => SiteSettingsClient;
  sessionCodec: SessionCodec;
}

/** 저장된 설정. 파일이 없거나 형식이 틀리면 기본값과 `stored: false`를 준다. */
export async function getSiteSettings(request: Request, dependencies: SiteSettingsDependencies): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required", NO_STORE_HEADERS);
  }
  try {
    const github = dependencies.createClient(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const raw = await github.readFile(repository, SITE_SETTINGS_PATH);
    const parsed = raw === null ? null : siteSettingsSchema.safeParse(parseJson(raw));
    return Response.json(
      parsed?.success === true
        ? { settings: parsed.data, stored: true }
        : { settings: defaultSiteSettings(session.githubLogin), stored: false },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return pageErrorResponse(error, "site_settings_unavailable");
  }
}

/** 설정 저장. 같은 origin, 세션, 저장소 소유권·쓰기 권한, 관리 표식을 확인한 뒤 설정 파일만 commit한다. */
export async function saveSiteSettings(request: Request, dependencies: SiteSettingsDependencies): Promise<Response> {
  if (request.headers.get("origin") !== dependencies.appOrigin) {
    return errorResponse(403, "invalid_origin", NO_STORE_HEADERS);
  }
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required", NO_STORE_HEADERS);
  }
  const text = request.headers.get("content-type")?.split(";", 1)[0] === "application/json" ? await request.text() : "";
  const input = siteSettingsSchema.safeParse(Buffer.byteLength(text) > MAX_REQUEST_BYTES ? null : parseJson(text));
  if (!input.success) {
    return errorResponse(400, "invalid_site_settings", NO_STORE_HEADERS);
  }
  try {
    const github = dependencies.createClient(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const readiness = await github.getRepositoryReadiness(repository, templatePaths(repository, session.githubLogin));
    if (readiness.state === "repository_not_managed") {
      return notReadyResponse(readiness.state);
    }
    const committed = await github.commitArtifacts(
      repository,
      [{ bytes: new TextEncoder().encode(serializeSiteSettings(input.data)), path: SITE_SETTINGS_PATH }],
      "Update blog settings",
    );
    return Response.json({ commitSha: committed.commitSha, settings: input.data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "site_settings_unavailable");
  }
}

export function createSiteSettingsDependencies(environment: NodeJS.ProcessEnv = process.env): SiteSettingsDependencies {
  const auth = createGitHubAuthDependencies(environment);
  const apiVersion = environment.GITHUB_API_VERSION ?? "";
  return {
    appOrigin: auth.config.appOrigin,
    createClient: (accessToken) => new GitHubPagesClient({ accessToken, apiVersion }),
    sessionCodec: auth.sessionCodec,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
