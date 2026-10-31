import { useRef, useState } from "react";
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
import { decodeQrFromFile } from "../lib/qr";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const connectWithCode = async (code: string) => {
    const payload = parsePairingCode(code);
    if (!payload) {
      setScanError("这不是 Droid Pocket 的配对码。");
      return false;
    }
    return onConnect({
      url: payload.u,
      token: payload.t,
      cwd: initial.cwd,
      name: payload.n,
    });
  };

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
      await connectWithCode(result.ScanResult ?? "");
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

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setScanError(null);
    setScanning(true);
    try {
      const code = await decodeQrFromFile(file);
      if (!code) {
        setScanError("这张图里没找到二维码，换一张清晰的截图试试。");
        return;
      }
      await connectWithCode(code);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "读取这张图片失败，换一张试试。",
      );
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
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
        {scanning ? "处理中…" : "扫码配对"}
      </button>

      <button
        className="btn ghost wide"
        onClick={() => fileRef.current?.click()}
        disabled={busy || scanning}
      >
        从相册选二维码
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden-file"
        onChange={(event) => void pickImage(event.target.files?.[0])}
      />

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
            家里用局域网就行。要在外面用，两边都开 Tailscale， 桥会自动把
            Tailscale 地址放进二维码里。
          </p>

          <h3>3. 扫码，或者从相册选</h3>
          <p>
            直接扫电脑屏幕上的二维码。不在电脑前（比如用远程桌面）就先截个图，
            再点「从相册选二维码」把截图选进来。
          </p>
          <p>
            桥启动时还会把二维码存成图片：
            <code>~/Desktop/droid-pocket-pairing.png</code>。
          </p>
          <p>都不方便的话，把终端里的配对码整串粘进来也可以。</p>
        </div>
      ) : null}
    </div>
  );
}
