"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BOARD_COLUMNS } from "@notion-kanban-blog/domain";
import { useMemo, useState } from "react";

import {
  boardDropAction,
  preferredPointerDropId,
} from "./board-drop";

import type {
  Active,
  DraggableAttributes,
  DraggableSyntheticListeners,
  DragEndEvent,
  DragStartEvent,
  CollisionDetection,
  Over,
} from "@dnd-kit/core";
import type { BoardColumn } from "@notion-kanban-blog/domain";
import type { BoardRecord } from "../lib/board/repository";

export type KanbanRecord = Omit<BoardRecord, "column"> & {
  column: BoardColumn;
  publishedUrl: string | null;
};

const COLUMN_LABELS: Readonly<Record<BoardColumn, string>> = {
  published: "게시 완료",
  publishing: "게시 중",
  stored: "보관 중",
};

interface KanbanBoardProps {
  connectionNames: Readonly<Record<string, string>>;
  onMove: (
    record: KanbanRecord,
    targetColumn: BoardColumn,
    targetIndex: number,
  ) => Promise<void>;
  onPublish: (record: KanbanRecord) => Promise<void>;
  onRemove: (record: KanbanRecord) => Promise<void>;
  publishErrors: Readonly<Record<string, string>>;
  records: readonly KanbanRecord[];
}

