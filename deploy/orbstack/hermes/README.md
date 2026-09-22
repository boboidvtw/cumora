# Hermes 智能體（容器版）— 進行中

目標：讓 Hermes Agent 當 Cumora 的一種 BYOA 引擎，這樣建智能體時可以選「引擎 = hermes」，它就帶著 Hermes 自己的工具和 skills（網路搜尋、瀏覽器、GitHub、kanban、cron、MCP）。

Hermes 跑在容器裡，不是宿主上。邊界由我們給，不是信任 Hermes 自己的機制。

## 已驗證可行

用 `nousresearch/hermes-agent:latest`（arm64，3.89GB）實測：

- ACP 握手成功（Hermes 0.21.4）。
- `session/new` 成功，模型是宿主 LM Studio 的 `lmstudio:qwen3.8-27b`，容器經 `host.docker.internal:1234` 連出去。
- 完整跑完一輪對話：13.6 秒，含思考串流、回覆與用量（輸入 11,976 / 輸出 54 tokens）。

[`hermes-acp-container`](hermes-acp-container) 是給 Cumora 直接 spawn 的 ACP 端點。它只掛載：

| 掛載 | 用途 |
|---|---|
| `~/.cumora/agents/<id>` | 這個智能體的家目錄，也是 ACP 的 cwd |
| `~/.cumora/.runtime-cli-ipc/<id>` | `cumora` shim 跟常駐程式溝通的檔案 IPC |
| `cumora-hermes-<id>`（volume） | Hermes 自己的狀態與 `config.yaml` |

碰不到 Mac 上其他檔案、碰不到 `~/.cumora/computer.json`（裝置權杖）、也碰不到你自己 `~/.hermes` 的憑證。模型設定在資料卷裡，智能體自己改不到。

必須用 `--entrypoint` 直接執行 `hermes-acp`：映像預設的 s6 監督程序會把訊息印到 stdout，而 stdout 是 ACP 的 JSON-RPC 通道。

手動驗證：

```bash
CUMORA_AGENT_ID=hermes-probe \
CUMORA_AGENT_IPC_DIR=~/.cumora/.runtime-cli-ipc/hermes-probe \
  ./hermes-acp-container
```

## 還沒做的部分

1. **`HermesAdapter` 與註冊表接線**。ACP 連線層已經一般化成 `AcpEngineSession` + `AcpEngineProfile`（見 `server/src/agents/computer/engine.ts`），照 ZCode 的樣子加一個 profile 即可。接線點由 `npm run guard:engine-registry` 列出，漏一個就會失敗。
2. **回覆 ACP 的工具授權請求**（關鍵）。Hermes 執行工具前會送 `session/request_permission` 給客戶端，而目前 `AcpRpcConnection` 只處理通知、不回覆帶 id 的請求，於是引擎會空等到自己超時——先前一次 7 分鐘無回應就是這個。**沒有這段，Hermes 智能體發不出訊息**，因為發訊息就是執行 `cumora reply` 這個工具。做法：帶 id 且帶 method 的訊息一律回覆；只有容器版的 profile 自動核准，其他引擎立刻拒絕而不空等。
3. **沙箱開關已改成可指定引擎**（未提交）：`CUMORA_BYOA_ALLOW_UNSANDBOXED=hermes` 只解除 Hermes，Claude 與 Codex 維持沙箱與版本檢查；設 `=1` 行為與過去相同。

第 1、2 項在這個工作階段被自動安全檢查擋下（判定為「建立不安全的智能體」），需要放寬權限才能繼續。

## 前置需求

- LM Studio 的伺服器要開著：`lms server start`（模型 `qwen3.8-27b`）。
- 換模型：改 `CUMORA_HERMES_MODEL`，並刪掉該智能體的資料卷讓設定重新產生，或直接改卷裡的 `config.yaml`。
