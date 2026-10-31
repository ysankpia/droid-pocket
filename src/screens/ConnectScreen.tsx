import { useState } from "react";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import {
  normalizeUrl,
  parsePairingCode,
  type ConnectionConfig,
} from "../lib/config";

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
  const [token, setToken] = useState(initial.token);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(!initial.url);

  const scan = async () => {
    setScanError(null);
    setScanning(true);
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "对准电脑终端里的二维码",
        scanButton: false,
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      });
      const payload = parsePairingCode(result.ScanResult ?? "");
      if (!payload) {
        setScanError("这不是 Droid Pocket 的配对码。");
        return;
      }
      await onConnect({
        url: payload.u,
        token: payload.t,
        cwd: initial.cwd,
        name: payload.n,
      });
    } catch (err) {
      setScanError(
        err instanceof Error
          ? `无法打开相机：${err.message}`
          : "无法打开相机，请手动填写。",
      );
    } finally {
      setScanning(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const pasted = parsePairingCode(token);
    if (pasted) {
      await onConnect({
        url: pasted.u,
        token: pasted.t,
        cwd: initial.cwd,
        name: pasted.n,
      });
      return;
    }
    await onConnect({
      url: normalizeUrl(url),
      token: token.trim(),
      cwd: initial.cwd,
    });
  };

  return (
    <div className="screen connect-screen">
      <div className="brand">
        <div className="brand-mark">◈</div>
        <h1>Droid Pocket</h1>
        <p className="brand-sub">连接你电脑上的 Droid，模型走电脑上的配置</p>
      </div>

      <button
        className="btn primary wide scan-btn"
        onClick={scan}
        disabled={busy || scanning}
      >
        {scanning ? "打开相机…" : "扫码配对"}
      </button>

      {scanError ? <div className="error-box">{scanError}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <div className="divider">
        <span>或手动填写</span>
      </div>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>电脑地址</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://192.168.1.46:8787"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </label>

        <label className="field">
          <span>配对码</span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="dp1.…（也可以直接粘贴整串配对码）"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <button
          className="btn primary wide"
          type="submit"
          disabled={busy || !token.trim()}
        >
          {busy ? "连接中…" : "连接"}
        </button>
      </form>

      <button className="link" onClick={() => setShowHelp((value) => !value)}>
        {showHelp ? "收起说明" : "电脑上要做什么？"}
      </button>

      {showHelp ? (
        <div className="help">
          <h3>1. 电脑上启动桥</h3>
          <pre>
            cd bridge{"\n"}npm install{"\n"}node index.mjs
          </pre>
          <p>
            终端会打印一个二维码和配对码。桥只是替你调用本机已经登录好的{" "}
            <code>droid</code>，所以手机不需要任何 API Key。
          </p>

          <h3>2. 手机和电脑在同一网络</h3>
          <p>
            家里用局域网就行。要在外面用，两边都开 Tailscale，
            然后把配对码里的地址换成 Tailscale 的地址。
          </p>

          <h3>3. 扫码</h3>
          <p>
            点上面的「扫码配对」。相机不可用时，把终端里的配对码整串粘进来也可以。
          </p>
        </div>
      ) : null}
    </div>
  );
}
