#!/usr/bin/env node
/**
 * Droid Pocket bridge.
 *
 * Runs on the computer that already has the Droid CLI installed and signed in.
 * The phone talks to this bridge; the bridge shells out to `droid exec` on the
 * phone's behalf. That means:
 *
 *   - the phone never stores an API key or a WorkOS token
 *   - the Droid CLI keeps using whatever login and custom (BYOK) models the
 *     computer already has configured
 *   - model inference goes to whatever provider `~/.factory/settings.json`
 *     points at, never through the bridge
 *
 * Wire protocol is plain HTTP + newline-delimited JSON so it works in an
 * Android WebView without any extra client library.
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const VERSION = "0.2.1";
const CONFIG_DIR = path.join(os.homedir(), ".droid-pocket");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SESSIONS_ROOT = path.join(os.homedir(), ".factory", "sessions");

// ---------------------------------------------------------------- utilities

const b64url = (value) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ------------------------------------------------------------------- config

async function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
  } catch {
    stored = {};
  }
  const config = {
    name: stored.name || os.hostname().replace(/\.local$/, ""),
    token: stored.token || b64url(await randomBytes(24)),
    port: stored.port || 8787,
  };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  return config;
}

async function randomBytes(length) {
  const { randomBytes: nodeRandom } = await import("node:crypto");
  return nodeRandom(length);
}

/**
 * The macOS Tailscale app runs as a userspace network extension, so its 100.x
 * address never shows up in `os.networkInterfaces()`. Ask the CLI instead, but
 * only trust it while the backend is actually running: `tailscale ip -4` keeps
 * answering with a stale address after the daemon is stopped.
 */
async function tailscaleAddress() {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 2500,
    });
    const status = JSON.parse(stdout);
    if (status.BackendState !== "Running") return null;
    const ips = status.Self?.TailscaleIPs ?? [];
    const v4 = ips.find((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
    if (v4) return v4;
  } catch {
    /* tailscale is optional */
  }
  return null;
}

async function addresses() {
  const out = [];
  const seen = new Set();

  const tailscale = await tailscaleAddress();
  if (tailscale) {
    out.push({ name: "tailscale", address: tailscale, tailscale: true });
    seen.add(tailscale);
  }

  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      out.push({
        name,
        address: entry.address,
        tailscale: entry.address.startsWith("100."),
      });
    }
  }
  // Tailscale addresses first: they work away from home.
  out.sort((a, b) => Number(b.tailscale) - Number(a.tailscale));
  return out;
}

/** The address that goes into the pairing code. */
async function pairingUrl(port, publicUrl) {
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  const list = await addresses();
  const primary = list[0];
  return `http://${primary ? primary.address : "127.0.0.1"}:${port}`;
}

// ----------------------------------------------------------------- sessions

async function listSessionFiles() {
  let dirs;
  try {
    dirs = await fs.readdir(SESSIONS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(SESSIONS_ROOT, dir.name);
    let entries;
    try {
      entries = await fs.readdir(full);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) files.push(path.join(full, entry));
    }
  }
  return files;
}

async function readHead(file, bytes = 8192) {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function listSessions(limit = 60) {
  const files = await listSessionFiles();
  const stats = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      stats.push({ file, mtime: stat.mtimeMs });
    } catch {
      /* ignore */
    }
  }
  stats.sort((a, b) => b.mtime - a.mtime);
  const sessions = [];
  for (const { file, mtime } of stats.slice(0, limit)) {
    let meta = null;
    try {
      const head = await readHead(file);
      const first = head.split("\n")[0];
      if (first) meta = JSON.parse(first);
    } catch {
      /* ignore */
    }
    if (!meta || meta.type !== "session_start") continue;
    sessions.push({
      id: String(meta.id || path.basename(file, ".jsonl")),
      title: String(meta.title || "").trim(),
      cwd: meta.cwd ? String(meta.cwd) : undefined,
      modified: new Date(mtime).toISOString(),
    });
  }
  return sessions;
}

