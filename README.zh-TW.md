# Apsis

[English](README.md)

Apsis 是使用 TypeScript 與 Node.js 的本機 Bot 工作空間。Bot 使用 **Deep Agents** 搭配 API／Ollama 模型。每位 Bot 有自己的角色、模型、持續對話、私有記憶、排程、瀏覽器分頁與成果。Bot 可以查找其他 Bot 並派工；Apsis 管理任務佇列、核准、資料保存與跨 Bot 協作。

## 啟動

需要 Node.js 22.19 以上。

```sh
npm ci
npm run dev
```

開啟 <http://localhost:3100>，在「設定與工具 → 模型連線」加入 OpenAI、Anthropic、Ollama 或 OpenAI 相容端點，測試串流與工具呼叫，再建立 Bot。金鑰只儲存在伺服器的 `.apsis/connections.json`。

Codex 連線與 ChatGPT 登入執行路徑已退役。既有 Codex Bot 保留歷史與檔案，但必須先明確選擇支援的模型才能再執行；其排程會停用，選好模型後需自行重新啟用。Apsis 不會自動改用需付費的 API 模型，也不會解除安裝 Codex 或移除其本機憑證。

本機 Ollama 可使用 `http://127.0.0.1:11434` 與已安裝的模型 ID，例如 `qwen3.5:9b`。Ollama 服務必須先啟動。複雜的規劃與派工建議使用工具能力較穩定的大型模型。

## 架構

```text
Web／已配對的 Telegram
        ↓
Bot 設定與持久任務佇列（ProductService）
        ↓
TaskService → Deep Agents → 所選模型
        ↓
Apsis 工具：工作區、記憶、技能、瀏覽器、文件、MCP、排程
        ↓
核准與工具操作紀錄
```

Deep Agents 是唯一啟用的執行引擎，負責單一 Bot 內部的規劃、上下文管理與虛擬暫存檔；原生 `task`、`execute` 工具已停用。Apsis 負責 Bot 身分、跨 Bot 派工、權限、排程與成果。`delegate_task` 與每次排程使用接收 Bot 的獨立工作 context；聊天則持續沿用目前 context，按「新任務」才切換。

Deep Agents 的虛擬檔案只供對話暫存；真實檔案使用 `.apsis/workspace/` 的 `workspace_*` 工具。工具核准採 Kimi 式確定性規則，不呼叫 LLM 審查。預設「需要時詢問」（yolo）會自動執行一般 Shell、網頁與 MCP 操作；命中較前面的危險、敏感路徑或權限策略才詢問，另提供 manual 與 auto 模式。Shell 在主機執行；工作區與路徑規則都不是作業系統沙箱。

完整歷史保存於 SQLite，提供分頁與搜尋；模型輸入使用 checkpoint、自動摘要與核心／參考記憶控制容量。Context 上限未填寫時預設為 256K（262,144 tokens），可手動調整。詳見[長期對話與記憶管理](docs/conversation-context.md)。

## 設定與範本

設定會保存執行限制及 `zh-Hant`／`en` 語言偏好。預設為 100 個 Agent 步驟、30 分鐘有效執行時間、每次 Shell 60 秒、24,000 字元的證據輸出上限、3 層派工、12 個派工工作，以及每個根任務 4 個同時執行名額。新任務會取得限制快照，子任務沿用；儲存設定時以修訂版本檢查避免覆蓋其他修改。

Bot 可選取共用技能與 MCP 連接器，並使用工作區或唯讀模式。唯讀與明確禁止不能被自動核准覆蓋。派工及其建立的排程會保留上游限制；本次任務已記住的核准先於一般詢問規則，但不能略過危險命令確認。新任務不繼承舊授權。Windows 使用 Git Bash（需安裝 Git for Windows），Linux 使用系統 Bash；可用 `APSIS_SHELL_PATH` 指定執行檔，缺少 Bash 時其他工具仍可使用。詳見 [核准模式與 Bash](docs/approval-modes.md)。

範本將角色、圖示、模型、技能／連接器選擇及權限複製至新 Bot，不複製憑證、對話、記憶或執行狀態；修改範本不影響既有 Bot。語言偏好用於已提供翻譯的介面文字，不翻譯訊息與工具證據，也不代表所有介面都已完成翻譯。

資料保存在 `.apsis/`：SQLite 存放 Bot、任務、核准、排程與事件；經驗證的 JSON 存放對話與知識；執行日誌另存。重啟後未完成任務標為中斷，不會自動重播外部操作。完整備份請先停止程式，再複製 `.apsis/`。

操作細節見 [Bot 工作空間](docs/bot-workspace.md)，設定與遷移細節見 [設定平台](docs/settings-platform.md)，程式分工見 [架構說明](docs/architecture.md)。

## 驗證

```sh
npm run build
npm test
npm run test:bots:browser
node scripts/verify-settings.ts
```

瀏覽器測試使用隔離資料與可重現的模型替身。設定驗證腳本需在 build 後執行，報告與截圖輸出至 `artifacts/settings-verification/`；這些檢查不代表真實供應商憑證或完整翻譯已通過驗證。`npm run test:bots:ollama` 可選擇實測本機模型派工；實際模型行為可能不同。
