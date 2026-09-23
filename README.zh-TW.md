# Talaria

[English](README.md) | **繁體中文**

Talaria 是優先在本機運作的個人 AI 工作區，提供 Web 介面與 Telegram Bot。專案使用 **TypeScript 與 Node.js**，可選擇 Pi、Deep Agents 與 OpenAI Agents SDK 執行任務，並參考 Hermes Agent 架構實作本機記憶與技能管理。

執行 `npm run dev` 即可開始開發，不需要 Python、Docker、Redis 或獨立資料庫伺服器。本機模型可選用 Ollama，也可以直接連接雲端 API。

## Talaria 可以做什麼

- 建立有各自角色、模型、工具、技能及獨立或共用記憶的 agent，透過 Web 對話或已配對的 Telegram 續聊。
- 在 Web 串流顯示模型回覆，展開查看工具執行紀錄。
- 讀取工作區檔案；取得寫入權限後，可修改檔案或保存知識。
- 保存長期記憶、按需載入可重用技能，並搜尋過往對話。
- 連接 OpenAI、Anthropic、本機 Ollama 或自訂 OpenAI 相容 API。
- 使用通訊軟體式介面，包含深色、淺色、系統外觀、手機導覽、歷史搜尋、Markdown 與程式碼複製。

Web 版面參考 [xAI 的 Grok Bot 官方設計](https://x.ai/news/designing-grok-bot)，保留 Talaria 自己的識別與功能。目前應用程式介面使用繁體中文，專案文件提供英文與繁體中文兩版。

## 架構與分工

| 元件                            | 負責內容                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `@earendil-works/pi-ai`         | 模型供應商連接、統一模型介面與串流回覆。                                      |
| `@earendil-works/pi-agent-core` | Agent 執行循環：詢問模型、執行工具、回傳工具結果，再繼續完成任務。            |
| Talaria                         | Web 與 Telegram 入口、任務生命週期、權限、本機資料保存、記憶與技能。          |
| Hermes Agent                    | 作為記憶處理與技能按需載入的架構參考，由 Talaria 使用 TypeScript 在本機實作。 |

兩個 Pi 套件固定使用 `0.87.0`。Pi 仍是預設引擎，自建 agent 也可使用 `deepagents` 或 `@openai/agents`，共用 Talaria 的工具、權限與長期記憶。Talaria 不安裝 Hermes Agent，也不連接 Hermes Gateway；記憶實作採用部分架構概念，並非完整移植 Hermes。

```text
Web 瀏覽器 ── HTTP / run polling ──┐
Telegram ───── 長輪詢 ────────┤
                              ▼
                         共用任務服務
                          ├─ 歷史、進度、取消
                          ├─ 記憶與技能索引
                          ├─ agent 快照 → Pi / Deep Agents / OpenAI SDK → 模型
                          ├─ 受權限控制的本機工具
                          └─ 原子寫入的 JSON 儲存
```

## 快速開始

需要 **Node.js 22.19 或更新版本**與 npm。

```sh
git clone https://github.com/Suckashi/Talaria.git
cd Talaria
npm ci
npm run dev
```

開啟 [http://localhost:3100](http://localhost:3100)。

在 **Bot 設定**連接模型並儲存，下一次任務就會使用新設定，不需重新啟動。尚未設定模型時，可在輸入框的 **任務選項**選擇 **示範模式**，體驗不呼叫 API 的預先編寫串流回覆。

開發指令會一起啟動伺服器與前端建置。修改檔案後，瀏覽器資源會重新編譯，後端則自動重啟；前端更新後請重新整理瀏覽器。

## 建立 Agent

開啟 **我的 Agents → 建立 Agent**，可從研究、程式碼閱讀或寫作範本開始，再設定角色、命名模型連線、模型 ID、工具、技能與記憶範圍。執行引擎放在「進階設定」。儲存後按 **開始對話** 即可試聊，也可從輸入框的任務選項選擇 agent。

| 引擎              | 模型連線                                | 執行方式                                                                          |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| Pi                | OpenAI、Anthropic、Ollama、自訂相容 API | 既有 Talaria 執行迴圈與工具                                                       |
| Deep Agents       | OpenAI、Anthropic、Ollama、自訂相容 API | 規劃、內部子任務、虛擬筆記與框架摘要                                              |
| OpenAI Agents SDK | OpenAI、Ollama、自訂相容 API            | SDK 執行迴圈；OpenAI 使用 Responses，其餘使用 Chat Completions；停用 SDK 追蹤上傳 |

所有引擎都在 Node.js 執行，不需要 Python 服務、LangSmith 部署或資料庫伺服器。npm 依賴會增加，引擎模組則按需載入。模型需支援工具與串流。每個 agent 選擇命名模型連線與模型 ID；各連線獨立保存網址與金鑰。原有 Bot 設定仍供預設 Talaria、Telegram 與舊版 agent 使用。

獨立記憶與歷史搜尋限於該 agent；共用 agent 使用 Talaria 的共用記憶與共用對話搜尋。Agent 可讀取勾選的共用技能與自己建立的技能。工作區檔案仍共用，擁有者可從管理介面查看所有知識；這不是多使用者隔離。

建立後固定記憶範圍。編輯只影響之後建立的對話，既有對話保留設定快照。封存會保留記憶與既有對話。Telegram `/new` 使用預設 Talaria，`/resume` 則沿用自建對話的 agent。

Deep Agents 內建檔案系統使用對話內的虛擬狀態，不存取主機檔案。真實檔案使用 `workspace_list_files`、`workspace_read_file` 與 `workspace_write_file`，沿用 Talaria 權限。虛擬筆記與待辦會在成功完成時保存。真實寫入與長期知識保存仍需勾選工具及開啟本次寫入權限，不啟用 shell backend。

目前沒有視覺化工作流程／交接編輯器或跨引擎協作。UI 尚未設定 OpenAI SDK handoffs；Deep Agents 可透過繼承工具權限的內部子任務進行委派。

開啟側欄 **模型連線 → 新增連線**，儲存名稱、服務、模型、端點與金鑰，再於 Agent 選取此連線。可同時保存多個 OpenAI 相容服務，不必覆蓋原有設定。更換供應商或網址會清除舊金鑰，避免誤送到新端點。仍被 Agent 或既有對話使用的連線不可封存。

## 背景任務與操作紀錄

任務由伺服器持有。按「背景執行」可離開對話處理其他工作；關閉分頁或網路斷線都不會停止任務。側欄「任務紀錄」提供狀態、回覆、工具名稱、目標、操作結果與模型回報的 token 用量，並以每頁 50 筆載入。可停止進行中的任務或開啟來源對話。

服務與電腦仍需保持運作。重啟會將未完成任務標記為中斷，已開始但未記錄完成的工具操作標記「結果待確認」，不自動重跑。新訊息是新任務；有副作用的操作請先檢查結果。Deep Agents 用量只包含主流程可取得的訊息統計，並非完整子任務帳單；未提供用量的服務不顯示估算費用。

## 模型連線

| 模型服務             | 需要設定                                | 連接方式                                   |
| -------------------- | --------------------------------------- | ------------------------------------------ |
| OpenAI               | 支援的模型 ID 與 OpenAI API key         | Pi 的 OpenAI provider                      |
| Anthropic            | 支援的模型 ID 與 Anthropic API key      | Pi 的 Anthropic provider                   |
| Ollama               | 本機回送 HTTP 網址與已安裝模型          | OpenAI 相容 Chat Completions               |
| 自訂 OpenAI 相容 API | Base URL、模型 ID；免驗證服務可不填金鑰 | 支援 SSE 串流與函式工具的 Chat Completions |

### OpenAI 與 Anthropic

在 **Bot 設定**選擇服務，從支援的建議清單挑選模型，填入 API key 並儲存。兩種服務的金鑰會分別保存。

設定狀態代表已提供設定值。「模型連線 → 測試模型」會以指定引擎實際驗證串流、工具呼叫與工具結果回傳；雲端模型可能計費。測試使用隔離狀態，不讀取工作區或已存知識。測試結果只代表該模型／引擎組合；修改設定會清除舊結果。

### 本機 Ollama

1. 啟動電腦上既有的 Ollama。
2. 在 Bot 設定選擇 **Ollama（本機）**。
3. 填入 `http://127.0.0.1:11434`，或你使用的本機 Ollama 連接埠。
4. 點選 **讀取已安裝模型**，選擇支援工具呼叫的模型並儲存。

Talaria 不會安裝 Ollama 或下載模型。此連接器只接受本機回送 HTTP 網址，讀取模型清單時會排除雲端模型，不需要 API key。目前已使用 `qwen3.5:9b` 進行本機整合測試。

Pi 連接器要求關閉思考模式，輸出上限為 2,048 tokens，上下文中繼資料為 8,192 tokens；實際上下文由 Ollama 控制。另兩套連接器輸出上限為 4,096 tokens，也透過 `reasoning_effort: none` 關閉 Ollama 思考模式。

### 自訂 OpenAI 相容 API

選擇 **OpenAI 相容 API（自訂）**，填入：

- **Base URL**：服務提供的完整 API 基底路徑，例如 `https://api.example.com/v1`、`https://gateway.example.com/api/v1` 或 `http://127.0.0.1:1234/v1`。
- **模型**：服務提供的完整模型 ID，可使用自訂名稱。
- **API key**：此端點的金鑰；只有不需要驗證的服務才可留空。

Talaria 會在網址後接上 `/chat/completions`，也能正規化直接貼上的完整 Chat Completions 網址。服務與模型必須支援 SSE 串流和函式工具呼叫；此連接器未實作僅提供 Responses 的服務或 Azure 專用協定。

自訂端點的金鑰獨立保存。同一網址下，金鑰留空會保留原值；更換網址卻未提供新金鑰時，會清除舊金鑰。免驗證服務會由 SDK 傳送不含機密的占位值。

連接器支援文字輸入，輸出上限為 4,096 tokens。上下文中繼資料為 32,768 tokens，不會更改伺服器實際的上下文大小。

### 設定與環境變數

儲存的設定會套用到下一次 Web 或 Telegram 任務；已在執行的任務保留開始時的設定。設定 API 不會回傳金鑰，密碼欄位也不會重新填入已儲存的金鑰。如需移除，請勾選移除金鑰選項後儲存。

UI 設定保存在 `.loom/settings.json`，優先於環境變數。移除金鑰也會停用環境變數中的備援值。介面不會修改 `.env`；手動修改環境變數後，需要重新啟動伺服器。

設定範例請參閱 [.env.example](.env.example)：

| 變數                                         | 用途                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| `PI_PROVIDER`                                | `openai`、`anthropic`、`ollama` 或 `openai-compatible` |
| `PI_MODEL`                                   | 模型 ID                                                |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`       | 官方模型服務的金鑰                                     |
| `OLLAMA_URL`                                 | 本機 Ollama 網址                                       |
| `COMPATIBLE_BASE_URL` / `COMPATIBLE_API_KEY` | 自訂 API 連線                                          |
| `PORT` / `SHARE_PORT`                        | 應用程式連接埠，預設 3100；分享代理連接埠，預設 3102   |

## Web 介面操作

- Talaria 名稱旁的 **＋** 用於開啟新話題。已保存的記憶與技能會保留，第一則訊息送出時才建立對話。
- 輸入框內的 **＋** 開啟任務選項；檔案、記憶、技能的寫入權限分別勾選，預設全部關閉。
- **Ctrl/Cmd + K** 可搜尋對話標題或快速前往功能；**對話紀錄**可展開已保存的清單。
- 桌機按 Enter 傳送、Shift+Enter 換行；手機按 Enter 換行，可使用傳送按鈕或 Ctrl/Cmd+Enter 送出。中文輸入法選字確認不會直接送出。
- 任務執行時可展開工具紀錄；停止按鈕可取消目前的本機任務。
- 回覆支援 Markdown、表格與程式碼區塊，複製程式碼會保留空白。對話選單的 **匯出 Markdown**可下載可見訊息。
- 草稿依對話儲存在目前瀏覽器。任務送出後遇到連線錯誤，先查看任務紀錄，不自動重新送出以免重複操作。
- 向上捲動時會保留閱讀位置；點選 **最新訊息**可繼續跟隨回覆。
- 寬螢幕桌機會在聊天旁開啟工作區，手機則使用抽屜面板。

回覆中的原始 HTML 不會執行。不安全的連結協定會被阻擋，引用的圖片也不會自動載入。

## Telegram

1. 透過 [Telegram BotFather](https://t.me/BotFather) 建立專用 Bot。
2. 在 **Bot 設定 → Telegram Bot** 填入 Token，啟用 Bot 並儲存。
3. 連線成功後產生配對碼，將畫面上的 `/pair …` 指令私訊給 Bot。配對碼十分鐘後失效，且只能使用一次。
4. 傳送任務後，可在 Web 歷史紀錄看到該對話、查看進度、停止任務或繼續聊天。

Bot 共用 Talaria 設定的模型、工作區、記憶與技能。也能透過對話選單中的 Telegram 續聊指令，在私訊中繼續 Web 對話。

支援的指令：`/help`、`/new`、`/stop`、`/status`，以及私訊中的 `/resume <conversation-id>`。

Telegram 使用對外長輪詢，不需要公開網址或 Tunnel。`npm run dev` 會一起啟動已啟用的 Bot 與 Web 服務。電腦與模型需持續運作。若 Bot 已設定 webhook 或有其他輪詢程序，介面會顯示衝突；Talaria 不會刪除其他應用程式的 webhook。

目前只支援一位已配對的擁有者，未配對使用者與不相關群組訊息會被忽略。解除配對或更換 Token 會移除帳號綁定，但不會刪除對話。Telegram 任務的寫入權限獨立設定，預設關閉。

群組功能需另外啟用。配對後，在目標群組送出 `/where@YourBotUsername`，再將取得的負數群組 ID 儲存到設定。只有擁有者在指定群組中的提及或回覆會觸發任務。回覆會送回群組與原本的主題，可能包含工作區資訊。各聊天或主題有獨立對話，但共用記憶與技能。

Telegram 目前只接收文字，並在任務完成後傳送純文字回覆，尚未支援語音、圖片或附件。系統會在執行前記錄已接收的更新位置，以避免當機後重複寫入；中斷任務與傳送失敗不會自動重試。已保存的結果仍可從 Web 歷史紀錄查看。

## 遠端預覽

一般開發使用 `npm run dev`。若需要遠端存取，請安裝 [Cloudflare 的 cloudflared 用戶端](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)，再執行：

```sh
npm run dev:share
```

Windows 也可將官方執行檔放在 `.tools/cloudflared.exe`，專案會自動偵測。此檔案不會提交至 Git，本機開發也不需要它。

指令會沿用既有的 Talaria 伺服器，或自行啟動一個，再建立密碼保護的代理與臨時 Cloudflare 網址。網址與隨機密碼會顯示在終端機，並保存在已被 Git 忽略的 `.loom/share-connection.json`。請勿將此檔案公開或提交。

遠端登入取得的是**完整擁有者權限**，包含模型設定、對話與任務執行。所有應用程式頁面與 API 都需要登入。登入狀態使用 HttpOnly、Secure、SameSite Cookie，八小時後過期，也可透過遠端登出結束。代理會檢查指定主機名稱、請求來源，並限制登入失敗次數。Web 以任務 ID 輪詢進度與回覆；舊版 NDJSON API 仍保留。

此功能使用 Talaria 的密碼驗證。固定網域與 Cloudflare Access 需要另外設定，不包含在此指令內。遠端流量會經過 Cloudflare，電腦需保持喚醒並連上網路。

按 Ctrl+C 可停止分享。原本就存在的開發伺服器會繼續執行；由分享指令啟動的伺服器則會一起停止。重新啟動分享會更換網址、密碼與所有登入狀態。

## 記憶、技能與本機資料

| 知識類型   | 目前行為                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| 長期記憶   | 每次任務將完整記憶項目加入系統上下文，總預算為 16,000 字元。                |
| 可重用技能 | 提供最多 50 筆索引，每筆取前 120 字元作為描述；需要時透過工具讀取完整步驟。 |
| 對話歷史   | 對已完成訊息進行不分大小寫的子字串搜尋，回傳最多十筆有長度限制的摘錄。      |

可用工具：`list_files`、`read_file`、`write_file`、`remember`、`update_memory`、`save_skill`、`list_skills`、`read_skill` 與 `search_history`。

模型會在取得對應權限後判斷是否保存知識。同範圍記憶會做正規化文字去重，依當次問題做詞彙相關性排序（包含中文字串配對），再套用 16,000 字元預算。這不是向量或語意去重。管理介面可編輯、停用、刪除或合併同範圍項目，查看最多 20 次內容修訂，並從 Agent 保存的來源返回對話。停用與已合併項目不會加入上下文。技能仍按需載入，沒有背景學習程序。

| 位置                  | 保存內容                                       |
| --------------------- | ---------------------------------------------- |
| `.loom/state.json`    | Agent 定義、對話設定快照、引擎狀態、記憶與技能 |
| `.loom/settings.json` | 模型設定與 API 金鑰                            |
| `.loom/telegram.json` | Bot Token、擁有者配對、對話綁定與更新位置      |
| `workspace/`          | Agent 檔案工具可存取的內容                     |

本機資料會在需要時建立，並已加入 Git 忽略清單。設定與 Token 以本機明文保存，設定 API 不會回傳機密值；支援的平台會以 0600 權限建立檔案。對話資料在單一伺服器程序內依序處理變更，並以原子替換方式寫入 JSON。

儲存格式目前是版本 1，載入與保存時會驗證結構。初次升級保留 `state.pre-v1.json`，後續每次寫入保留上一版 `state.json.bak`；資料格式錯誤時停止載入並保留原檔。每次任務另外保存於 `.loom/runs/<id>.json`，命名連線與金鑰位於 `.loom/connections.json`。Bot 設定可下載對話／Agent／知識備份，下載不包含連線金鑰與任務檔；完整備份請停止服務後複製 `.loom/` 與 `workspace/`。還原請停止服務、保留目前資料副本，再放回備份，沒有自動還原 UI。

目前保留單程序 JSON 儲存，避免增加啟動依賴；任務紀錄已獨立，串流不再每個 token 重寫對話資料。大型歷史與多程序仍適合日後遷移 SQLite；現在沒有宣稱完成 SQLite。更多細節見 [架構說明](docs/architecture.md)。

舊版 Hermes／hybrid 模式的對話會轉為 Pi 模式，保留 ID、訊息與 Pi 執行紀錄。已停用的 Gateway 設定會被忽略，並於下次儲存設定時從檔案移除。

## 目前範圍與限制

- 單一本機擁有者與單一 Telegram Bot，可建立多個 agent；尚未支援多使用者隔離或雲端電腦。
- 伺服器綁定 `127.0.0.1`，檢查 Host／Origin，修改 API 需要指定標頭，並使用限制性 Content Security Policy。遠端存取請使用具登入保護的分享代理。
- 檔案工具限於 `workspace/`，拒絕隱藏路徑、路徑穿越與符號連結，單檔內容上限為 256,000 bytes。不提供終端機執行，也不構成作業系統層級的沙箱。
- 每次任務上限為五分鐘。Pi 與 OpenAI SDK 為十二回合，Deep Agents 的圖執行遞迴上限為 48 步。重啟後，中斷任務標記失敗，不會自動恢復。
- Pi 與 OpenAI SDK 尚未自動壓縮對話；Deep Agents 使用框架摘要，依模型調整上下文預算仍待完善。
- JSON 儲存會載入完整狀態，每次變更也會重新寫入；同一資料目錄請只使用一個伺服器程序。
- 尚未實作排程、瀏覽器／電腦控制、MCP 管理或多媒體輸入。

## 已完成與後續方向

本輪已完成背景任務、工具操作紀錄、命名連線與能力測試、獨立寫入權限、記憶來源／修訂／合併／停用、Agent 導覽與範本，以及資料版本驗證與備份。

後續可再處理跨引擎 token 預算與摘要、向量檢索、大量歷史的索引與分頁，以及多使用者隔離。尚未加入自動恢復有副作用的任務或跨引擎工作流程。

## 開發與驗證

`npm run test:agents:ollama` 會以隔離暫存資料測試三套引擎的真實讀檔與續聊，接受 `OLLAMA_MODEL` 和 `OLLAMA_URL`。本機 Qwen 已透過三套引擎成功呼叫檔案工具，但真實測試也出現格式錯誤的工具呼叫、拒絕執行與錯稱沒有前文的回覆。可預期的 SDK 測試確認歷史有送出；不保證模型行為。測試會回報失敗，不會偷偷重試。

Agent 測試另涵蓋建立／編輯驗證、設定快照、封存保留、記憶與技能隔離，以及三套實際 SDK 的 HTTP 串流與續聊。

| 指令                   | 用途                                         |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | 型別檢查、監看前端建置，並在修改後重啟伺服器 |
| `npm start`            | 建置後啟動，不監看檔案                       |
| `npm run check`        | 嚴格 TypeScript 型別檢查                     |
| `npm run build`        | 型別檢查並將瀏覽器程式編譯至 `dist/public/`  |
| `npm test`             | 不呼叫付費 API 的自動化測試                  |
| `npm run test:ollama`  | 選用的真實本機模型整合測試                   |
| `npm run format:check` | 檢查專案格式                                 |
| `npm run dev:share`    | 啟動具密碼保護的選用遠端分享                 |

自動化測試使用實際 Pi SDK 與可預期的模型傳輸模擬，涵蓋自訂 API 串流與工具呼叫、記憶注入、歷史、權限、資料遷移、取消、設定、分享驗證，以及 Telegram 配對與傳送行為。Telegram 使用注入的測試傳輸層，不會操作真實帳號。

`npm run test:ollama` 需要正在執行的本機模型。它會使用隔離的暫存工作區驗證真實讀檔工具、串流與對話記憶，預設模型為 `qwen3.5:9b`，可透過 `OLLAMA_MODEL` 與 `OLLAMA_URL` 更改。不會使用既有 Talaria 資料或雲端金鑰。

[GitHub Actions 範本](docs/github-actions.yml.example) 包含 Windows／Linux 與 Node 22／24。這是尚未啟用的範本；如需啟用，請使用具備對應 GitHub 權限的憑證，將它複製到 `.github/workflows/ci.yml`。

### 程式碼結構

```text
public/                瀏覽器 TypeScript、HTML 與 CSS
server/agent.ts         Pi 執行整合與引擎分派
server/runtime.ts       引擎中立的任務／工具介面
server/tools.ts         共用工具與寫入權限
server/runs.ts          每個任務的持久化紀錄
server/connections.ts   命名連線與金鑰
server/probe.ts         隔離的模型能力測試
server/agents.ts        Agent 驗證與記憶／技能範圍
server/engines/         Deep Agents 與 OpenAI SDK 轉接層
server/context.ts      記憶與按需載入的技能上下文
server/tasks.ts        共用任務生命週期
server/app.ts          HTTP API 與串流
server/settings.ts     模型設定與金鑰
server/compatible.ts   自訂 Chat Completions 連接器
server/ollama.ts       本機 Ollama 連接器與模型探索
server/telegram.ts     Telegram 傳輸與擁有者配對
server/share-gateway.ts 具密碼保護的遠端代理
server/store.ts        本機狀態保存
server/workspace.ts    受限制的檔案操作
shared/                共用型別與對話匯出
scripts/               建置、開發、分享與真實模型驗證
test/                  Node 測試套件
```

新增工具時，在 `server/tools.ts` 的 `createTools()` 定義輸入結構與執行內容，並回傳結構化工具結果。修改資料的操作需套用既有寫入權限檢查。模型金鑰與外部整合應由伺服器處理。

## 上游專案

- [Pi](https://github.com/earendil-works/pi)：Agent 執行核心與模型抽象層。
- [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview)：以任務規劃為主的 JavaScript Agent 框架。
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)：TypeScript Agent 執行引擎。
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)：記憶與技能處理架構參考。

Talaria 是獨立專案，與上述上游專案沒有隸屬關係。
