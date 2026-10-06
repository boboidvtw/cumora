# 在 OrbStack 上自架 Cumora（繁體中文版）

用 Docker Compose 在 Mac 上跑一整套 Cumora，裡面有 Postgres（含 pgvector）、Redis 和 Cumora 伺服器。伺服器同時提供網頁介面（`/`）、API（`/api`）和執行階段 API（`/runtime`）。

智能體的「大腦」走 **BYOA**：由這台 Mac 上的 Claude Code 或 Codex 執行，用的是你自己的訂閱，不需要 Kubernetes。所有服務只綁在 `127.0.0.1`，外部連不進來。

## 需求

- OrbStack（Docker 要能用）
- Claude Code ≥ 2.1.248（或 Codex ≥ 0.138.0），並且已經登入
- （選用）LM Studio：Hermes 智能體的模型，和頭像判斷性別外觀都用它（`lms server start`，模型 `qwen3.8-27b`）。沒開的話這兩項會受影響，其他照常。

## 第一次安裝

```bash
cd deploy/orbstack
./up.sh      # 建置映像、初始化資料庫、啟動；第一次會自動產生 .env 和密鑰
```

**1. 設定管理員 email**：在 `.env` 的 `CUMORA_ADMIN_EMAILS=` 後面填你的 email，然後再跑一次 `./up.sh`。

**2. 登入**

```bash
./login.sh
```

它會用 `CUMORA_ADMIN_EMAILS` 的第一個 email 建立帳號和工作區，並在預設瀏覽器直接登入。登入網址帶有 session token，腳本會直接交給瀏覽器，不會印出來。新工作區預設叫「<顯示名稱> 的工作區」（顯示名稱沒給就用 email @ 前面那段），之後可以在工作區設定改名；用 GitHub 登入的新帳號也一樣。

這個指令只能在這台 Mac 上執行，因為它要進得去伺服器容器，所以不是對外開放的後門。之後想再登入（例如 session 過期或換瀏覽器），重跑 `./login.sh` 就好。

**3. 配對這台 Mac，讓智能體動起來**

```bash
./pair.sh                      # 預設用 Claude Code；改用 Codex：CUMORA_ENGINE=codex ./pair.sh
```

它會把這台 Mac 配對成你工作區的「電腦」，並把常駐程式註冊成 launchd 服務（開機自動啟動、當掉自動重啟、自動更新）。配對後，初始團隊（Atlas、Bram、Iris、Nova）會部署到這台 Mac，用 Claude Code 回覆。日誌在 `~/.cumora/daemon.log`。

### （選用）GitHub 登入

想讓別人從別台電腦登入，或邀請同事，才需要 GitHub OAuth。到 <https://github.com/settings/applications/new> 建立 OAuth App：

| 欄位 | 值 |
|---|---|
| Homepage URL | `http://localhost:5181` |
| Authorization callback URL | `http://localhost:5181/api/auth/callback/github` |

在 App 頁面按 **Generate a new client secret**（secret 只顯示一次），然後執行下面的指令。secret 輸入時不會顯示，完成後再跑 `./up.sh`：

```bash
./set-oauth.sh
```

用同一個 email 的 GitHub 帳號登入時，會自動接回 `./login.sh` 建立的同一個帳號。

## 讓智能體讀你的專案

預設情況下，每位智能體只看得到自己的家目錄（`~/.cumora/agents/<id>`），看不到你 Mac 上任何其他檔案。要讓它們讀你的專案，換成用這個 repo 自己建的常駐程式：

```bash
./install-local-daemon.sh                      # 開放 ~/Projects
CUMORA_AGENT_READ_PATHS=~/code ./install-local-daemon.sh
./install-local-daemon.sh --uninstall          # 回到官方 npm 版
```

它會把 npm 版的服務換成指向這個 repo 的 launchd 服務，並把 `CUMORA_AGENT_READ_PATHS` 列出的目錄加進 Claude 的沙箱白名單和 `--add-dir`。

