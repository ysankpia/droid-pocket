import { useState } from "react";
import type { ConnectionConfig } from "../lib/config";

interface Props {
  initial: ConnectionConfig;
  busy: boolean;
  error: string | null;
  onConnect: (config: ConnectionConfig) => Promise<boolean>;
}

export default function ConnectScreen({
  initial,
  busy,
  error,
  onConnect,
}: Props) {
  const [url, setUrl] = useState(initial.url);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [showHelp, setShowHelp] = useState(!initial.url);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onConnect({
      url: url.trim(),
      apiKey: apiKey.trim(),
      cwd: initial.cwd,
    });
  };

  return (
    <div className="screen connect-screen">
      <div className="brand">
        <div className="brand-mark">◈</div>
        <h1>Droid Pocket</h1>
        <p className="brand-sub">连接你电脑上的 Droid</p>
      </div>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>守护进程地址</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="wss://macbook.tailnet.ts.net:8443"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </label>

        <label className="field">
          <span>Factory API Key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="fk-..."
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        {url.trim().startsWith("ws://") ? (
          <div className="warn-box">
            正在使用未加密的 ws:// 连接。局域网自用可以，公网务必换成 wss://。
          </div>
        ) : null}

        {error ? <div className="error-box">{error}</div> : null}

        <button
          className="btn primary wide"
          type="submit"
          disabled={busy || !url || !apiKey}
        >
          {busy ? "连接中…" : "连接"}
        </button>
      </form>

      <button className="link" onClick={() => setShowHelp((value) => !value)}>
        {showHelp ? "收起配置说明" : "怎么配置？"}
      </button>

      {showHelp ? (
        <div className="help">
          <h3>1. 电脑上启动守护进程</h3>
          <pre>droid daemon -p 3101 --listen websocket</pre>
          <p>它只监听 127.0.0.1，本身不带 TLS，不要直接暴露到公网。</p>

          <h3>2. 用 Tailscale 把它安全地发布到你的设备网络</h3>
          <pre>tailscale serve --bg --https=8443 http://127.0.0.1:3101</pre>
          <p>
            然后在这里填{" "}
            <code>wss://&lt;机器名&gt;.&lt;你的 tailnet&gt;.ts.net:8443</code>。
            手机装上 Tailscale 并登录同一个 tailnet 即可。
          </p>

          <h3>3. 填 API Key</h3>
          <p>
            在 <code>app.factory.ai/settings/api-keys</code> 生成一个 Factory
            API Key。 它只保存在这台手机本地。
          </p>
        </div>
      ) : null}
    </div>
  );
}
