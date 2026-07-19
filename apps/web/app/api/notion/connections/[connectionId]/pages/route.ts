import {
  createNotionPageTreeDependencies,
  listNotionPageTree,
} from "../../../../../../lib/notion/pages";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ connectionId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { connectionId } = await context.params;
  return listNotionPageTree(
    request,
    connectionId,
    createNotionPageTreeDependencies(),
  );
}
