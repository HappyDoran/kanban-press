import type {
  NotionConnectionId,
  UserId,
} from "@notion-kanban-blog/domain";

export interface NotionWorkspace {
  connectionId: NotionConnectionId;
  iconUrl: string | null;
  name: string;
  ownerUserId: UserId;
}

export interface NotionPageSummary {
  hasChildren: boolean;
  iconUrl: string | null;
  lastEditedAt: Date;
  parentPageId: string | null;
  providerPageId: string;
  title: string;
}

export interface NotionContentAdapter {
  listChildPages(providerPageId: string): Promise<readonly NotionPageSummary[]>;
  listSharedRootPages(): Promise<readonly NotionPageSummary[]>;
}

export interface NotionAdapterFactory {
  forConnection(
    ownerUserId: UserId,
    connectionId: NotionConnectionId,
  ): Promise<NotionContentAdapter>;
}
