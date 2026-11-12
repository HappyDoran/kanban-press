import {
  createNotionPageTreeDependencies,
  listNotionPageOutline,
} from "@/lib/server/notion/pages";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ connectionId: string; pageId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { connectionId, pageId } = await context.params;
  return listNotionPageOutline(
    request,
    connectionId,
    pageId,
    createNotionPageTreeDependencies(),
  );
}
