import { useState } from "react";
import type { SessionRow } from "../lib/types";

interface Props {
  sessions: SessionRow[];
  error: string | null;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
  onNew: (cwd: string, autonomy: "off" | "low" | "medium" | "high") => void;
  onDisconnect: () => void;
}

function relative(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export default function SessionsScreen({
  sessions,
  error,
  onRefresh,
  onOpen,
  onNew,
  onDisconnect,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [autonomy, setAutonomy] = useState<"off" | "low" | "medium" | "high">(
    "low",
  );

  const refresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-title">会话</div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? <span className="spinner" /> : "⟳"}
          </button>
          <button className="icon-btn" onClick={onDisconnect} title="断开">
            ⏻
          </button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="list">
        {sessions.length === 0 ? (
          <div className="empty">还没有会话。点右下角新建一个。</div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              className="row"
              onClick={() => onOpen(session.id)}
            >
              <div className="row-title">{session.title}</div>
              <div className="row-meta">
                <span>{session.cwd ? "会话" : "本机会话"}</span>
                <span>{relative(session.modified)}</span>
              </div>
              {session.cwd ? (
                <div className="row-cwd">{session.cwd}</div>
              ) : null}
            </button>
          ))
        )}
      </div>

      <button className="fab" onClick={() => setCreating(true)}>
        ＋
      </button>

      {creating ? (
        <div className="sheet-backdrop" onClick={() => setCreating(false)}>
          <div className="sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-title">新建会话</div>
            <label className="field">
              <span>工作目录（电脑上的绝对路径）</span>
              <input
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder="/Users/you/code/my-project"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <div className="field">
              <span>自治级别</span>
              <div className="segmented">
                {(["off", "low", "medium", "high"] as const).map((level) => (
                  <button
                    key={level}
                    className={autonomy === level ? "seg active" : "seg"}
                    onClick={() => setAutonomy(level)}
                  >
                    {level === "off"
                      ? "只读"
                      : level === "low"
                        ? "低"
                        : level === "medium"
                          ? "中"
                          : "高"}
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setCreating(false)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={!cwd.trim()}
                onClick={() => {
                  setCreating(false);
                  onNew(cwd.trim(), autonomy);
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
