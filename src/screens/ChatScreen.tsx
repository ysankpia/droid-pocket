import { useEffect, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import ToolCard from "../components/ToolCard";
import type { ChatItem } from "../lib/types";

interface Props {
  title: string;
  items: ChatItem[];
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onBack: () => void;
}

export default function ChatScreen({
  title,
  items,
  busy,
  onSend,
  onStop,
  onBack,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [items]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    stickRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    stickRef.current = true;
    onSend(text);
  };

  return (
    <div className="screen chat-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          ‹
        </button>
        <div className="topbar-title ellipsis">{title || "新会话"}</div>
        <div className="topbar-actions">
          {busy ? (
            <button className="stop-btn" onClick={onStop}>
              停止
            </button>
          ) : (
            <span className="topbar-spacer" />
          )}
        </div>
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {items.length === 0 ? (
          <div className="empty">发一条消息开始。</div>
        ) : (
          items.map((item) => {
            if (item.kind === "user") {
              return (
                <div key={item.id} className="msg user">
                  <div className="bubble">{item.text}</div>
                </div>
              );
            }
            if (item.kind === "assistant") {
              return (
                <div key={item.id} className="msg assistant">
                  <Markdown text={item.text} streaming={item.streaming} />
                </div>
              );
            }
            if (item.kind === "tool") {
              return <ToolCard key={item.id} item={item} />;
            }
            return (
              <div key={item.id} className={`notice ${item.tone}`}>
                {item.text}
              </div>
            );
          })
        )}
        {busy ? (
          <div className="thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        ) : null}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={busy ? "等待当前轮次结束…" : "说点什么…"}
          rows={1}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="send-btn"
          onClick={submit}
          disabled={busy || !draft.trim()}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
