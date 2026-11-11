import type {
  NotionConnectionId,
  UserId,
} from "@kanban-press/domain";

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
  parentContainerId: string | null;
  parentPageId: string | null;
  providerPageId: string;
  title: string;
}

export interface NotionOutlineNode {
  kind: "database" | "group" | "page" | "toggle";
  nodeId: string;
  parentNodeId: string | null;
  providerId: string | null;
  title: string;
}

export interface NotionRichText {
  bold: boolean;
  code: boolean;
  href: string | null;
  italic: boolean;
  strikethrough: boolean;
  text: string;
}

export type NotionContentBlock =
  | {
      children: NotionContentBlock[];
      icon: string | null;
      kind: "callout";
      richText: NotionRichText[];
    }
  | { kind: "code"; code: string; language: string }
  | { kind: "divider" }
  | { expression: string; kind: "equation" }
  | { kind: "heading"; level: 1 | 2 | 3; richText: NotionRichText[] }
  | { kind: "image"; caption: NotionRichText[]; url: string }
  | {
      children: NotionContentBlock[];
      kind: "listItem";
      richText: NotionRichText[];
      style: "bulleted" | "numbered";
    }
  | { caption: NotionRichText[]; kind: "linkCard"; url: string }
  | {
      caption: NotionRichText[];
      kind: "media";
      mediaType: "audio" | "file" | "pdf" | "video";
      url: string | null;
    }
  | { kind: "paragraph"; richText: NotionRichText[] }
  | { kind: "quote"; richText: NotionRichText[] }
  | {
      hasColumnHeader: boolean;
      hasRowHeader: boolean;
      kind: "table";
      rows: NotionRichText[][][];
    }
  | { cells: NotionRichText[][]; kind: "tableRow" }
  | {
      checked: boolean;
      children: NotionContentBlock[];
      kind: "toDo";
      richText: NotionRichText[];
    }
  | {
      kind: "toggle";
      children: NotionContentBlock[];
      summary: NotionRichText[];
    };

export type NotionPageProperty =
  | { kind: "checkbox"; checked: boolean }
  | { kind: "rich_text"; plainText: string }
  | { kind: "multi_select"; names: readonly string[] }
  | { kind: "date"; start: string | null }
  | { kind: "unsupported"; providerType: string };

export interface NotionPageContent {
  blocks: readonly NotionContentBlock[];
  createdAt: Date;
  lastEditedAt: Date;
  providerPageId: string;
  publishingProperties: Readonly<Record<string, NotionPageProperty>>;
  title: string;
}

export interface NotionContentAdapter {
  /**
   * Returns every page currently visible to the connection.
   * A page whose parent is not visible is promoted to a root with a null parentPageId.
   */
  listPageTree(): Promise<readonly NotionPageSummary[]>;

  /**
   * Returns only navigation-bearing blocks below a page. Content blocks are
   * traversed server-side when necessary but are not included in the result.
   */
  listPageOutline(pageId: string): Promise<readonly NotionOutlineNode[]>;

  /**
   * Retrieves the latest page metadata and publishable blocks. The call must
   * fail when the current connection can no longer retrieve the page.
   */
  getPageContent(pageId: string): Promise<NotionPageContent>;
}

export interface NotionAdapterFactory {
  forConnection(
    ownerUserId: UserId,
    connectionId: NotionConnectionId,
  ): Promise<NotionContentAdapter>;
}
