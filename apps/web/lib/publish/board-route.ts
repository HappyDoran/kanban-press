// `/api/board`: 칸반 보관 중 목록 읽기·추가·빼기(제품 명세 §3 칸반, ADR 0003).
// 목록은 사용자 블로그 저장소의 `kanban-press-board` branch에 page ID로만 둔다. 기본 branch가 아니라 배포가 돌지 않는다.
import { z } from "zod";

import { errorResponse, readSession } from "../auth/session";
import { GitHubPagesClient } from "../github/pages";

import { pageIdSuffix } from "./blog-files";
import {
  authorizePageRequest,
  createPublishDependencies,
  NO_STORE_HEADERS,
  type PageRequestDependencies,
  pageErrorResponse,
} from "./orchestration";

export const BOARD_BRANCH = "kanban-press-board";
export const BOARD_PATH = "board.json";
const MAX_PAGES = 2_000;

const boardFileSchema = z.object({
  pageIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(MAX_PAGES),
  version: z.literal(1),
});

type BoardClient = Pick<GitHubPagesClient, "getPagesRepository" | "readBranchFile" | "writeBranchFile">;

export interface BoardDependencies extends PageRequestDependencies {
  createClient: (accessToken: string) => BoardClient;
}

/** 파일 내용 → page ID 목록. 형식이 틀리면 빈 목록. */
export function parseBoard(text: string | null): string[] {
  if (text === null) {
    return [];
  }
  try {
    const parsed = boardFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? [...new Set(parsed.data.pageIds)] : [];
  } catch {
    return [];
  }
}

export async function getBoard(request: Request, dependencies: BoardDependencies): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required", NO_STORE_HEADERS);
  }
  try {
    const github = dependencies.createClient(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const file = await github.readBranchFile(repository, BOARD_BRANCH, BOARD_PATH);
    return Response.json({ pageIds: parseBoard(file?.text ?? null) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "board_unavailable");
  }
}

/**
 * 보관 중에 넣기(`add`)·빼기(`remove`). 같은 origin·세션·연결 소유권(authorizePageRequest)과 저장소 소유권·쓰기 권한을
 * 다시 확인하고, 최신 목록을 읽어 바꾼 뒤 읽은 SHA로 조건부 저장한다. 그 사이 바뀌었으면 409이고 재시도하지 않는다.
 */
export async function changeBoard(
  request: Request,
  dependencies: BoardDependencies,
  action: "add" | "remove",
): Promise<Response> {
  const owned = await authorizePageRequest(request, dependencies, "invalid_board_request");
  if (owned instanceof Response) {
    return owned;
  }
  const { providerPageId, session } = owned;
  try {
    const pageId = pageIdSuffix(providerPageId);
    const github = dependencies.createClient(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const file = await github.readBranchFile(repository, BOARD_BRANCH, BOARD_PATH);
    const current = parseBoard(file?.text ?? null);
    const next =
      action === "add"
        ? current.includes(pageId)
          ? current
          : [...current, pageId]
        : current.filter((id) => id !== pageId);
    if (next.length > MAX_PAGES) {
      return errorResponse(422, "board_full", NO_STORE_HEADERS);
    }
    if (next.length !== current.length) {
      await github.writeBranchFile(
        repository,
        BOARD_BRANCH,
        BOARD_PATH,
        `${JSON.stringify({ pageIds: next, version: 1 }, null, 2)}\n`,
        file?.sha ?? null,
        `${action === "add" ? "Add" : "Remove"} ${pageId} ${action === "add" ? "to" : "from"} board`,
      );
    }
    return Response.json({ pageIds: next }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "board_unavailable");
  }
}

export function createBoardDependencies(environment: NodeJS.ProcessEnv = process.env): BoardDependencies {
  const publish = createPublishDependencies(environment);
  const apiVersion = environment.GITHUB_API_VERSION ?? "";
  return {
    appOrigin: publish.appOrigin,
    createClient: (accessToken) => new GitHubPagesClient({ accessToken, apiVersion }),
    createNotionAdapter: publish.createNotionAdapter,
    notionAuth: publish.notionAuth,
    sessionCodec: publish.sessionCodec,
  };
}
