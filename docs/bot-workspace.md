# Apsis Bot 工作空間

目前 `npm run dev` 預設啟動新的 Bot 介面。目標是沿用 Grok Bot 的持續對話操作方式，讓模型可替換成自己的第三方 LLM API。

## 啟動

需要 Node.js 22.19 以上。

```sh
npm ci
npm run dev
```

開啟 http://localhost:3100。到「設定與工具 → 模型連線」新增 OpenAI 相容 API、OpenAI、Anthropic 或 Ollama，填入模型 ID，設為預設。使用「測試」確認供應商的串流和工具呼叫。API key 儲存在本機，不回傳到前端。

本機 Ollama 可填入 `http://127.0.0.1:11434` 和已安裝的模型 ID（例如 `qwen3.5:9b`）。同一模型也可用「OpenAI 相容」服務測試，Base URL 改為 `http://127.0.0.1:11434/v1`；此本機端點不需 API key。這是兩條獨立連線，設定其中一條為預設即可。

瀏覽器工具優先使用 Playwright 的 Chromium；Windows 未安裝時會尋找已安裝的 Chrome／Edge，使用 Apsis 專屬資料夾，不使用你的日常瀏覽器設定。其他環境請先執行：

```sh
npx playwright install chromium
```

也可以設定 `APSIS_BROWSER_PATH` 指向瀏覽器執行檔。

## 主要操作

1. **新增 Bot**：先在表單選擇六款圖示之一，填寫名稱與角色指令，並指定模型或跟隨預設；建立後進入持續對話。點聊天頂端的名稱或詳情中的「自訂 Bot」可再次編輯。
2. **交辦工作**：Enter 傳送、Shift + Enter 換行。執行中可按「補充指示」，在工具邊界送入目前任務；一般傳送會排入下一個任務。停止會取消目前任務與待執行佇列。
3. **回覆訊息**：引用指定訊息，引用與後續任務永久保存；點擊引用可回到原訊息。
4. **模型**：Bot 預設跟隨全域預設模型，也可在個人檔案指定自己的模型。更換不會刪除對話；下一個任務使用新設定。
5. **右側詳情**：電腦預覽、排程、附件／成果、私有記憶和實際工具操作紀錄。Bot 可釘選或隱藏，隱藏不會停用排程。
6. **技能與連接器**：`/` 選共用技能，`@` 選已連接的 MCP 服務。

在「自訂 Bot」表單下方按「刪除 Bot」並確認，會停止任務，移除對話、專屬記憶與技能、排程、草稿、核准規則及附件／成果清單，並關閉該 Bot 的瀏覽器分頁。工作區實體檔案、執行日誌與既有備份保留；外部操作不會撤銷。刪除無法從介面復原，外部草稿正在傳送時需等待完成後重試。

## 工具、附件和成果

- 共用工作區：`.apsis/workspace/`。可列檔、讀取、精準修改、寫入及使用本機 PowerShell／Bash。
- 自動允許工作區內的讀寫、Bot 私有記憶與技能操作。Shell、MCP 呼叫和瀏覽器 click/fill/press 會先停在核准卡片。
- 核准可只允許一次，或儲存「這位 Bot、這個工具、完全相同參數」的規則；可在設定撤銷。
- Shell 在主機執行，工作區不是作業系統沙箱。核准卡片顯示實際命令。單次命令上限 120 秒，任務上限 100 回合／30 分鐘有效執行時間；等待核准不計入時間。
- 支援上傳 TXT、MD、CSV、PDF、DOCX、XLSX、PNG、JPEG，每個檔案最多 20 MB。PDF 讀取文字層，沒有 OCR；圖片需要模型支援視覺。
- 可讀取文件，產生 DOCX、XLSX、PDF，或發布已寫入的程式碼／Markdown 等檔案。成果保存獨立快照，後續修改原始檔不影響已發布成果。
- MCP 支援 **Streamable HTTP + 選用 Bearer token**。「測試並加入」會驗證初始化及工具清單。Bot 可準備操作草稿，由使用者修改 JSON 參數後傳送或捨棄。傳送結果不明時不自動重試。
- 瀏覽器共用持久登入狀態，每位 Bot 有自己的分頁。先停止執行中的任務，再按「接管瀏覽器」，開啟本機專用視窗；交還後恢復自動操作。接管切換會重新載入分頁，網頁未提交的暫存內容可能不保留。

## 排程與 Telegram

可從聊天請 Bot 建立排程，或在詳情手動設定名稱、內容、Cron 與 IANA 時區。支援暫停、修改、立即試跑與執行紀錄。Apsis 需持續執行；錯過多次排程時補執行一次，避免重複批量操作。

在設定輸入專用 Telegram Bot token、啟用並產生配對碼，再從自己的私訊執行配對指令。指令：

- `/bots`：列出 Bots。
- `/bot ID`：切換到指定 Bot 的同一段 Web 對話。
- `/steer 內容`：補充目前任務。
- `/stop`：停止工作。
- `/status`：目前狀態。
- `/approve ID`、`/deny ID`：處理核准要求。

完成與需要核准時會通知已配對的擁有者。Telegram 的附件上傳／成果檔案傳送尚未接入；目前從 Web 取用檔案。群組與多 Bot 交接不在新版核心流程內。

## 資料與恢復

- 新資料完全放在 `.apsis/`；舊 `.loom/` 和 `workspace/` 保留不動。
- Bot、佇列、核准、草稿、排程、成果索引及事件使用 SQLite（WAL）；對話與知識沿用經驗證的原子 JSON 儲存，執行日誌另外保存。憑證僅存在本機資料目錄。
- 瀏覽器重新整理透過 SSE 重新訂閱並讀取最新狀態，不會中止伺服器任務。
- 服務重啟後，執行中／排隊中的工作標為中斷，核准過期，傳送中的草稿標為結果待確認；不自動重播可能有副作用的操作。
- 舊介面與舊資料可用 `npm run dev:legacy` 開啟（先關閉使用同一連接埠的新版）。舊文件中的「任務權限」等說明適用於這個入口。

## 驗證

```sh
npm run build
npm test
npm run test:bots:browser
```

瀏覽器整合測試使用隔離資料目錄及可重現的模型替身；實際操作頁面、瀏覽器、檔案、Shell 核准、下載、排程、PDF 和手機版。截圖存入 `artifacts/bot-verification/`。第三方模型與 Telegram 的真實帳號仍需用自己的連線測試確認。

目前新版介面為繁體中文，支援淺色與深色模式，可從側邊欄下方切換，並記住選擇。手機版使用側邊抽屜；設定與排程視窗支援鍵盤焦點切換及 Escape 關閉。尚未包含原生桌面操作、語音、多使用者、MCP OAuth／stdio，以及跨 Bot 工作交接。

## 對照依據

操作設計依據 xAI 的 [Bots](https://docs.x.ai/grok-bot/bots)、[聊天與協作](https://docs.x.ai/grok-bot/chat-and-collaboration)、[電腦](https://docs.x.ai/grok-bot/computer-and-apps)、[成果](https://docs.x.ai/grok-bot/files-and-results)、[排程](https://docs.x.ai/grok-bot/skills-routines-and-automations) 與 [核准](https://docs.x.ai/grok-bot/approvals-security-and-privacy) 說明。Apsis 是獨立的本機產品，不是 xAI 的官方客戶端。
