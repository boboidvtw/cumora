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

已經換成這個 repo 建的常駐程式（見下方「讓智能體讀你的專案」）之後，要重新配對也是跑 `./pair.sh`：它會先停掉自建的常駐程式、配對完再換回來，設定照舊，不會變成兩個常駐程式同時跑。

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
- **代價：不再自動更新。** 同步上游之後要重跑一次 `./install-local-daemon.sh`。重跑會沿用上次的設定：Hermes 和 Antigravity 的開關、可讀目錄、Hermes 的模型等設定都會保留，不用再帶一次參數。

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

## Antigravity（Gemini）智能體

個人 Google 帳號已經不能用 Gemini CLI 的「Sign in with Google」（Google 要個人用戶改用 Antigravity），要用 Gemini 就改用 Antigravity CLI（`agy`）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh   # 先看過再執行
bash /tmp/agy-install.sh        # 裝到 ~/.local/bin/agy
agy                             # 用 Google 帳號登入一次
./install-local-daemon.sh --antigravity      # 開啟（之後重跑會保留）
./install-local-daemon.sh --no-antigravity   # 關掉
```

開啟後，在智能體的編輯視窗把「引擎」改成 Antigravity。

- **沒有沙箱。** 常駐程式只會用它能套上沙箱的引擎（Claude Code、Codex）；其他引擎要一個一個列進 `CUMORA_BYOA_ALLOW_UNSANDBOXED` 才會出現，沒列的連偵測都不會顯示。Antigravity 直接跑在 Mac 上，可以讀你能讀的任何檔案（包括 `~/.ssh`、各種登入資料）、可以連網。Hermes 也在這份清單上，但它跑在容器裡，實際上碰不到 Mac 的檔案。
- **只給需要的智能體用。** 智能體會讀群組訊息、郵件和網頁，有人在裡面藏指令時，沒有沙箱的引擎能造成的傷害比較大。建議只讓少數智能體（例如做研究的）用 Antigravity，其他的留在 Codex 或 Claude Code。
- 安裝程式會在 `~/.zshrc` 和 `~/.zprofile` 尾端加一行 `export PATH=…/.local/bin:$PATH`；`~/.local/bin` 原本就在 PATH 裡的話，這行是重複的，可以刪。

## 日常操作

```bash
cd deploy/orbstack
docker compose ps                 # 狀態
docker compose logs -f server     # 伺服器日誌
docker compose stop               # 停止（資料保留）
docker compose start              # 再啟動
./up.sh                           # 改了程式碼或 .env 之後重建並重啟
```

哪裡怪怪的時候，先跑一次健康檢查：

```bash
./doctor.sh
```

它只讀不改、不印出任何密鑰，一次看完：`.env`、三個容器和網址、常駐程式有沒有在跑和連上伺服器、有沒有智能體一直跑不起來（例如 Claude Code 登入過期，會附上重新登入的方法）、最近一次執行是不是失敗了（包括引擎額度用完：常駐程式會等到引擎說的重設時間再試）、LM Studio 和 Hermes 映像、伺服器端的小型判斷最近 24 小時有沒有失敗、最新備份和異地副本是多久以前、上次還原演練的結果、zh-tw 有沒有落後上游、GitHub CI 的結果。每一項標 ✓（正常）、!（值得看一下）或 ✗（壞了，後面附修法），最後一行會說有沒有 ✗、有幾個 !；有 ✗ 時結束碼為 1。

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
./backup.sh --install      # 每天 03:30 自動備份（Mac 在睡眠的話，醒來後補跑）；之後再跑會沿用目前的設定
./backup.sh                # 立刻備份一次
./backup.sh --uninstall    # 取消自動備份（已做好的備份會留著）
```

每份備份是 `~/.cumora/backups/cumora-<日期時間>/` 底下的三個檔案：資料庫 `db.sql.gz`、上傳檔案 `uploads.tar.gz`，和 `.env` 的副本 `env`。預設保留最近 14 份，日誌在 `~/.cumora/backup.log`。備份失敗（例如 OrbStack 沒開）時會跳 macOS 通知，不會只默默寫進日誌。每日備份如果整個沒在跑（例如被取消、Mac 關機好幾天），每週一的上游檢查（見下方「同步上游更新」）會在最新備份超過 3 天時提醒你。Redis 不備份，裡面只有佇列和暫存狀態，伺服器會自己重建。每日備份也會順便整理 `~/.cumora` 底下的日誌：超過 10 MB 的（主要是常駐程式的 `daemon.log`，一天約長 300 KB）只留最後 2 萬行（`CUMORA_LOG_MAX_MB`、`CUMORA_LOG_KEEP_LINES`，設 `CUMORA_LOG_MAX_MB=0` 關掉）。

