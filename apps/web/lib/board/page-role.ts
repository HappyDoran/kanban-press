export type StructureInspectionState =
  | "error"
  | "idle"
  | "loading"
  | "ready";

export function hasConfirmedNavigableChildren({
  discoveredChildCount,
  outlineNodeCount,
  outlineState,
}: {
  discoveredChildCount: number;
  outlineNodeCount: number;
  outlineState: StructureInspectionState;
}): boolean {
  return (
    discoveredChildCount > 0 ||
    (outlineState === "ready" && outlineNodeCount > 0)
  );
}

export function pageActionAvailability({
  inspectionIsCurrent,
  inspectionState,
  recordIsAvailable,
}: {
  inspectionIsCurrent: boolean;
  inspectionState: StructureInspectionState;
  recordIsAvailable: boolean;
}): "error" | "loading" | "ready" {
  if (recordIsAvailable && inspectionIsCurrent) {
    return "ready";
  }
  return inspectionState === "error" ? "error" : "loading";
}

export function pagePrimaryAction({
  actionAvailability,
  isContainer,
  pending,
}: {
  actionAvailability: "error" | "loading" | "ready";
  isContainer: boolean;
  pending: boolean;
}): "loading" | "none" | "retry" | "visibility" {
  if (pending || actionAvailability === "loading") {
    return "loading";
  }
  if (actionAvailability === "error") {
    return "retry";
  }
  return isContainer ? "none" : "visibility";
}