export function KanbanBoard({
  connectionNames,
  onMove,
  onPublish,
  onRemove,
  publishErrors,
  records,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        BOARD_COLUMNS.map((column) => [
          column,
          records
            .filter((record) => record.column === column)
            .sort(compareRecords),
        ]),
      ) as Record<BoardColumn, KanbanRecord[]>,
    [records],
  );
  const activeRecord =
    records.find((record) => recordId(record) === activeId) ?? null;

  async function move(
    record: KanbanRecord,
    targetColumn: BoardColumn,
    targetIndex: number,
  ): Promise<void> {
    const action = boardDropAction(record.column, targetColumn);
    if (action === null) {
      setNotice(
        `${COLUMN_LABELS[record.column]}에서 ${COLUMN_LABELS[targetColumn]}(으)로 바로 이동할 수 없습니다.`,
      );
      return;
    }
    const id = recordId(record);
    setMovingId(id);
    setNotice("");
    try {
      if (action === "publish") {
        await onPublish(record);
      } else {
        await onMove(record, "stored", targetIndex);
      }
    } catch {
      setNotice("카드 작업을 완료하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setMovingId(null);
    }
  }

  async function remove(record: KanbanRecord): Promise<void> {
    const id = recordId(record);
    setMovingId(id);
    setNotice("");
    try {
      await onRemove(record);
    } catch {
      setNotice("카드를 칸반에서 제거하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setMovingId(null);
    }
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id));
    setNotice("");
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setActiveId(null);
    const active = findRecord(event.active, records);
    const target = dropTarget(event.over, grouped);
    if (active === null || target === null) {
      return;
    }
    await move(active, target.column, target.index);
  }

  return (
    <section aria-labelledby="kanban-title" className="kanbanSection">
      <div className="kanbanHeading">
        <div>
          <p className="eyebrow">Personal board</p>
          <h2 id="kanban-title">내 게시 칸반</h2>
        </div>
        <p>
          카드를 게시 중으로 옮기면 게시가 시작됩니다. ×를 누르면 Notion 원문은
          유지한 채 칸반에서만 숨깁니다.
        </p>
      </div>

      {notice ? (
        <p className="kanbanNotice" role="status">
          {notice}
        </p>
      ) : null}

      {records.length === 0 ? (
        <div className="emptyBoard">
          위 문서 목록에서 게시할 페이지를 표시해 주세요.
        </div>
      ) : (
        <DndContext
          collisionDetection={kanbanCollisionDetection}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={(event) => void handleDragEnd(event)}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <div className="kanbanBoard">
            {BOARD_COLUMNS.map((column) => (
              <KanbanColumn
                column={column}
                connectionNames={connectionNames}
                key={column}
                movingId={movingId}
                onRemove={remove}
                publishErrors={publishErrors}
                records={grouped[column]}
              />
            ))}
          </div>
          <DragOverlay>
            {activeRecord === null ? null : (
              <BoardCard
                connectionName={
                  connectionNames[activeRecord.connectionId] ??
                  "연결 해제된 워크스페이스"
                }
                overlay
                record={activeRecord}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </section>
  );
}

function KanbanColumn({
  column,
  connectionNames,
  movingId,
  onRemove,
  publishErrors,
  records,
}: {
  column: BoardColumn;
  connectionNames: Readonly<Record<string, string>>;
  movingId: string | null;
  onRemove: (record: KanbanRecord) => Promise<void>;
  publishErrors: Readonly<Record<string, string>>;
  records: readonly KanbanRecord[];
}) {
  const { isOver, setNodeRef } = useDroppable({
    data: { column, kind: "column" as const },
    disabled: column === "published",
    id: columnId(column),
  });

  return (
    <section
      aria-label={`${COLUMN_LABELS[column]} ${records.length}개`}
      className={isOver ? "kanbanColumn over" : "kanbanColumn"}
      ref={setNodeRef}
    >
      <header>
        <h3>{COLUMN_LABELS[column]}</h3>
        <span>{records.length}</span>
      </header>
      <SortableContext
        items={records.map(recordId)}
        strategy={verticalListSortingStrategy}
      >
        <div className="kanbanCards">
          {records.map((record) => (
            <SortableBoardCard
              connectionName={
                connectionNames[record.connectionId] ??
                "연결 해제된 워크스페이스"
              }
              disabled={movingId === recordId(record)}
              key={recordId(record)}
              onRemove={onRemove}
              publishError={publishErrors[recordId(record)]}
              record={record}
            />
          ))}
          {records.length === 0 ? (
            <p className="emptyColumn">
              {column === "stored"
                ? "표시할 문서가 없습니다"
                : column === "publishing"
                  ? "게시할 카드를 여기에 놓으세요"
                  : "현재 없음"}
            </p>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableBoardCard({
  connectionName,
  disabled,
  onRemove,
  publishError,
  record,
}: {
  connectionName: string;
  disabled: boolean;
  onRemove: (record: KanbanRecord) => Promise<void>;
  publishError?: string | undefined;
  record: KanbanRecord;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    data: { column: record.column, kind: "record" as const },
    disabled: disabled || record.column === "publishing",
    id: recordId(record),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className={isDragging ? "sortableCard dragging" : "sortableCard"}
      ref={setNodeRef}
      style={style}
    >
      <BoardCard
        connectionName={connectionName}
        disabled={disabled}
        dragAttributes={attributes}
        dragListeners={listeners}
        dragRef={setActivatorNodeRef}
        onRemove={onRemove}
        publishError={publishError}
        record={record}
      />
    </div>
  );
}

function BoardCard({
  connectionName,
  disabled = false,
  dragAttributes,
  dragListeners,
  dragRef,
  onRemove,
  overlay = false,
  publishError,
  record,
}: {
  connectionName: string;
  disabled?: boolean;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragRef?: (element: HTMLElement | null) => void;
  onRemove?: (record: KanbanRecord) => Promise<void>;
  overlay?: boolean;
  publishError?: string | undefined;
  record: KanbanRecord;
}) {
  const draggable =
    !overlay && !disabled && record.column !== "publishing";
  return (
    <article
      {...(draggable ? dragAttributes : undefined)}
      {...(draggable ? dragListeners : undefined)}
      aria-label={draggable ? `${record.title} 카드 이동` : undefined}
      className={
        overlay
          ? "boardCard overlay"
          : draggable
            ? "boardCard draggable"
            : "boardCard"
      }
      ref={draggable ? dragRef : undefined}
    >
      <div className="boardCardTopline">
        <span>{connectionName}</span>
        {!overlay ? (
          <div className="boardCardControls">
            <button
              aria-label={`${record.title} 칸반에서 제거`}
              className="removeCardButton"
              disabled={disabled}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (onRemove !== undefined) {
                  void onRemove(record);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              title="칸반에서 제거"
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      <h4>{record.title}</h4>
      <p>원문 수정 {formatDate(record.sourceLastEditedAt)}</p>
      {!overlay && record.column === "publishing" ? (
        <p className="publishStatus" role="status">
          GitHub Pages 배포 상태를 확인하고 있습니다.
        </p>
      ) : null}
      {!overlay &&
      record.column === "published" &&
      record.publishedUrl !== null ? (
        <a
          className="publishedLink"
          href={record.publishedUrl}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          게시된 글 보기
        </a>
      ) : null}
      {!overlay && publishError ? (
        <p className="publishError" role="alert">
          {publishError}
        </p>
      ) : null}
    </article>
  );
}

function dropTarget(
  over: Over | null,
  grouped: Readonly<Record<BoardColumn, readonly KanbanRecord[]>>,
): { column: BoardColumn; index: number } | null {
  if (over === null) {
    return null;
  }
  const data = over.data.current;
  if (data?.kind === "column" && isBoardColumn(data.column)) {
    return { column: data.column, index: grouped[data.column].length };
  }
  if (data?.kind === "record" && isBoardColumn(data.column)) {
    const index = grouped[data.column].findIndex(
      (record) => recordId(record) === String(over.id),
    );
    return {
      column: data.column,
      index: index < 0 ? grouped[data.column].length : index,
    };
  }
  return null;
}

function findRecord(
  active: Active,
  records: readonly KanbanRecord[],
): KanbanRecord | null {
  return (
    records.find((record) => recordId(record) === String(active.id)) ?? null
  );
}

function isBoardColumn(value: unknown): value is BoardColumn {
  return (
    typeof value === "string" &&
    (BOARD_COLUMNS as readonly string[]).includes(value)
  );
}

function recordId(record: KanbanRecord): string {
  return `${record.connectionId}:${record.providerPageId}`;
}

function columnId(column: BoardColumn): string {
  return `column:${column}`;
}

function compareRecords(left: KanbanRecord, right: KanbanRecord): number {
  return left.position - right.position;
}

const kanbanCollisionDetection: CollisionDetection = (arguments_) => {
  const pointerCollisions = pointerWithin(arguments_);
  if (pointerCollisions.length > 0) {
    const preferredId = preferredPointerDropId(
      pointerCollisions.map((collision) => {
        const data =
          collision.data?.droppableContainer.data.current;
        return {
          column: isBoardColumn(data?.column) ? data.column : null,
          id: String(collision.id),
          kind:
            data?.kind === "column" || data?.kind === "record"
              ? data.kind
              : null,
        };
      }),
      String(arguments_.active.id),
    );
    const preferred = pointerCollisions.find(
      (collision) => String(collision.id) === preferredId,
    );
    if (preferred !== undefined) {
      return [preferred];
    }
  }
  return closestCorners(arguments_).filter(
    (collision) => collision.id !== arguments_.active.id,
  );
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
  }).format(new Date(value));
}