- 換位置：`CUMORA_BACKUP_DIR=/Volumes/外接碟/cumora ./backup.sh --install`。預設位置和資料在同一顆硬碟上，防得了誤刪、防不了硬碟壞掉；放到外接碟或雲端同步資料夾比較保險。外接碟在備份時沒接上的話，那次會先備份到 `~/.cumora/backups`，並跳出通知，不會整天沒備份。
- 改保留份數：`CUMORA_BACKUP_KEEP=30 ./backup.sh --install`。重跑 `--install` 時，沒在指令上給的設定（位置、份數、異地副本、加密、還原演練）都沿用已安裝的那份；要清掉某一項就寫成空的，例如 `CUMORA_BACKUP_OFFSITE_DIR= ./backup.sh --install` 會關掉異地副本。自動備份（launchd）列不出 `~/Downloads` 和 Google Drive 資料夾的內容（見下方「還原演練」），所以它把自己寫過的備份記在 `~/.cumora/backup-index`，照這份清單刪舊的；你從終端機手動做的備份它刪不掉，也不算在份數裡，下次從終端機跑 `./backup.sh` 時會一起清掉。
- `env` 裡有密鑰（資料庫密碼、`AGENT_RUNTIME_SECRET`、GitHub OAuth secret），所以備份資料夾只有你自己能讀。不要把備份資料夾直接放進雲端同步資料夾，改用下面的加密異地副本。

**加密異地副本（例如 Google Drive）**：本機備份做完後，再把它加密成一個 `cumora-<日期時間>.tar.xz.enc`，放進雲端同步資料夾，由 Google Drive for desktop 上傳。加密用 AES-256，密碼放在鑰匙圈（服務名稱 `cumora-backup`），不會寫進任何檔案；寫完會先解密驗證一次才改成正式檔名。異地這一步失敗時會跳通知，本機那份照樣算數。

```bash
# 第一次：在鑰匙圈產生一組隨機密碼（不會顯示）
security add-generic-password -s cumora-backup -a "$(id -un)" -l "Cumora backup encryption" -w "$(openssl rand -base64 32)"
# 設定每日備份同時寫異地副本（其他設定沿用目前的）
CUMORA_BACKUP_OFFSITE_DIR="$HOME/Library/CloudStorage/GoogleDrive-<帳號>/我的雲端硬碟/cumora-backups" \
  ./backup.sh --install
```

- **密碼一定要另存一份在這台 Mac 以外的地方**（iCloud 鑰匙圈、密碼管理器）。Mac 壞掉時鑰匙圈也一起沒了，沒有密碼就打不開雲端上的副本。取出密碼：`security find-generic-password -s cumora-backup -w`。
- 換一台 Mac 還原時，先用同一個服務名稱把密碼存進那台的鑰匙圈（上面第一行，把 `$(openssl rand …)` 換成你存下來的密碼），再跑 `./restore.sh <檔案>.tar.xz.enc`。
- **不加密**：`CUMORA_BACKUP_OFFSITE_ENCRYPT=0`（跟上面一起帶給 `--install`）改寫一般的 `cumora-<日期時間>.tar.xz`，不用鑰匙圈密碼。裡面有 `.env` 的密鑰，安全性就等於你的雲端帳號，資料夾不要分享給別人。`./restore.sh` 兩種檔都能還原。
- 預設保留最近 30 份（加密和不加密的合計），用 `CUMORA_BACKUP_OFFSITE_KEEP` 改。第一次讓 launchd 寫進 Google Drive 時，macOS 可能會問要不要允許存取，按允許。
- `./doctor.sh` 會顯示最新一份異地副本是多久以前，以及鑰匙圈裡的密碼還在不在。

**還原**：

```bash
./restore.sh --list                         # 看有哪些備份
./restore.sh                                # 還原最新的一份
./restore.sh ~/Downloads/cumora-backups/cumora-<日期時間>   # 還原指定的一份
./restore.sh <異地資料夾>/cumora-<日期時間>.tar.xz(.enc)      # 從異地副本還原
```

它會先問你，要輸入 `restore` 才會動手。動手前會把目前的狀態另外備份到 `~/.cumora/pre-restore`（保留 5 份，跟每日備份分開，所以不會被它的保留份數刪掉），還原完會印出「回到還原前」的指令；還原錯了，照著跑就能回去。接著停伺服器、換掉資料庫和上傳檔案（上傳檔案會先清空，結果跟備份一模一樣），再啟動伺服器並等它恢復正常。

它會在每日備份寫入的位置找備份（`./backup.sh --install` 設定的 `CUMORA_BACKUP_DIR`），也會找 `~/.cumora/backups`（外接碟沒接上時的備份落在這裡）；`--list` 另外列出異地資料夾裡的副本。異地副本會先解開（加密的先用鑰匙圈的密碼解密）到 `~/.cumora` 底下的暫存資料夾，結束後自動刪除。