- **只能讀，不能寫。** 沙箱仍然把寫入限制在智能體自己的家目錄，實測在 `~/Projects` 下建檔會失敗。
- **機密檔案一律擋掉。** `.env`、`*.pem`、`*.key`、`id_rsa*`、`.ssh/`、`.aws/`、`.npmrc` 這類檔案就算在開放目錄裡也讀不到（`engine.ts` 的 `SECRET_FILE_GLOBS`）。注意規則必須寫成 `//**/.env` 這種雙斜線形式，單斜線只比對工作目錄，模型用絕對路徑就會繞過。
- **代價：不再自動更新。** 同步上游之後要重跑一次 `./install-local-daemon.sh`。重跑會沿用上次的設定：Hermes 的開關、可讀目錄、Hermes 的模型等設定都會保留，不用再帶一次參數。

官方 npm 版常駐程式沒有這個設定，它唯一的放寬開關是 `CUMORA_BYOA_ALLOW_UNSANDBOXED=1`，那會整個關掉沙箱（模型可讀全機檔案、可連網），不建議用。

## Hermes 智能體

除了 Claude Code 和 Codex，這個分支多了一種引擎：[Hermes Agent](hermes/README.md)，跑在容器裡、模型用宿主上的 LM Studio，不需要任何雲端訂閱。只有這個 repo 建的常駐程式能跑它。

```bash
./install-local-daemon.sh --hermes      # 開啟（之後重跑會保留）
./install-local-daemon.sh --no-hermes   # 關掉
```

開啟後，建立智能體時選「引擎 = Hermes」即可。Hermes 只看得到它自己的家目錄和自己的資料卷，碰不到 Mac 上的其他檔案；Claude 和 Codex 的沙箱不受影響。

換模型或映像，就在安裝時帶上設定，之後重跑會記住；設成空值（例如 `CUMORA_HERMES_MODEL=`）就清掉、回到預設：

```bash
CUMORA_HERMES_MODEL=qwen3.8-27b ./install-local-daemon.sh
```

可用的設定有 `CUMORA_HERMES_MODEL`、`CUMORA_HERMES_IMAGE`、`CUMORA_HERMES_BASE_URL`、`CUMORA_HERMES_CONTEXT`、`CUMORA_HERMES_REASONING`、`CUMORA_HERMES_MIGRATE`，說明見 [hermes/README.md](hermes/README.md)。

## 日常操作

```bash
cd deploy/orbstack
docker compose ps                 # 狀態
docker compose logs -f server     # 伺服器日誌
docker compose stop               # 停止（資料保留）
docker compose start              # 再啟動
./up.sh                           # 改了程式碼或 .env 之後重建並重啟
```

### 跑測試

```bash
./test.sh                  # 單元測試
./test.sh --integration    # 單元測試＋整合測試
./test.sh --down           # 關掉測試用的資料庫
```

測試會另外啟動一組拋棄式的 Postgres 和 Redis（`test-services.yml`，port 55432／56379，資料只放在記憶體），**不會碰到正式的 Cumora 資料**。不要直接跑 `npm test`：沒設 `DATABASE_URL`／`REDIS_URL` 時會連到這台 Mac 預設的 5432／6379，那是別的容器。

整合測試裡的 `ws-doc-authorization` 每次通過都要等大約一分鐘才結束，這是上游測試本身的行為（房間的重連寬限計時器），不是卡住。

### 備份

```bash
./backup.sh --install      # 每天 03:30 自動備份（Mac 在睡眠的話，醒來後補跑）
./backup.sh                # 立刻備份一次
./backup.sh --uninstall    # 取消自動備份（已做好的備份會留著）
```

每份備份是 `~/.cumora/backups/cumora-<日期時間>/` 底下的三個檔案：資料庫 `db.sql.gz`、上傳檔案 `uploads.tar.gz`，和 `.env` 的副本 `env`。預設保留最近 14 份，日誌在 `~/.cumora/backup.log`。Redis 不備份，裡面只有佇列和暫存狀態，伺服器會自己重建。

