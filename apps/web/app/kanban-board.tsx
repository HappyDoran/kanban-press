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
import { useEffect, useMemo, useState } from "react";

import { formatEditedAt } from "../lib/format-date";
import {
  boardDropAction,
  preferredPointerDropId,
} from "./board-drop";
import { RetryAction } from "./retry-action";

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
  publishActionsUrl: string | null;
  publishedUrl: string | null;
  publishStartedAt: number | null;
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
  onPreview: (record: KanbanRecord) => void;
  onRemove: (record: KanbanRecord) => Promise<void>;
  publishFailures: Readonly<
    Record<
      string,
      { actionsUrl: string | null; message: string; retryAt: number | null }
    >
  >;
  records: readonly KanbanRecord[];
}

export function KanbanBoard({
  connectionNames,
  onMove,
  onPublish,
  onPreview,
  onRemove,
  publishFailures,
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
    <>
      {notice ? (
        <p className="notice danger" role="status">
          {notice}
        </p>
      ) : null}
      <DndContext
          accessibility={{
            announcements: {
              onDragCancel: () => "카드 이동을 취소했습니다.",
              onDragEnd: ({ over }) => {
                const label = overColumnLabel(over, grouped);
                return label === null
                  ? "카드를 원래 자리에 두었습니다."
                  : `카드를 ${label}에 놓았습니다.`;
              },
              onDragOver: ({ over }) => {
                const label = overColumnLabel(over, grouped);
                return label === null
                  ? "놓을 수 있는 위치 밖입니다."
                  : `${label} 위에 있습니다.`;
              },
              onDragStart: ({ active }) => {
                const record = findRecord(active, records);
                return `${record?.title ?? "카드"}를 집었습니다.`;
              },
            },
            screenReaderInstructions: {
              draggable:
                "스페이스 키로 카드를 집고 화살표 키로 이동한 뒤 스페이스 키로 놓습니다. Esc 키로 취소합니다.",
            },
          }}
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
                onRetryPublish={onPublish}
                onPreview={onPreview}
                publishFailures={publishFailures}
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
    </>
  );
}

function KanbanColumn({
  column,
  connectionNames,
  movingId,
  onRemove,
  onRetryPublish,
  onPreview,
  publishFailures,
  records,
}: {
  column: BoardColumn;
  connectionNames: Readonly<Record<string, string>>;
  movingId: string | null;
  onRemove: (record: KanbanRecord) => Promise<void>;
  onRetryPublish: (record: KanbanRecord) => Promise<void>;
  onPreview: (record: KanbanRecord) => void;
  publishFailures: Readonly<
    Record<
      string,
      { actionsUrl: string | null; message: string; retryAt: number | null }
    >
  >;
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
        <h2>{COLUMN_LABELS[column]}</h2>
        <span aria-hidden="true">{records.length}</span>
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
              onRetryPublish={onRetryPublish}
              onPreview={onPreview}
              publishFailure={publishFailures[recordId(record)]}
              record={record}
            />
          ))}
          {column === "publishing" ? <p className="dropZone">여기에 놓으면 게시</p> : null}
          {column === "stored" && records.length === 0 ? (
            <p className="emptyColumn">왼쪽 문서 목록에서 추가하세요</p>
          ) : null}
          {column === "published" ? (
            <p className="columnHint">완료 표시는 새로고침하면 사라집니다.</p>
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
  onRetryPublish,
  onPreview,
  publishFailure,
  record,
}: {
  connectionName: string;
  disabled: boolean;
  onRemove: (record: KanbanRecord) => Promise<void>;
  onRetryPublish: (record: KanbanRecord) => Promise<void>;
  onPreview: (record: KanbanRecord) => void;
  publishFailure?:
    | { actionsUrl: string | null; message: string; retryAt: number | null }
    | undefined;
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
        onRetryPublish={onRetryPublish}
        onPreview={onPreview}
        publishFailure={publishFailure}
        record={record}
      />
    </div>
  );
}

export function BoardCard({
  connectionName,
  disabled = false,
  dragAttributes,
  dragListeners,
  dragRef,
  onRemove,
  onRetryPublish,
  onPreview,
  overlay = false,
  publishFailure,
  record,
}: {
  connectionName: string;
  disabled?: boolean;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragRef?: (element: HTMLElement | null) => void;
  onRemove?: (record: KanbanRecord) => Promise<void>;
  onRetryPublish?: (record: KanbanRecord) => Promise<void>;
  onPreview?: (record: KanbanRecord) => void;
  overlay?: boolean;
  publishFailure?:
    | { actionsUrl: string | null; message: string; retryAt: number | null }
    | undefined;
  record: KanbanRecord;
}) {
  const draggable =
    !overlay && !disabled && record.column !== "publishing";
  return (
    <article
      className={
        overlay
          ? "boardCard overlay"
          : draggable
            ? "boardCard draggable"
            : "boardCard"
      }
    >
      <div className="boardCardTopline">
        <span>{connectionName}</span>
        {!overlay && draggable ? (
              <button
                {...dragAttributes}
                {...dragListeners}
                aria-label={`${record.title} 카드 이동`}
                className="dragHandleButton"
                ref={dragRef}
                type="button"
              >
                <span aria-hidden="true">⠿</span>
              </button>
        ) : null}
      </div>
      <h3>{record.title}</h3>
      <p className="cardMeta">원문 수정 {formatEditedAt(record.sourceLastEditedAt)}</p>
      {!overlay && record.column === "publishing" ? (
        <div className="publishStatus" role="status">
          <span>
            GitHub Pages 배포 중
            {record.publishStartedAt === null ? null : (
              <>
                {" · "}
                <PublishElapsed since={record.publishStartedAt} />
              </>
            )}
          </span>
          <span aria-hidden="true" className="progress" />
        </div>
      ) : null}
      {!overlay && record.column === "published" && record.publishedUrl !== null ? (
        <a
          className="cardLink"
          href={record.publishedUrl}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          게시된 글 보기
        </a>
      ) : null}
      {!overlay && record.publishActionsUrl !== null ? (
        <a
          className="cardLink"
          href={record.publishActionsUrl}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          GitHub Actions 로그 보기
        </a>
      ) : null}
      {!overlay && publishFailure ? (
        <div className="publishError" role="alert">
          <p>{publishFailure.message}</p>
          {onRetryPublish === undefined ? null : (
            <RetryAction
              label="다시 게시"
              onRetry={() => void onRetryPublish(record)}
              retryAt={publishFailure.retryAt}
            />
          )}
        </div>
      ) : null}
      {!overlay ? (
          <div className="cardActions">
            {record.column === "stored" && onPreview !== undefined ? (
              <button
                className="buttonSecondary small"
                disabled={disabled}
                onClick={() => onPreview(record)}
                onKeyDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                미리보기
              </button>
            ) : null}
            <button
              aria-label={`${record.title} 칸반에서 제거`}
              className="iconButton"
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
              ✕
            </button>
          </div>
      ) : null}
    </article>
  );
}

function PublishElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return (
    <>
      {minutes}:{String(seconds % 60).padStart(2, "0")} 경과
    </>
  );
}

function overColumnLabel(
  over: Over | null,
  grouped: Readonly<Record<BoardColumn, readonly KanbanRecord[]>>,
): string | null {
  const target = dropTarget(over, grouped);
  return target === null ? null : COLUMN_LABELS[target.column];
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

// ponytail: announcements가 render마다 새 객체 — dnd-kit이 ref로 들고 있어 무해, 문제 생기면 useMemo.
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
