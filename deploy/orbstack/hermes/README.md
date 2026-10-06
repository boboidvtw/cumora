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

接著在 App 建立智能體時選「引擎 = Hermes」。之後重跑 `./install-local-daemon.sh`（例如同步上游後）不用再帶 `--hermes`，會沿用；要關掉用 `--no-hermes`。

## 工具授權

Hermes 執行工具前會送 ACP `session/request_permission`。常駐程式的回覆規則（`answerAcpClientRequest`，見 `server/src/agents/computer/engine.ts`）：

| 引擎 | 回覆 |
|---|---|
| Hermes | 核准一次（`allow_once`，不寫入 Hermes 的永久設定）——邊界是容器，不是這個回答 |
| 其他 ACP 引擎（ZCode） | 立刻拒絕（`reject_once`），不再讓回合空等到逾時 |
| 其他任何反向請求（`fs/*`、`terminal/*`…） | JSON-RPC `-32601`，不再沉默 |

每次授權都會記到 `~/.cumora/daemon.log`，例如 `[hermes] session/request_permission for terminal: … → yes`。

## 已驗證

- 透過 `HermesAdapter` 實跑：Hermes 在容器內用 terminal 與 write_file 寫入掛載的家目錄，回合正常結束並回報用量。
- 在 App 裡實測（智能體 `hermes`，人設見 `../personas/hermes.md`）：它在 #all-hands 接手一則待回的天氣問題，用 `cumora glance` 看對話、`cumora reply` 發出回覆，查的是 open-meteo 的即時預報。過程中兩次授權請求都自動核准。
- 本機 27B 模型很慢：第一輪約 18 分鐘，第二輪（問 AAPL 股價）約 12 分鐘。

## 速度：時間花在哪

從 LM Studio 的 log 看（`~/.lmstudio/server-logs/`）：

| 項目 | 數字 |
|---|---|
| 生成速度 | 約 11–12 tokens/秒 |
| 每一步工具呼叫的輸出 | 1,000–2,900 tokens，幾乎都是模型的「思考」，**每步 1.5–4 分鐘** |
| 讀提示（有快取時） | 每步只讀新增的 300–1,300 tokens，幾秒 |
| 讀提示（冷啟動） | 容器重開後整份約 16k tokens 重讀，約 2 分鐘 |
| 額外的模型呼叫 | 標題生成（30 秒逾時）、每條指令的 smart-approval 審查——同一顆模型、一次只跑一個，會排隊 |

所以 `hermes-acp-container` 新建的設定預設：

- `agent.reasoning_effort: none`：關掉思考。實測同一個 write_file 任務，輸出從 196 降到 43 tokens，後續每步 2 秒左右。要打開：`CUMORA_HERMES_REASONING=low`（這顆模型只分開／關，任何非 none 值都等於開）。
- `auxiliary.title_generation.enabled: false`：Cumora 有自己的對話名稱，用不到。
- `approvals.mode: "off"`：審查由容器邊界負責，不必再問一次模型。

新建的資料卷會直接寫入這些設定。既有的資料卷會在智能體下次啟動 session 時自動補上：

- **只補缺少的鍵**，手動設過的值（例如把 `approvals.mode` 改回別的）不會被蓋掉，註解也會保留。
- **每個資料卷只做一次**：完成後在卷裡寫入 `/opt/data/.cumora-config-version`。之後刻意刪掉的鍵不會再被補回來。
- 補了哪些鍵會記在常駐程式的日誌（`~/.cumora/daemon.log`），搜尋 `hermes-acp-container:` 即可。
- 不想自動遷移：設 `CUMORA_HERMES_MIGRATE=0`。

注意：舊資料卷如果沒設過 `approvals.mode`，會被補成 `"off"`，也就是不再讓模型審查指令，改由容器邊界負責，和新建的資料卷一致。

之後如果要調整預設值：在 `hermes-acp-container` 把 `config_version` 加一，並把新的鍵加進 `MIGRATE_DEFAULTS`。

## 已知狀況

- Hermes 內建的安全掃描會把中文字判為「易混淆 Unicode」而請求授權，這邊會自動核准。`approvals.mode: "off"` 後不再經過模型審查。
- 模型偶爾混入簡體字（例如「多云」）。伺服器會在寫入時自動轉成繁體，聊天、email、文件、看板、卡片、行事曆都涵蓋（見 [簡體字自動轉繁體](../README.md#簡體字自動轉繁體)），所以畫面上看不到。

## 前置需求

- LM Studio 的伺服器要開著：`lms server start`（模型 `qwen3.8-27b`）。
- 換模型：`CUMORA_HERMES_MODEL=<模型> ../install-local-daemon.sh`（要寫進 launchd 設定才有效，只在 shell 裡 export 沒用），並刪掉該智能體的資料卷讓設定重新產生，或直接改卷裡的 `config.yaml`。其他 `CUMORA_HERMES_*` 設定也一樣用安裝時帶入的方式。