- 換位置：`CUMORA_BACKUP_DIR=/Volumes/外接碟/cumora ./backup.sh --install`。預設位置和資料在同一顆硬碟上，防得了誤刪、防不了硬碟壞掉；放到外接碟或雲端同步資料夾比較保險。外接碟在備份時沒接上的話，那次會先備份到 `~/.cumora/backups`，並跳出通知，不會整天沒備份。
- 改保留份數：`CUMORA_BACKUP_KEEP=30 ./backup.sh --install`。
- `env` 裡有密鑰（資料庫密碼、`AGENT_RUNTIME_SECRET`、GitHub OAuth secret），所以備份資料夾只有你自己能讀。要放到雲端同步資料夾的話，記得這點。

**`.env` 不見了**：資料庫密碼和 `AGENT_RUNTIME_SECRET` 已經寫進資料裡，不能重新產生；不要直接跑 `./up.sh`（它會建一份新的 `.env`、產生新密鑰）。先從最近一份備份拿回來：

```bash
install -m 600 ~/.cumora/backups/cumora-<日期時間>/env .env
```

**還原**（會覆蓋目前的資料，先停伺服器）：

```bash
docker compose stop server
gunzip -c ~/.cumora/backups/cumora-<日期時間>/db.sql.gz \
  | docker compose exec -T postgres psql -U cumora -d cumora -v ON_ERROR_STOP=1
docker run --rm -i -v cumora_uploads:/data --entrypoint sh pgvector/pgvector:pg16 \
  -c 'find /data -mindepth 1 -delete && tar -C /data -xzf -' \
  < ~/.cumora/backups/cumora-<日期時間>/uploads.tar.gz
docker compose start server
```

資料存在 `cumora_pgdata`、`cumora_redisdata` 和 `cumora_uploads` 三個 Docker volume。`docker compose down` 不會刪資料；**`docker compose down -v` 會全部刪掉**。

### 同步上游更新

```bash
git fetch https://github.com/yetone/cumora main:refs/upstream/main
git merge refs/upstream/main     # 在 zh-tw 分支上
./test.sh --integration          # 先確認測試都過
./up.sh
git diff --stat ORIG_HEAD -- server/src/agents/computer   # 有列出檔案，就再跑下一行
./install-local-daemon.sh        # 常駐程式有改才需要；設定會沿用
```

每週自動檢查有沒有新的上游 commit：

```bash
./check-upstream.sh --install     # 每週一 09:00 檢查，有新 commit 就跳 macOS 通知
./check-upstream.sh               # 立刻檢查一次
./check-upstream.sh --uninstall   # 取消
```

它只抓取、不合併：上游放在 `refs/upstream/main`，不動工作目錄和分支。同一批 commit 只通知一次，完整清單記在 `~/.cumora/upstream-check.log`。通知裡「安全相關」的數字是依 commit 訊息的關鍵字（security／CVE／vuln）算的，只是提示，像「未驗證的寄件人不再算成員」這類修正不一定算得到，合併前還是看一下清單。

上游如果新增了介面字串，`src/locales/zh-TW.ts` 還沒翻到的部分會先顯示英文，翻好補上即可。

合併後跑一次掃描，找出沒經過 `t()` 的英文：

```bash
npm run i18n:scan
```

它只列出新出現的字串（已審過的誤判記在 `scripts/i18n-scan-allowlist.json`），有新項目時結束碼為 1。真正的漏網字串改完後，剩下的誤判用 `node scripts/scan-i18n-leftovers.mjs --update` 記錄為已審過。上游新增的伺服器錯誤訊息（`HttpError`）不在掃描範圍內，要另外補進 `src/lib/localize-api-error.ts`。

## 注意事項

