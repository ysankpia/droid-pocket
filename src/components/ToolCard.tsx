import { useState } from "react";
import type { ChatToolItem } from "../lib/types";

function preview(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  const record = input as Record<string, unknown>;
  for (const key of [
    "command",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "description",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

const ICONS: Record<string, string> = {
  Execute: "⌘",
  Bash: "⌘",
  Read: "📖",
  Write: "✏️",
  Edit: "✏️",
  MultiEdit: "✏️",
  Grep: "🔍",
  Glob: "🔍",
  LS: "📁",
  WebSearch: "🌐",
  WebFetch: "🌐",
  TodoWrite: "☑️",
};

export default function ToolCard({ item }: { item: ChatToolItem }) {
  const [open, setOpen] = useState(false);
  const icon = ICONS[item.name] ?? "🔧";
  const summary = preview(item.input);

  return (
    <div
      className={`tool-card${item.isError ? " is-error" : ""}${item.running ? " is-running" : ""}`}
    >
      <button className="tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{summary}</span>
        <span className="tool-state">
          {item.running ? (
            <span className="spinner" />
          ) : item.isError ? (
            "失败"
          ) : (
            "完成"
          )}
        </span>
      </button>
      {open ? (
        <div className="tool-body">
          <div className="tool-section-label">输入</div>
          <pre>{JSON.stringify(item.input, null, 2)}</pre>
          {item.result ? (
            <>
              <div className="tool-section-label">输出</div>
              <pre>{item.result}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
