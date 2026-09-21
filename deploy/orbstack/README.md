# 在 OrbStack 上自架 Cumora（繁體中文版）

用 Docker Compose 在 Mac 上跑一整套 Cumora，裡面有 Postgres（含 pgvector）、Redis 和 Cumora 伺服器。伺服器同時提供網頁介面（`/`）、API（`/api`）和執行階段 API（`/runtime`）。

智能體的「大腦」走 **BYOA**：由這台 Mac 上的 Claude Code 或 Codex 執行，用的是你自己的訂閱，不需要 Kubernetes。所有服務只綁在 `127.0.0.1`，外部連不進來。

## 需求

- OrbStack（Docker 要能用）
- 一個 GitHub 帳號：登入只支援 OAuth，沒有帳號密碼登入
- Claude Code ≥ 2.1.248（或 Codex ≥ 0.138.0），並且已經登入

## 第一次安裝

**1. 建立 GitHub OAuth App**

到 <https://github.com/settings/applications/new>，填入：

| 欄位 | 值 |
|---|---|
| Application name | `Cumora (self-hosted)`（隨意） |
| Homepage URL | `http://localhost:5181` |
| Authorization callback URL | `http://localhost:5181/api/auth/callback/github` |

建好後記下 **Client ID**，然後按 **Generate a new client secret**。

**2. 填寫 `.env`**

```bash
cd deploy/orbstack
cp .env.example .env   # 如果 up.sh 已經建過就跳過這步
open -e .env
```

要填的是 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 和 `CUMORA_ADMIN_EMAILS`（你 GitHub 帳號的 email）。`POSTGRES_PASSWORD` 和 `AGENT_RUNTIME_SECRET` 會由 `up.sh` 自動產生，不用手填。

**3. 啟動**

```bash
./up.sh
```

打開 <http://localhost:5181>，用 GitHub 登入。第一次登入會自動建立工作區和一組初始智能體團隊。

**4. 配對這台 Mac，讓智能體動起來**

在網頁上到「我 → 電腦 → 新增一台電腦」，勾選「讓它在背景保持執行」，複製它給的指令，在終端機執行。指令大致長這樣：

```bash
npx cumora@latest agent computer --pair <配對碼> --server http://localhost:5181 --install-service
```

`--install-service` 會把常駐程式註冊成 launchd 服務，開機自動啟動、當掉會自動重啟。配對完成後，智能體就會在這台 Mac 上用 Claude Code 回覆訊息。

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
- 常駐程式用的是 npm 上的 `cumora` 套件（跟伺服器同版 0.18.6）。它的提示詞規則是上游版本，所以不含這個分支新增的「繁中進、繁中出」字體規則；平常用繁中和它說話，它就會用繁中回。
