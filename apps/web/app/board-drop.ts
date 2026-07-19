import type { BoardColumn } from "@notion-kanban-blog/domain";

export interface PointerDropCandidate {
  column: BoardColumn | null;
  id: string;
  kind: "column" | "record" | null;
}

export function boardDropAction(
  from: BoardColumn,
  to: BoardColumn,
): "move" | "publish" | null {
  if (
    to === "publishing" &&
    (from === "stored" || from === "published")
  ) {
    return "publish";
  }
  if (
    to === "stored" &&
    (from === "stored" || from === "published")
  ) {
    return "move";
  }
  return null;
}

export function preferredPointerDropId(
  candidates: readonly PointerDropCandidate[],
  activeId: string,
): string | null {
  const available = candidates.filter(
    (candidate) => candidate.id !== activeId,
  );
  return (
    available.find(
      (candidate) =>
        candidate.kind === "column" &&
        candidate.column === "publishing",
    )?.id ??
    available.find((candidate) => candidate.kind === "record")?.id ??
    available.find((candidate) => candidate.kind === "column")?.id ??
    available[0]?.id ??
    null
  );
}

export function shouldShowBoardRecord(
  isVisible: boolean,
  hasTransientPublishState: boolean,
): boolean {
  return isVisible || hasTransientPublishState;
}
