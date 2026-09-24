# Apsis

[English](README.md)

Apsis 是使用 TypeScript 與 Node.js 的本機 Bot 工作空間。Bot 可選 **Deep Agents** 搭配 API／Ollama 模型，或使用 ChatGPT 登入的 **Codex**。每位 Bot 有自己的角色、模型、持續對話、私有記憶、排程、瀏覽器分頁與成果。Bot 可以查找其他 Bot 並派工；Apsis 管理任務佇列、核准、資料保存與跨 Bot 協作。

## 啟動

需要 Node.js 22.19 以上。

```sh
npm ci
npm run dev
```

開啟 <http://localhost:3100>，在「設定與工具 → 模型連線」加入 OpenAI、Anthropic、Ollama 或 OpenAI 相容端點，測試串流與工具呼叫，再建立 Bot。金鑰只儲存在伺服器的 `.apsis/connections.json`。

若要使用 ChatGPT 的 Codex 額度，先安裝 Codex CLI，在「模型連線」按「登入 ChatGPT」並完成瀏覽器登入，再儲存「ChatGPT Codex」模型連線。這條路徑不需要 OpenAI API key。Codex 在本機執行，透過短效的本機 MCP 橋接呼叫 Apsis Bot 工具；Apsis 不讀取或儲存 ChatGPT token。連線測試確認登入與模型可用；派工測試應檢查實際的 `list_bots`、`delegate_task` 操作及接收 Bot 的完成紀錄。

本機 Ollama 可使用 `http://127.0.0.1:11434` 與已安裝的模型 ID，例如 `qwen3.5:9b`。Ollama 服務必須先啟動。複雜的規劃與派工建議使用工具能力較穩定的大型模型。

## 架構

```text
Web／已配對的 Telegram
        ↓
Bot 設定與持久任務佇列（ProductService）
        ↓
TaskService → Deep Agents 或 Codex App Server → 所選模型
        ↓
Apsis 工具：工作區、記憶、技能、瀏覽器、文件、MCP、排程
        ↓
核准與工具操作紀錄
```

Deep Agents 負責**單一 Bot 內部**的規劃、上下文管理、虛擬暫存檔和子 Agent；Apsis 負責 Bot 身分、跨 Bot 派工、權限、排程與成果。`delegate_task` 會在接收方自己的對話中執行，並把該次結果交回派工方。

Deep Agents 的虛擬檔案只供對話暫存；真實檔案使用 `.apsis/workspace/` 的 `workspace_*` 工具。Shell 在擁有者核准後於主機執行，工作區不是作業系統沙箱。修改網頁與 MCP 呼叫也需要核准。

資料保存在 `.apsis/`：SQLite 存放 Bot、任務、核准、排程與事件；經驗證的 JSON 存放對話與知識；執行日誌另存。重啟後未完成任務標為中斷，不會自動重播外部操作。完整備份請先停止程式，再複製 `.apsis/`。

操作細節見 [Bot 工作空間](docs/bot-workspace.md)，程式分工見 [架構說明](docs/architecture.md)。

## 驗證

```sh
npm run build
npm test
npm run test:bots:browser
```

瀏覽器測試使用隔離資料與可重現的模型替身。`npm run test:bots:ollama` 可選擇實測本機模型派工；實際模型行為可能不同。
完成本機 ChatGPT 登入後，可執行 `npm run test:bots:codex`，以隔離 Bot 資料檢查 Codex 的兩次派工工具呼叫與子任務結果。
