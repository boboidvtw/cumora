# 在 OrbStack 上自架 Cumora（繁體中文版）

用 Docker Compose 在 Mac 上跑一整套 Cumora，裡面有 Postgres（含 pgvector）、Redis 和 Cumora 伺服器。伺服器同時提供網頁介面（`/`）、API（`/api`）和執行階段 API（`/runtime`）。

智能體的「大腦」走 **BYOA**：由這台 Mac 上的 Claude Code 或 Codex 執行，用的是你自己的訂閱，不需要 Kubernetes。所有服務只綁在 `127.0.0.1`，外部連不進來。

## 需求

- OrbStack（Docker 要能用）
- Claude Code ≥ 2.1.248（或 Codex ≥ 0.138.0），並且已經登入

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

它會用 `CUMORA_ADMIN_EMAILS` 的第一個 email 建立帳號和工作區，並在預設瀏覽器直接登入。登入網址帶有 session token，腳本會直接交給瀏覽器，不會印出來。

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

## 日常操作

```bash
cd deploy/orbstack
docker compose ps                 # 狀態
docker compose logs -f server     # 伺服器日誌
docker compose stop               # 停止（資料保留）
docker compose start              # 再啟動
./up.sh                           # 改了程式碼或 .env 之後重建並重啟
```

### 備份資料庫

```bash
docker compose exec -T postgres pg_dump -U cumora cumora | gzip > cumora-$(date +%F).sql.gz
```

資料存在 `cumora_pgdata`、`cumora_redisdata` 和 `cumora_uploads` 三個 Docker volume。`docker compose down` 不會刪資料；**`docker compose down -v` 會全部刪掉**。

### 同步上游更新

```bash
git fetch https://github.com/yetone/cumora main
git merge FETCH_HEAD        # 在 zh-tw 分支上
./up.sh
```

上游如果新增了介面字串，`src/locales/zh-TW.ts` 還沒翻到的部分會先顯示英文，翻好補上即可。

## 注意事項

- **不要改 `.env` 裡自動產生的兩個密鑰。** `POSTGRES_PASSWORD` 已經寫進資料庫，改了會連不上；`AGENT_RUNTIME_SECRET` 一改，所有已配對的電腦都要重新配對。
- 註冊是開放的。只要能打開這個網址的人，都能用 GitHub 登入並建立自己的工作區。目前只綁 localhost，所以只有這台 Mac 能連。如果要開放到區網或外網，請先到 `/admin → 設定` 開啟候補名單（waitlist）。
- `OPENAI_API_KEY` 目前是佔位值。AI 頭像生成這類走伺服器端 OpenAI 的功能會失敗，但不影響聊天和 BYOA 智能體。
- 常駐程式用的是 npm 上的 `cumora` 套件（`cumora@latest`，會自動更新）。它的提示詞規則是上游版本，所以不含這個分支新增的「繁中進、繁中出」字體規則；平常用繁中和它說話，它就會用繁中回。
