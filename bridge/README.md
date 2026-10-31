# droid-pocket-bridge

电脑端桥。让手机上的 Droid Pocket 驱动这台电脑上已经登录好的 `droid`。

手机端不需要任何 API Key —— 桥替你调用本机的 `droid exec`，用的是本机登录态和
`~/.factory/settings.json` 里配置的自定义模型（BYOK）。

## 跑起来

```bash
npm install
node index.mjs
```

终端会打印二维码、配对码和本机地址。手机 App 扫码即可。

## 参数

| 参数            | 默认      | 说明                                 |
| --------------- | --------- | ------------------------------------ |
| `--port <n>`    | `8787`    | 监听端口                             |
| `--host <addr>` | `0.0.0.0` | 监听地址，只在本机用就填 `127.0.0.1` |
| `--name <name>` | 主机名    | App 里显示的电脑名                   |

## 接口

除 `/` 和 `/api/ping` 外，所有请求都需要 `x-droid-pocket-token` 头。

| 方法 | 路径            | 说明                                |
| ---- | --------------- | ----------------------------------- |
| GET  | `/`             | 配对页（含二维码），只允许本机访问  |
| GET  | `/api/ping`     | `{ ok, name, version }`             |
| POST | `/api/sessions` | 列出 `~/.factory/sessions` 下的会话 |
| POST | `/api/history`  | 读取某个会话的消息                  |
| POST | `/api/prompt`   | 跑一轮，返回 NDJSON 事件流          |

`/api/prompt` 的事件类型：`session`、`echo`、`tool_call`、`tool_result`、`assistant`、`error`、`interrupted`、`done`。

中断就是客户端断开这个 HTTP 请求，桥收到 close 会 kill 掉子进程。

## 令牌

保存在 `~/.droid-pocket/config.json`，首次运行自动生成。删掉该文件会重新生成，旧设备需要重新配对。

## 依赖

只依赖 `qrcode`（生成终端二维码和配对页的 SVG）。