**`.env` 不見了**：資料庫密碼和 `AGENT_RUNTIME_SECRET` 已經寫進資料裡，不能重新產生，`./up.sh` 也會拒絕產生新的。直接跑 `./restore.sh`：`.env` 不在時，它會先從備份放回來（就算你在確認時取消，`.env` 也已經回來了）。`.env` 還在的話會保留目前的，只在跟備份不同時提醒是哪幾個鍵。

**還原演練**：備份要真的還原過一次才算數。`./restore-drill.sh` 把備份還原到另一個拋棄式的 compose 專案（`cumora-drill`，port 5192），檢查完就整個刪掉，正式的 Cumora 完全不動。

```bash
./restore-drill.sh                 # 演練最新的異地副本（沒設定異地副本就用最新的本機備份）
./restore-drill.sh <備份資料夾或 .tar.xz(.enc)>
```

不用另外排程：每日備份做完後，如果上次演練通過已經滿 30 天，就直接拿剛寫好的那份（有異地副本就用異地副本）演練一次；演練失敗的話，下一次備份會再試。改天數：`CUMORA_BACKUP_DRILL_DAYS=14 ./backup.sh --install`（跟其他設定一起帶），設 `0` 關閉。

它模擬最壞的情況：手上只有備份、沒有 `.env`。先用備份裡的 env 把拋棄式專案開起來，刪掉 `.env`，再照你平常的方式跑 `./restore.sh`，然後確認：`.env` 一模一樣地回來了、每張表的筆數跟備份裡的 dump 相同、每個上傳檔案的 checksum 相同、伺服器回應 `/api/health` 而且有帳號。`realtime_outbox` 不比筆數：伺服器一開機就會清掉已經送出、超過保留時間的即時事件。結果寫在 `~/.cumora/restore-drill.last`，`./doctor.sh` 會顯示，並跳出 macOS 通知；自動跑的日誌在 `~/.cumora/backup.log`。

為什麼不是獨立的排程：由 launchd 執行的工作，macOS 不讓它列出 `~/Downloads` 或 Google Drive 資料夾的內容，也不讓它讀別人建的檔案，只能讀自己寫的。每日備份讀得到自己剛寫的副本，所以演練由它順便跑。同理，`check-upstream.sh` 讀不到備份資料夾時，改看 `~/.cumora/backup.log` 最後一次「備份完成」的時間，不會誤報「備份太久沒更新」。

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
- `OPENAI_API_KEY` 目前是佔位值。伺服器自己的小型判斷改問 LM Studio，見下方「伺服器端的小型判斷」；頭像見下方「頭像」。仍然只走 OpenAI 的是記憶的向量搜尋（embeddings），它會失敗，但不影響聊天和 BYOA 智能體。
- 如果用的是 npm 上的官方常駐程式（`./pair.sh` 裝的那個，`cumora@latest`），它自己帶一份上游的提示詞規則，這個分支加的「繁中進、繁中出」規則傳不到它。伺服器仍會把簡體字轉成繁體（見下方「簡體字自動轉繁體」），但建議再用下面的指令把語言釘在人設上，讓模型一開始就用繁中寫；走的是伺服器這端，對兩種常駐程式都有效：

```bash
./set-language.sh                       # 預設：繁體中文、台灣用語
./set-language.sh you@example.com "語言：一律用英文回覆。"
```

新增智能體之後再跑一次即可；它是可重複執行的，只會覆寫人設裡的語言段落。

## 伺服器端的小型判斷

除了智能體本身（在這台 Mac 上用 Codex／Antigravity／Hermes 跑），伺服器也會自己做一些小判斷：智能體閒下來時，看板上指派給它的卡片、到期的行事曆事件、停在一半的對話，值不值得叫醒它去處理（agenda）；還有訊息分流、Convene 的決策摘要、配色等。上游把這些送到 OpenAI；這裡沒有金鑰，以前每次都 401 失敗，智能體也就不會主動去接看板上的工作。

現在預設（`SERVER_LLM=local`）改問 LM Studio 上的同一個模型（`LOCAL_LLM_BASE_URL`、`LOCAL_LLM_MODEL`）。每次呼叫都會關掉模型的推理（Qwen 就算設成最低也會先想兩三百個 token，一次要 16 秒左右；關掉約 4 秒，常駐程式等 `/agenda` 只等 20 秒）。這些呼叫在用量統計裡記成這個模型、費用 0。

LM Studio 沒開時，這些判斷照舊失敗並退回上游的保守預設（agenda 只在「一段很新的對話、別人最後發言」時叫醒智能體），不影響聊天。改回 OpenAI：在 `.env` 設 `SERVER_LLM=openai` 和真的 `OPENAI_API_KEY`，再 `./up.sh`。

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