const stripReminders = (text) =>
  String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim();

function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && block.type === "text" ? String(block.text ?? "") : "",
    )
    .join("");
}

function toolResultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block.text === "string") return block.text;
      if (block && block.type === "tool_result")
        return toolResultText(block.content);
      return "";
    })
    .join("");
}

async function readHistory(sessionId, limit = 300) {
  const files = await listSessionFiles();
  const file = files.find(
    (candidate) => path.basename(candidate, ".jsonl") === sessionId,
  );
  if (!file) throw new Error("Session not found");

  const raw = await fs.readFile(file, "utf8");
  const items = [];
  const toolsById = new Map();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== "message") continue;
    const message = record.message || {};
    const content = message.content;
    const messageId = String(record.id || "");

    if (message.role === "assistant") {
      const text = blockText(content);
      if (text.trim()) {
        items.push({
          kind: "assistant",
          id: messageId,
          text,
          streaming: false,
        });
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (!block || block.type !== "tool_use") continue;
        const item = {
          kind: "tool",
          id: `t-${block.id}`,
          toolUseId: String(block.id || ""),
          name: String(block.name || "tool"),
          input: block.input ?? {},
          running: false,
        };
        toolsById.set(item.toolUseId, item);
        items.push(item);
      }
      continue;
    }

    if (message.role === "user") {
      // Injected context (system reminders, catalogs) carries a `context-` id.
      if (messageId.startsWith("context-")) continue;
      for (const block of Array.isArray(content) ? content : []) {
        if (!block || block.type !== "tool_result") continue;
        const tool = toolsById.get(String(block.tool_use_id || ""));
        if (!tool) continue;
        tool.result = toolResultText(block.content);
        tool.isError = Boolean(block.is_error);
        tool.running = false;
      }
      const text = stripReminders(blockText(content));
      if (text) items.push({ kind: "user", id: messageId, text });
    }
  }

  return items.slice(-limit);
}

// -------------------------------------------------------------- droid spawn

function droidBinary() {
  return process.env.DROID_BIN || "droid";
}

function mapStreamEvent(event, emit) {
  switch (event.type) {
    case "system":
      emit({
        type: "session",
        sessionId: event.session_id,
        model: event.model,
        cwd: event.cwd,
      });
      return;
    case "message": {
      const text =
        typeof event.text === "string" ? event.text : blockText(event.content);
      if (event.role === "assistant") {
        if (text.trim()) emit({ type: "assistant", id: event.id, text });
      } else if (event.role === "user") {
        emit({ type: "echo", id: event.id, text: stripReminders(text) });
      }
      return;
    }
    case "reasoning":
      // Thinking arrives as growing fragments; the app only needs a busy
      // indicator, so nothing is forwarded here.
      return;
    case "tool_call":
      emit({
        type: "tool_call",
        id: String(event.id || ""),
        name: String(event.toolName || event.toolId || "tool"),
        input: event.parameters ?? {},
      });
      return;
    case "tool_result":
      emit({
        type: "tool_result",
        id: String(event.id || ""),
        isError: Boolean(event.isError),
        content:
          toolResultText(event.value) ||
          (typeof event.value === "string" ? event.value : ""),
      });
      return;
    case "completion":
      emit({
        type: "completion",
        sessionId: event.session_id,
        finalText: event.finalText,
        durationMs: event.durationMs,
        usage: event.usage,
      });
      return;
    case "error":
      emit({
        type: "error",
        message: String(event.message || event.error || "Unknown error"),
      });
      return;
    default:
      return;
  }
}

