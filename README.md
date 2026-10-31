# Droid Pocket

把你的 Droid 装进口袋。Android 客户端，直连你电脑上的 `droid daemon`，手机只做界面，真正的活在你电脑上干。

> 非官方项目，与 Factory 无关联。使用公开的 `@factory/droid-sdk` 和你自己的 `droid daemon`。

## 它解决什么问题

Droid CLI 很强，但它绑在终端里。你不在电脑前的时候，想法就断了。

Droid Pocket 让手机变成一块遥控屏：

- 会话列表、新建会话、继续旧会话
- 流式输出、Markdown、代码块
- 工具调用卡片，点开看完整输入输出
- 权限审批弹窗，允许一次 / 总是允许 / 拒绝
- 随时打断

**关键在于**：手机端不跑任何 Agent 逻辑。MCP、Skills、Hooks、Plugins、Custom Droids、Missions、worktree 全部由电脑上的原版 droid 提供，配置零改动。

## 架构

```
┌──────────────┐     wss://      ┌─────────────────────────┐
│  Android App │ ──────────────▶ │  droid daemon           │
│  Capacitor   │                 │  127.0.0.1:3101         │
│  React       │ ◀────────────── │        │                │
└──────────────┘   JSON-RPC 事件  │        ▼                │
                                  │  droid exec             │
                                  │  你的仓库 / git / 依赖   │
                                  └─────────────────────────┘
```

## 安装

从 [Releases](../../releases/latest) 下载 `app-release.apk` 直接安装。要求 Android 8.0 以上、arm64 设备。

## 配置（电脑侧）

### 1. 启动守护进程

```bash
droid daemon -p 3101 --listen websocket
```

它只监听 `127.0.0.1`，本身**不带 TLS**，不要直接绑到 `0.0.0.0` 或公网。

### 2. 用 Tailscale 安全地发布到你的设备网络

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:3101
```

拿到一个形如 `https://<机器名>.<你的tailnet>.ts.net:8443` 的地址。

手机装 Tailscale 并登录同一个 tailnet，App 里填：

```
wss://<机器名>.<你的tailnet>.ts.net:8443
```

> 也支持 SSH 隧道或局域网直连（`ws://192.168.x.x:3101`），但公网务必用 `wss://`。

### 3. 填 API Key

在 `app.factory.ai/settings/api-keys` 生成一个 Factory API Key，填进 App。它只保存在这台手机上。

## 从源码构建

需要 Node 20+、JDK 21、Android SDK。

```bash
npm install
npm run build
npx cap sync android

cd android
./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

发布签名：把 keystore 放到 `android/app/release.keystore`，或用环境变量指定：

```bash
export ANDROID_KEYSTORE_PATH=/path/to/release.keystore
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=...
export ANDROID_KEY_PASSWORD=...
./gradlew assembleRelease
```

## 安全

- API Key 只存在手机本地（Capacitor Preferences），不上传任何服务器
- 没有中转服务器，没有第三方后端，手机直连你的电脑
- `wss://` 端到端加密由 Tailscale 提供
- 使用 `ws://` 时 App 会显示警告

## 已知限制

- 暂不支持图片/文件附件
- 暂不支持 MCP 授权流程的交互界面（在电脑上配置即可）
- 断线后需要手动重连
- 只做了聊天核心，没有 Missions / Automations 的专门界面

## 许可

MIT
