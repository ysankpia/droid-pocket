export interface ChatUserItem {
  kind: "user";
  id: string;
  text: string;
}

export interface ChatAssistantItem {
  kind: "assistant";
  id: string;
  text: string;
  streaming: boolean;
}

export interface ChatToolItem {
  kind: "tool";
  id: string;
  toolUseId: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  running: boolean;
}

export interface ChatNoticeItem {
  kind: "notice";
  id: string;
  text: string;
  tone: "info" | "error";
}

export type ChatItem =
  ChatUserItem | ChatAssistantItem | ChatToolItem | ChatNoticeItem;

export interface SessionRow {
  id: string;
  title: string;
  cwd?: string;
  messageCount?: number;
  modified?: string;
}