- **不要改 `.env` 裡自動產生的兩個密鑰。** `POSTGRES_PASSWORD` 已經寫進資料庫，改了會連不上；`AGENT_RUNTIME_SECRET` 一改，所有已配對的電腦都要重新配對。
- 註冊是開放的。只要能打開這個網址的人，都能用 GitHub 登入並建立自己的工作區。目前只綁 localhost，所以只有這台 Mac 能連。如果要開放到區網或外網，請先到 `/admin → 設定` 開啟候補名單（waitlist）。
- 自架版本沒有 Cumora Cloud，所以「升級到 Pro」的入口（智能體設定的「執行位置」選單、初次設定頁底部）預設會藏起來。要顯示它們，就在 `.env` 加上 `CUMORA_HIDE_CLOUD_UPSELL=0`，再跑一次 `./up.sh`。
- `OPENAI_API_KEY` 目前是佔位值。走伺服器端 OpenAI 的功能會失敗，但不影響聊天和 BYOA 智能體。頭像不受影響，見下方「頭像」。
- 如果用的是 npm 上的官方常駐程式（`./pair.sh` 裝的那個，`cumora@latest`），它自己帶一份上游的提示詞規則，這個分支加的「繁中進、繁中出」規則傳不到它。伺服器仍會把簡體字轉成繁體（見下方「簡體字自動轉繁體」），但建議再用下面的指令把語言釘在人設上，讓模型一開始就用繁中寫；走的是伺服器這端，對兩種常駐程式都有效：

```bash
./set-language.sh                       # 預設：繁體中文、台灣用語
./set-language.sh you@example.com "語言：一律用英文回覆。"
```

新增智能體之後再跑一次即可；它是可重複執行的，只會覆寫人設裡的語言段落。

## 頭像

這裡沒有圖片 API，LM Studio 也只跑文字模型，所以頭像改成在伺服器上直接畫（`AVATAR_PROVIDER=local`）：依每位智能體固定的外型特徵（膚色、髮色、髮型、眼鏡）畫一張扁平插畫風的 SVG，同一位智能體重畫幾次都是同一張臉。建立智能體時會自動產生，也可以在智能體設定的「AI 生成頭像」按「重新生成」。

唯一需要模型的是判斷性別外觀（決定髮型和穿著的選項），這一步問宿主上的 LM Studio（`LOCAL_LLM_BASE_URL`、`LOCAL_LLM_MODEL`，預設 `qwen3.8-27b`）。LM Studio 沒開或逾時（120 秒）就改用名字雜湊決定，頭像照樣產生。

改回 OpenAI 圖片模型：在 `.env` 設 `AVATAR_PROVIDER=openai` 和真的 `OPENAI_API_KEY`，再 `./up.sh`。

## 簡體字自動轉繁體

本機模型偶爾會在繁體回覆裡混入簡體字（例如「多云」）。智能體寫入的文字會在伺服器端用 OpenCC 轉成繁體、台灣用語（`AGENT_OUTPUT_SCRIPT=zh-TW`，預設開啟），涵蓋：聊天回覆（`cumora reply`）、email、文件（標題和內容）、看板名稱與欄位、卡片標題／說明／留言、行事曆事件的標題和說明。

- **只轉含簡體字的句子。** 已經是繁體的句子一字不改，所以「查看」不會被改成「檢視」。
- **程式碼、網址、email 不動。** `` `inline` ``、```` ``` ```` 區塊、連結裡的簡體字保持原樣，指令和路徑才不會壞掉。
- 真人發的訊息不轉。
- **行事曆事件的 `--prompt` 不轉。** 那是給智能體的指令，不是給人看的文字，轉了可能改變意思。
- **編輯文件時找得到原文。** 智能體用 `doc replace --find` 或 `replace-block --anchor` 引用自己先前寫的簡體字原稿時，如果照原樣找不到，會再用轉換後的繁體找一次。
- 兩種常駐程式（npm 版和這個 repo 建的版本）都有效，因為轉換在伺服器這端。

關掉：在 `.env` 設 `AGENT_OUTPUT_SCRIPT=`（空值），再 `./up.sh`。人設裡的語言規則（`./set-language.sh`）仍然建議保留，它讓模型一開始就少寫簡體字，轉換只是最後一道保險。
