# Droid Pocket

把你的 Droid 装进口袋。Android 客户端 + 电脑端桥，手机只做界面，真正的活在你电脑上干。

> 非官方项目，与 Factory 无关联。

## 它解决什么问题

Droid CLI 很强，但它绑在终端里。你不在电脑前的时候，想法就断了。

Droid Pocket 让手机变成一块遥控屏：看会话、发消息、看工具调用、随时打断。手机端**不跑任何 Agent 逻辑** —— MCP、Skills、Hooks、Plugins、Custom Droids、Missions、worktree 全部由电脑上的原版 `droid` 提供，配置零改动。

**手机端不需要任何 API Key。** 所有认证都发生在电脑上。

## 架构

```
┌──────────────┐    HTTP + NDJSON   ┌──────────────────────┐
│  Android App │ ─────────────────▶ │  droid-pocket bridge │
│  Capacitor   │                    │  你的电脑 :8787      │
│  React       │ ◀───────────────── │        │             │
└──────────────┘      事件流        │        ▼             │
                                    │  droid exec          │
                                    │  ~/.factory 登录态    │
                                    │  你的仓库 / git / 依赖 │
                                    └──────────────────────┘
```

桥是一个很小的 Node 进程。它接收手机发来的消息，转成一次 `droid exec` 调用，再把输出事件流回手机。

### 为什么不用官方 SDK

`@factory/droid-sdk` 在 spawn 子进程时**无条件**注入 `FACTORY_API_KEY`（见 `node.mjs` 的 `createTransport` / `resolveApiKey`），没有 key 就直接抛错，也不会回退到本机已保存的登录态。这意味着走 SDK 就必须在手机上放一把 Factory API Key。

而 `droid exec` 这条命令行完全不碰 SDK，它直接读本机 `~/.factory/auth.v2.loginkeychain` 里的登录态，并且使用 `~/.factory/settings.json` 里配置的 `customModels`（BYOK）。所以桥选的是 CLI，不是 SDK。

顺带一提：官方文档明确写了个人自定义模型**只**出现在 CLI 和桌面端，不会出现在 Factory 托管的 web / 移动端。所以想在手机上用自己的 provider，只能自建客户端。

## 安装

从 [Releases](../../releases/latest) 下载 `app-release.apk`。要求 Android 8.0 以上。

## 使用（电脑侧）

```bash
cd bridge
npm install
node index.mjs
```

终端会打印一个二维码、配对码和本机地址：

```
  Droid Pocket bridge v0.2.0  ·  your-mac

  Scan this with Droid Pocket:

  █▀▀▀▀▀█ ▄▀ ▄▀▀█ ...
  ...

  Addresses:
    http://192.168.1.46:8787
    http://100.101.102.103:8787   (Tailscale)

  Pairing page:  http://127.0.0.1:8787/
```

然后在手机上打开 App，点「扫码配对」，对着终端扫一下即可。

**不在电脑前？**（比如用远程桌面）桥启动时会把二维码存成一张图片：

```
~/Desktop/droid-pocket-pairing.png
```

把它传/截到手机上，点 App 里的「从相册选二维码」，选这张图就行。

相机和相册都不方便时，把终端里那串 `dp1.…` 配对码整段粘进输入框，效果一样。

想用网页看二维码：浏览器打开 `http://127.0.0.1:8787/`（这个页面带配对码，所以只允许本机访问）。

### 常用参数

```bash
node index.mjs --port 8787                        # 换端口
node index.mjs --name "Mac mini"                  # 换显示名
node index.mjs --host 127.0.0.1                   # 只允许本机连（默认 0.0.0.0）
node index.mjs --qr-out ~/Desktop/pair.png        # 换二维码图片位置，none 表示不生成
node index.mjs --public-url https://mac.tailnet.ts.net  # 手动指定写进二维码的地址
```

`--public-url` 用于自动探测不对的情况，比如你走 `tailscale serve` 发布了 HTTPS 域名。

配对令牌保存在 `~/.droid-pocket/config.json`。删掉这个文件就会生成新的令牌，旧手机需要重新配对。

### 在外面用

家里同一局域网直接就能连。

要用 Tailscale：两边都装并登录同一个 tailnet，桥会自动检测到 Tailscale 并把它的地址放进二维码（标记为 `Tailscale`）。检测依据是 `tailscale status` 的 `BackendState` 为 `Running` —— 关闭状态下 `tailscale ip` 仍会返回一个缓存地址，那是打不通的，所以不能只看 IP。

如果 Tailscale 地址连不上，用 `--public-url` 显式指定一个能通的地址。

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

- 手机上不保存任何模型 API Key，也没有 Factory 凭据
- 手机和电脑之间用一个随机配对令牌做鉴权，令牌只存在两端本地
- 没有中转服务器，没有第三方后端
- 桥默认监听 `0.0.0.0`，方便局域网连接；只在本机用可以加 `--host 127.0.0.1`
- 带配对码的网页只允许从本机访问
- 局域网是明文 HTTP。跨网络请用 Tailscale（自带加密），不要把 8787 端口直接暴露到公网

## 已知限制

- 自治级别按会话设定，一次 `droid exec` 跑完一轮；不提供逐条权限审批弹窗（CLI 非交互模式本身也不弹）
- 回复是整段到达，不是逐字流式（`droid exec -o stream-json` 不提供增量文本）；工具调用是实时推送的
- 暂不支持图片/文件附件
- 断线后需要手动重连
- 只做了聊天核心，没有 Missions / Automations 的专门界面

## 许可

MIT
