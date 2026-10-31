import { useCallback, useEffect, useRef, useState } from "react";
import {
  AutonomyLevel,
  ToolConfirmationOutcome,
  connectToDaemon,
} from "@factory/droid-sdk";
import type { ConnectionConfig } from "./config";
import type { ChatItem, PendingPermission, SessionRow } from "./types";

type Status = "idle" | "connecting" | "connected" | "error";

let seq = 0;
const nextId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (record.content !== undefined) return textOf(record.content);
    if (record.message !== undefined) return textOf(record.message);
  }
  return "";
}

function stringifyInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    const text = JSON.stringify(input, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text;
  } catch {
    return String(input);
  }
}

function normalizeHistory(raw: unknown): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const msg = entry as Record<string, unknown>;
    const type = String(msg.type ?? "");
    if (type === "tool_call") {
      out.push({
        kind: "tool",
        id: nextId(),
        toolUseId: String(msg.toolUseId ?? ""),
        name: String(msg.name ?? msg.toolName ?? "tool"),
        input: msg.input ?? {},
        running: false,
      });
      continue;
    }
    if (type === "tool_result") {
      const existing = out.find(
        (item): item is Extract<ChatItem, { kind: "tool" }> =>
          item.kind === "tool" &&
          item.toolUseId === String(msg.toolUseId ?? ""),
      );
      const content = textOf(msg.content);
      if (existing) {
        existing.result = content;
        existing.isError = Boolean(msg.isError);
        existing.running = false;
      } else {
        out.push({
          kind: "tool",
          id: nextId(),
          toolUseId: String(msg.toolUseId ?? ""),
          name: String(msg.toolName ?? "tool"),
          input: {},
          result: content,
          isError: Boolean(msg.isError),
          running: false,
        });
      }
      continue;
    }
    const text = textOf(msg.text ?? msg.message ?? msg.content);
    if (!text.trim()) continue;
    const role = String(msg.role ?? (type === "user" ? "user" : "assistant"));
    out.push(
      role === "user"
        ? { kind: "user", id: nextId(), text }
        : { kind: "assistant", id: nextId(), text, streaming: false },
    );
  }
  return out;
}

