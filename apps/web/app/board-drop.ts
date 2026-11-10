import type { BoardColumn } from "@kanban-press/domain";

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
  // 게시 완료 카드는 블로그에 글이 있는 동안 보관 중으로 옮길 수 없다. 블로그에서 내리기로만 돌아간다.
  if (to === "stored" && from === "stored") {
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