function runPrompt({ text, sessionId, cwd, autonomy }, emit, onDone) {
  const args = ["exec", "-o", "stream-json", "--cwd", cwd];
  if (autonomy && autonomy !== "off") args.push("--auto", autonomy);
  if (sessionId) args.push("-s", sessionId);

  const child = spawn(droidBinary(), args, {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let completed = false;
  let stderr = "";
  let killed = false;

  const finish = (payload) => {
    if (completed) return;
    completed = true;
    onDone(payload);
  };

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "completion") finish({ ok: true });
    mapStreamEvent(event, emit);
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  child.on("error", (error) => {
    emit({
      type: "error",
      message: `Cannot start the Droid CLI: ${error.message}`,
    });
    finish({ ok: false });
  });

  child.on("close", (code) => {
    if (killed) {
      emit({ type: "interrupted" });
      finish({ ok: false, interrupted: true });
      return;
    }
    if (!completed && code !== 0) {
      const message = stderr
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-4)
        .join("\n");
      emit({
        type: "error",
        message: message || `droid exec exited with code ${code}`,
      });
    }
    finish({ ok: code === 0 });
  });

  child.stdin.on("error", () => {
    /* the CLI may exit before reading stdin */
  });
  child.stdin.write(text);
  child.stdin.end();

  return {
    kill() {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2500).unref?.();
    },
  };
}

// ---------------------------------------------------------------- pairing UI

function pairingCode({ url, token, name }) {
  return `dp1.${b64url(JSON.stringify({ v: 1, u: url, t: token, n: name }))}`;
}

async function qrSvg(text) {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
  });
}

async function qrTerminal(text) {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(text, {
    type: "terminal",
    small: true,
    errorCorrectionLevel: "M",
  });
}

