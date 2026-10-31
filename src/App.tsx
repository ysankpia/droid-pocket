import { useEffect, useState } from "react";
import ConnectScreen from "./screens/ConnectScreen";
import SessionsScreen from "./screens/SessionsScreen";
import ChatScreen from "./screens/ChatScreen";
import PermissionSheet from "./components/PermissionSheet";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type ConnectionConfig,
} from "./lib/config";
import { useDroid } from "./lib/useDroid";

type View = "connect" | "sessions" | "chat";

export default function App() {
  const [config, setConfig] = useState<ConnectionConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("connect");

  const droid = useDroid();

  useEffect(() => {
    loadConfig().then((saved) => {
      setConfig(saved);
      setLoaded(true);
    });
  }, []);

  const handleConnect = async (next: ConnectionConfig) => {
    const ok = await droid.connect(next);
    if (ok) {
      setConfig(next);
      await saveConfig(next);
      setView("sessions");
      await droid.refreshSessions();
    }
    return ok;
  };

  const handleNewSession = async (
    cwd: string,
    autonomy: "off" | "low" | "medium" | "high",
  ) => {
    const id = await droid.createSession(cwd, autonomy);
    if (id) {
      setConfig((prev) => ({ ...prev, cwd }));
      await saveConfig({ ...config, cwd });
      setView("chat");
    }
  };

  const handleOpenSession = async (id: string) => {
    setView("chat");
    await droid.openSession(id);
  };

  if (!loaded) {
    return <div className="boot">加载中…</div>;
  }

  return (
    <div className="app">
      {view === "connect" ? (
        <ConnectScreen
          initial={config}
          busy={droid.status === "connecting"}
          error={droid.error}
          onConnect={handleConnect}
        />
      ) : null}

      {view === "sessions" ? (
        <SessionsScreen
          sessions={droid.sessions}
          error={droid.error}
          onRefresh={droid.refreshSessions}
          onOpen={handleOpenSession}
          onNew={handleNewSession}
          onDisconnect={() => {
            droid.disconnect();
            setView("connect");
          }}
        />
      ) : null}

      {view === "chat" ? (
        <ChatScreen
          title={droid.title}
          items={droid.items}
          busy={droid.busy}
          onSend={droid.send}
          onStop={droid.stop}
          onBack={async () => {
            setView("sessions");
            await droid.refreshSessions();
          }}
        />
      ) : null}

      {droid.permission ? (
        <PermissionSheet permission={droid.permission} />
      ) : null}
    </div>
  );
}
