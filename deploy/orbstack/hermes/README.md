# Hermes 智能體（容器版）

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
| 啟動時的 cwd（通常是 `~/.cumora/agents/<id>`） | 這個智能體的家目錄，也是 ACP 的 cwd；拒絕掛載 `$HOME` 或 `/` |
| `~/.cumora/.runtime-cli-ipc/<id>` | `cumora` shim 跟常駐程式溝通的檔案 IPC |
| `cumora-hermes-<id>`（volume） | Hermes 自己的狀態與 `config.yaml` |

碰不到 Mac 上其他檔案、碰不到 `~/.cumora/computer.json`（裝置權杖）、也碰不到你自己 `~/.hermes` 的憑證。模型設定在資料卷裡，智能體自己改不到。

必須用 `--entrypoint` 直接執行 `hermes-acp`：映像預設的 s6 監督程序會把訊息印到 stdout，而 stdout 是 ACP 的 JSON-RPC 通道。

手動驗證（不帶 `CUMORA_AGENT_ID` 時用共用的 `probe` 身分、不掛 IPC）：

```bash
cd ~/.cumora/agents/hermes-probe && /path/to/hermes-acp-container
```

## 啟用

```bash
cd deploy/orbstack
./install-local-daemon.sh --hermes
```

這會在 launchd 設定裡加上：

- `CUMORA_BYOA_ALLOW_UNSANDBOXED=hermes`：**只**解除 Hermes 的沙箱要求，Claude 與 Codex 維持沙箱與版本檢查。
- `CUMORA_HERMES_ACP_BIN=<這個資料夾>/hermes-acp-container`：常駐程式只透過這支腳本啟動 Hermes。宿主上的 `hermes` 指令**不會**讓引擎被視為「已安裝」，也永遠不會被直接執行。

接著在 App 建立智能體時選「引擎 = Hermes」。

## 工具授權

Hermes 執行工具前會送 ACP `session/request_permission`。常駐程式的回覆規則（`answerAcpClientRequest`，見 `server/src/agents/computer/engine.ts`）：

| 引擎 | 回覆 |
|---|---|
| Hermes | 核准一次（`allow_once`，不寫入 Hermes 的永久設定）——邊界是容器，不是這個回答 |
| 其他 ACP 引擎（ZCode） | 立刻拒絕（`reject_once`），不再讓回合空等到逾時 |
| 其他任何反向請求（`fs/*`、`terminal/*`…） | JSON-RPC `-32601`，不再沉默 |

每次授權都會記到 `~/.cumora/daemon.log`，例如 `[hermes] session/request_permission for terminal: … → yes`。

## 已驗證

透過 `HermesAdapter` 實跑一輪：Hermes 在容器內用 terminal 工具寫入掛載進去的家目錄，回合正常結束並回報用量（輸入 24,117 / 輸出 165 tokens，本機 27B 模型約 110 秒）。

## 前置需求

- LM Studio 的伺服器要開著：`lms server start`（模型 `qwen3.8-27b`）。
- 換模型：改 `CUMORA_HERMES_MODEL`，並刪掉該智能體的資料卷讓設定重新產生，或直接改卷裡的 `config.yaml`。