export function useDroid() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [title, setTitle] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const droidRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const summariesRef = useRef<any[]>([]);
  const permissionResolveRef = useRef<((outcome: string) => void) | null>(null);
  const deltaRef = useRef<{ messageId: string; text: string } | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const appendItem = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<ChatItem>) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? ({ ...item, ...patch } as ChatItem) : item,
      ),
    );
  }, []);

  const flushDelta = useCallback(() => {
    const pending = deltaRef.current;
    if (!pending) return;
    deltaRef.current = null;
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        last.kind === "assistant" &&
        last.streaming &&
        last.id === pending.messageId
      ) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + pending.text },
        ];
      }
      return [
        ...prev,
        {
          kind: "assistant",
          id: pending.messageId,
          text: pending.text,
          streaming: true,
        },
      ];
    });
  }, []);

  useEffect(() => {
    flushTimerRef.current = window.setInterval(flushDelta, 60);
    return () => {
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
    };
  }, [flushDelta]);

  const permissionHandler = useCallback((params: any) => {
    return new Promise<string>((resolve) => {
      permissionResolveRef.current = resolve;
      const toolName =
        params?.toolName ??
        params?.tool ??
        params?.confirmationType ??
        "工具调用";
      setPermission({
        id: nextId(),
        title: String(toolName),
        detail: stringifyInput(params?.toolInput ?? params?.input ?? params),
        resolve: (outcome: string) => {
          permissionResolveRef.current = null;
          setPermission(null);
          resolve(outcome);
        },
      });
    });
  }, []);

  const handleEvent = useCallback(
    (event: any) => {
      const type = String(event?.type ?? "");
      switch (type) {
        case "assistant_text_delta": {
          const messageId = String(event.messageId ?? nextId());
          const existing = deltaRef.current;
          if (existing && existing.messageId === messageId) {
            existing.text += String(event.text ?? "");
          } else {
            deltaRef.current = { messageId, text: String(event.text ?? "") };
          }
          return;
        }
        case "assistant": {
          const text = String(event.text ?? "");
          if (!text.trim()) return;
          const messageId = String(event.message?.id ?? nextId());
          setItems((prev) => {
            const idx = prev.findIndex(
              (item) => item.kind === "assistant" && item.id === messageId,
            );
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = {
                kind: "assistant",
                id: messageId,
                text,
                streaming: false,
              };
              return copy;
            }
            const last = prev[prev.length - 1];
            if (last && last.kind === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { kind: "assistant", id: last.id, text, streaming: false },
              ];
            }
            return [
              ...prev,
              { kind: "assistant", id: messageId, text, streaming: false },
            ];
          });
          return;
        }
        case "tool_call": {
          appendItem({
            kind: "tool",
            id: nextId(),
            toolUseId: String(event.toolUseId ?? ""),
            name: String(event.name ?? event.toolName ?? "tool"),
            input: event.input ?? {},
            running: true,
          });
          return;
        }
        case "tool_result": {
          const toolUseId = String(event.toolUseId ?? "");
          setItems((prev) => {
            const idx = prev.findIndex(
              (item) => item.kind === "tool" && item.toolUseId === toolUseId,
            );
            if (idx < 0) return prev;
            const copy = [...prev];
            const current = copy[idx] as Extract<ChatItem, { kind: "tool" }>;
            copy[idx] = {
              ...current,
              result: textOf(event.content),
              isError: Boolean(event.isError),
              running: false,
            };
            return copy;
          });
          return;
        }
        case "working_state_changed": {
          const state = String(event.state ?? "");
          setBusy(state !== "idle" && state !== "waiting_for_input");
          return;
        }
        case "session_title_updated": {
          if (event.title) setTitle(String(event.title));
          return;
        }
        case "error": {
          const message = String(event.message ?? event.error ?? "未知错误");
          appendItem({
            kind: "notice",
            id: nextId(),
            text: message,
            tone: "error",
          });
          return;
        }
        default:
          return;
      }
    },
    [appendItem],
  );

  const disconnect = useCallback(() => {
    try {
      sessionRef.current?.detach?.();
    } catch {
      /* ignore */
    }
    try {
      droidRef.current?.disconnect?.();
    } catch {
      /* ignore */
    }
    droidRef.current = null;
    sessionRef.current = null;
    summariesRef.current = [];
    setStatus("idle");
    setSessions([]);
    setItems([]);
    setSessionId(null);
    setTitle("");
    setBusy(false);
  }, []);

  const connect = useCallback(
    async (config: ConnectionConfig) => {
      setError(null);
      setStatus("connecting");
      try {
        const droid = await connectToDaemon({
          url: config.url,
          auth: { apiKey: config.apiKey },
          permissionHandler: permissionHandler as any,
          onAuthenticationError: (err: Error) => setError(err.message),
        });
        droidRef.current = droid;
        setStatus("connected");
        return true;
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [permissionHandler],
  );

  const refreshSessions = useCallback(async () => {
    const droid = droidRef.current;
    if (!droid) return;
    try {
      const list = await droid.sessions.list({ limit: 40 });
      summariesRef.current = list;
      setSessions(
        list.map((entry: any) => ({
          id: String(entry.id),
          title: String(entry.title ?? "(未命名)"),
          cwd: entry.cwd ? String(entry.cwd) : undefined,
          messageCount: Number(entry.messageCount ?? 0),
          modified: entry.modifiedTime
            ? new Date(entry.modifiedTime).toISOString()
            : undefined,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openSession = useCallback(
    async (id: string) => {
      const droid = droidRef.current;
      if (!droid) return;
      setItems([]);
      setError(null);
      setSessionId(id);
      setTitle(sessions.find((row) => row.id === id)?.title ?? "");
      try {
        const summary = summariesRef.current.find(
          (entry) => String(entry.id) === id,
        );
        if (summary?.getMessages) {
          const raw = await summary.getMessages({ limit: 200 });
          setItems(normalizeHistory(raw));
        }
        sessionRef.current = await droid.sessions.resume(id, {
          permissionHandler: permissionHandler as any,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [permissionHandler, sessions],
  );

  const createSession = useCallback(
    async (cwd: string, autonomy: "off" | "low" | "medium" | "high") => {
      const droid = droidRef.current;
      if (!droid) return null;
      setItems([]);
      setError(null);
      try {
        const level = (AutonomyLevel as Record<string, string>)[
          autonomy.charAt(0).toUpperCase() + autonomy.slice(1)
        ];
        const session = await droid.sessions.create({
          cwd,
          autonomyLevel: level ?? autonomy,
          permissionHandler: permissionHandler as any,
        });
        sessionRef.current = session;
        setSessionId(String(session.id));
        setTitle("");
        return String(session.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [permissionHandler],
  );

  const send = useCallback(
    async (text: string) => {
      const session = sessionRef.current;
      if (!session || !text.trim()) return;
      appendItem({ kind: "user", id: nextId(), text });
      setBusy(true);
      try {
        for await (const event of session.stream(text, {
          includePartialMessages: true,
        })) {
          handleEvent(event);
        }
      } catch (err) {
        appendItem({
          kind: "notice",
          id: nextId(),
          text: err instanceof Error ? err.message : String(err),
          tone: "error",
        });
      } finally {
        flushDelta();
        setBusy(false);
        setItems((prev) =>
          prev.map((item) =>
            item.kind === "assistant" && item.streaming
              ? { ...item, streaming: false }
              : item,
          ),
        );
      }
    },
    [appendItem, flushDelta, handleEvent],
  );

  const stop = useCallback(async () => {
    try {
      await sessionRef.current?.interrupt?.();
    } catch {
      /* ignore */
    }
  }, []);

  const answerPermission = useCallback((outcome: string) => {
    permissionResolveRef.current?.(outcome);
  }, []);

  return {
    status,
    error,
    sessions,
    items,
    busy,
    permission,
    title,
    sessionId,
    connect,
    disconnect,
    refreshSessions,
    openSession,
    createSession,
    send,
    stop,
    answerPermission,
    patchItem,
  };
}

export const OUTCOMES = {
  once: ToolConfirmationOutcome.ProceedOnce,
  always: ToolConfirmationOutcome.ProceedAlways,
  cancel: ToolConfirmationOutcome.Cancel,
};
