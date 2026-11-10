// `/api/publish/preview` 본체: 게시와 같은 검증을 거친 뒤 저장소에 쓰지 않고 게시 문서만 돌려준다.
import { errorResponse } from "../auth/session";

import { buildPublishDocument } from "./document";
import {
  authorizePageRequest,
  NO_STORE_HEADERS,
  pageErrorResponse,
  type PageRequestDependencies,
} from "./orchestration";
import { createPublishPreviewResponse } from "./preview";

export async function previewNotionPage(request: Request, dependencies: PageRequestDependencies): Promise<Response> {
  const owned = await authorizePageRequest(request, dependencies, "invalid_preview_request");
  if (owned instanceof Response) {
    return owned;
  }
  try {
    const page = await owned.notion.getPageContent(owned.providerPageId);
    if (page.providerPageId !== owned.providerPageId) {
      return errorResponse(403, "notion_page_mismatch", NO_STORE_HEADERS);
    }
    const preview = createPublishPreviewResponse(buildPublishDocument(page), page.lastEditedAt.toISOString());
    return Response.json(preview, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "preview_unavailable");
  }
}