/** Write a standalone QR image the user can screenshot or send to the phone. */
async function writeQrPng(text, outPath) {
  const { default: QRCode } = await import("qrcode");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await QRCode.toFile(outPath, text, {
    type: "png",
    width: 720,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return outPath;
}

function landingPage({ name, urls, code, qr }) {
  const options = urls
    .map(
      (entry) =>
        `<li><code>http://${entry.address}:${entry.port}</code>${entry.tailscale ? ' <span class="tag">Tailscale</span>' : ""}</li>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Droid Pocket pairing</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0d10; color:#e7ecf3;
         font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  main { width:min(92vw,560px); padding:32px; }
  h1 { margin:0 0 4px; font-size:22px; letter-spacing:-.01em; }
  p  { color:#9aa7b8; margin:0 0 22px; }
  .qr { background:#fff; padding:16px; border-radius:16px; width:min(72vw,320px); margin:0 auto 22px; }
  .qr svg { display:block; width:100%; height:auto; }
  ul { padding-left:18px; color:#c7d2e0; margin:0 0 18px; }
  code { background:#161b22; padding:2px 6px; border-radius:6px; font-size:13px; }
  .tag { font-size:11px; color:#7ee0a8; border:1px solid #24503a; border-radius:999px; padding:1px 8px; }
  .hint { font-size:13px; color:#7d8b9e; }
  .code { word-break:break-all; background:#161b22; border-radius:10px; padding:12px;
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:#8fa3ba; }
</style></head>
<body><main>
  <h1>Pair Droid Pocket</h1>
  <p>${name} is ready. Open the app and tap <strong>Scan QR</strong>.</p>
  <div class="qr">${qr}</div>
  <p class="hint">Reachable at:</p>
  <ul>${options}</ul>
  <p class="hint">If the camera is not available, paste this pairing code into the app:</p>
  <div class="code">${code}</div>
</main></body></html>`;
}

// ------------------------------------------------------------------- server

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  const config = await loadConfig();
  const host = flag("host", "0.0.0.0");
  const port = Number(flag("port", config.port));
  const name = flag("name", config.name);

  const server = http.createServer(async (req, res) => {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const remote = req.socket.remoteAddress || "";
    const isLoopback =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "::ffff:127.0.0.1";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-droid-pocket-token",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    // Chrome's Private Network Access check for a WebView page that talks to a
    // private address.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const needsToken = url.pathname !== "/" && url.pathname !== "/api/ping";
    if (needsToken) {
      const headerToken = req.headers["x-droid-pocket-token"];
      if (headerToken !== config.token) {
        json(res, 401, { error: "Invalid pairing token" });
        return;
      }
    }

    try {
      if (url.pathname === "/" && req.method === "GET") {
        if (!isLoopback) {
          json(res, 403, {
            error: "The pairing page is only available on the computer itself",
          });
          return;
        }
        const list = await addresses();
        const target = await pairingUrl(port, flag("public-url", ""));
        const code = pairingCode({ url: target, token: config.token, name });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          landingPage({
            name,
            urls: list.map((a) => ({ ...a, port })),
            code,
            qr: await qrSvg(code),
          }),
        );
        return;
      }

      if (url.pathname === "/api/ping") {
        json(res, 200, { ok: true, name, version: VERSION });
        return;
      }

      if (url.pathname === "/api/sessions" && req.method === "POST") {
        const body = await readBody(req);
        json(res, 200, {
          sessions: await listSessions(Number(body.limit) || 60),
        });
        return;
      }

      if (url.pathname === "/api/history" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.sessionId) {
          json(res, 400, { error: "sessionId is required" });
          return;
        }
        json(res, 200, { items: await readHistory(String(body.sessionId)) });
        return;
      }

      if (url.pathname === "/api/prompt" && req.method === "POST") {
        const body = await readBody(req);
        const text = String(body.text || "").trim();
        if (!text) {
          json(res, 400, { error: "text is required" });
          return;
        }
        let cwd = String(body.cwd || "").trim();
        if (!cwd || cwd === "~") cwd = os.homedir();
        try {
          const stat = await fs.stat(cwd);
          if (!stat.isDirectory()) throw new Error("not a directory");
        } catch {
          json(res, 400, { error: `Working directory does not exist: ${cwd}` });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });

        const emit = (payload) => {
          if (!res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
        };

        const job = runPrompt(
          { text, sessionId: body.sessionId, cwd, autonomy: body.autonomy },
          emit,
          (result) => {
            emit({ type: "done", ...result });
            if (!res.writableEnded) res.end();
          },
        );

        res.on("close", () => {
          if (!res.writableEnded) job.kill();
        });
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: error.message });
      else res.end();
    }
  });

  server.listen(port, host, async () => {
    const list = await addresses();
    const target = await pairingUrl(port, flag("public-url", ""));
    const code = pairingCode({ url: target, token: config.token, name });

    console.log(`\n  Droid Pocket bridge v${VERSION}  ·  ${name}\n`);
    console.log("  Scan this with Droid Pocket:\n");
    const qrText = await qrTerminal(code);
    process.stdout.write(
      qrText
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );
    console.log("\n  Addresses:");
    for (const entry of list) {
      console.log(
        `    http://${entry.address}:${port}${entry.tailscale ? "   (Tailscale)" : ""}`,
      );
    }

    const qrOut = flag(
      "qr-out",
      path.join(os.homedir(), "Desktop", "droid-pocket-pairing.png"),
    );
    if (qrOut && qrOut !== "none") {
      try {
        await writeQrPng(code, qrOut);
        console.log(`\n  QR image:      ${qrOut}`);
      } catch (error) {
        console.log(`\n  Could not write the QR image: ${error.message}`);
      }
    }

    console.log(`\n  Pairing page:  http://127.0.0.1:${port}/`);
    console.log(`  Pairing code:  ${code}`);
    console.log(
      "\n  The phone needs no API key: turns run through this computer's `droid` login.",
    );
    console.log(
      "  No camera on the phone? Screenshot the QR image and pick it from the gallery.\n",
    );
    console.log("  Ctrl+C to stop.\n");
    void target;
  });

  const shutdown = () => {
    console.log("\n  Stopping bridge…");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { listSessions, readHistory, pairingCode };
