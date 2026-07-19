export interface ClientOutlineNode {
  kind: "database" | "group" | "page" | "toggle";
  nodeId: string;
  parentNodeId: string | null;
  providerId: string | null;
  title: string;
}

export interface ClientPageReference {
  parentContainerId: string | null;
  providerPageId: string;
}

export function filterRenderableOutline(
  outline: readonly ClientOutlineNode[],
  pages: readonly ClientPageReference[],
): ClientOutlineNode[] {
  const pageIds = new Set(pages.map((page) => page.providerPageId));
  const databaseIds = new Set(
    pages.flatMap((page) =>
      page.parentContainerId === null ? [] : [page.parentContainerId],
    ),
  );
  const nodesById = new Map(
    outline.map((node) => [node.nodeId, node]),
  );
  const retained = new Set<string>();
  for (const node of outline) {
    const targetIsRenderable =
      node.providerId !== null &&
      ((node.kind === "page" && pageIds.has(node.providerId)) ||
        (node.kind === "database" &&
          databaseIds.has(node.providerId)));
    if (!targetIsRenderable) {
      continue;
    }
    let current: ClientOutlineNode | undefined = node;
    while (current !== undefined && !retained.has(current.nodeId)) {
      retained.add(current.nodeId);
      current =
        current.parentNodeId === null
          ? undefined
          : nodesById.get(current.parentNodeId);
    }
  }
  return outline.filter((node) => retained.has(node.nodeId));
}
