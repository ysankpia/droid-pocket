import { useCallback, useRef, useState } from "react";
import type { ConnectionConfig } from "./config";
import type { ChatItem, SessionRow } from "./types";

type Status = "idle" | "connecting" | "connected" | "error";
type Autonomy = "off" | "low" | "medium" | "high";

let seq = 0;
const nextId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

async function call<T>(
  config: ConnectionConfig,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-droid-pocket-token": config.token,
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || `HTTP ${response.status}`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* keep the raw body */
    }
    throw new Error(message);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function useDroid() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [computer, setComputer] = useState<string>("");
  const [model, setModel] = useState<string>("");

  const configRef = useRef<ConnectionConfig | null>(null);
  const cwdRef = useRef<string>("");
  const autonomyRef = useRef<Autonomy>("medium");
  const abortRef = useRef<AbortController | null>(null);

  const appendItem = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const handleEvent = useCallback(
    (event: Record<string, unknown>) => {
      switch (String(event.type ?? "")) {
        case "session": {
          if (event.sessionId) setSessionId(String(event.sessionId));
          if (event.cwd) cwdRef.current = String(event.cwd);
          if (event.model) setModel(String(event.model));
          return;
        }
        case "echo":
          // The user's own message was already rendered when it was sent.
          return;
        case "tool_call": {
          appendItem({
            kind: "tool",
            id: nextId(),
            toolUseId: String(event.id ?? ""),
            name: String(event.name ?? "tool"),
            input: event.input ?? {},
            running: true,
          });
          return;
        }
        case "tool_result": {
          const toolUseId = String(event.id ?? "");
          setItems((prev) => {
            const index = prev.findIndex(
              (item) => item.kind === "tool" && item.toolUseId === toolUseId,
            );
            if (index < 0) return prev;
            const next = [...prev];
            const current = next[index] as Extract<ChatItem, { kind: "tool" }>;
            next[index] = {
              ...current,
              result: String(event.content ?? ""),
              isError: Boolean(event.isError),
              running: false,
            };
            return next;
          });
          return;
        }
        case "assistant": {
          const text = String(event.text ?? "");
          if (!text.trim()) return;
          appendItem({
            kind: "assistant",
            id: String(event.id ?? nextId()),
            text,
            streaming: false,
          });
          return;
        }
        case "error": {
          appendItem({
            kind: "notice",
            id: nextId(),
            text: String(event.message ?? "未知错误"),
            tone: "error",
          });
          return;
        }
        case "interrupted": {
          appendItem({
            kind: "notice",
            id: nextId(),
            text: "已停止。",
            tone: "info",
          });
          return;
        }
        default:
          return;
      }
    },
    [appendItem],
  );

  const refreshSessions = useCallback(async () => {
    const config = configRef.current;
    if (!config) return;
    try {
      const data = await call<{ sessions: SessionRow[] }>(
        config,
        "/api/sessions",
        { limit: 60 },
      );
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const connect = useCallback(async (config: ConnectionConfig) => {
    setError(null);
    setStatus("connecting");
    try {
      const ping = await fetch(`${config.url}/api/ping`).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ ok: boolean; name: string }>;
      });
      // A ping succeeds without the token, so validate it with a real call.
      const data = await call<{ sessions: SessionRow[] }>(
        config,
        "/api/sessions",
        { limit: 60 },
      );
      configRef.current = config;
      setComputer(ping.name || config.name || "");
      setSessions(data.sessions ?? []);
      setStatus("connected");
      return true;
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    configRef.current = null;
    setStatus("idle");
    setSessions([]);
    setItems([]);
    setSessionId(null);
    setTitle("");
    setModel("");
    setBusy(false);
  }, []);

  const openSession = useCallback(
    async (id: string) => {
      const config = configRef.current;
      if (!config) return;
      setItems([]);
      setError(null);
      setSessionId(id);
      const row = sessions.find((session) => session.id === id);
      setTitle(row?.title || "");
      cwdRef.current = row?.cwd || "";
      try {
        const data = await call<{ items: ChatItem[] }>(config, "/api/history", {
          sessionId: id,
        });
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [sessions],
  );

  const createSession = useCallback(async (cwd: string, autonomy: Autonomy) => {
    cwdRef.current = cwd;
    autonomyRef.current = autonomy;
    setItems([]);
    setError(null);
    setSessionId(null);
    setTitle("");
    return "new";
  }, []);

  const send = useCallback(
    async (text: string) => {
      const config = configRef.current;
      if (!config || !text.trim()) return;
      appendItem({ kind: "user", id: nextId(), text });
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`${config.url}/api/prompt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-droid-pocket-token": config.token,
          },
          body: JSON.stringify({
            text,
            sessionId,
            cwd: cwdRef.current,
            autonomy: autonomyRef.current,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response.text();
          let message = detail || `HTTP ${response.status}`;
          try {
            message =
              (JSON.parse(detail) as { error?: string }).error ?? message;
          } catch {
            /* keep the raw body */
          }
          throw new Error(message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf("\n");
          while (index >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (line) {
              try {
                handleEvent(JSON.parse(line) as Record<string, unknown>);
              } catch {
                /* ignore malformed lines */
              }
            }
            index = buffer.indexOf("\n");
          }
        }
      } catch (err) {
        const aborted =
          err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          appendItem({
            kind: "notice",
            id: nextId(),
            text: err instanceof Error ? err.message : String(err),
            tone: "error",
          });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        // Pick up the auto-generated title for a freshly created session.
        void refreshSessions();
      }
    },
    [appendItem, handleEvent, refreshSessions, sessionId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return {
    status,
    error,
    sessions,
    items,
    busy,
    title,
    sessionId,
    computer,
    model,
    connect,
    disconnect,
    refreshSessions,
    openSession,
    createSession,
    send,
    stop,
  };
}
