# Talaria 的產品方向

## 已確認的方向

Talaria 是自己的 bot 產品。使用體驗參考使用者所說的「Grok bot」，底層架構借鏡 Hermes Agent，模型與工具執行沿用 Pi 的 Node.js runtime。

開發環境維持 TypeScript、Node.js 與 `npm run dev`。使用核心能力不應要求另外部署 Python Hermes 或提供 Hermes gateway。這是產品方向修正；下述目標尚未全部實作。

使用者已確認 Web 和通訊平台 bot 都要。第一個 adapter 選用 Telegram，支援配對後私訊，以及指定群組內的 @／回覆。未接入 X，也不要求使用 xAI 模型。

## 目標分工

- **入口**：Web UI 與後續確定的平台 adapter，把訊息送入同一個 Talaria 核心。
- **對話與任務管理**：識別使用者、對話與工作區，載入歷史，管理執行狀態、取消與結果回傳。
- **上下文組裝**：組合 Agent 身分、精簡的使用者偏好與專案記憶、技能索引及目前任務。完整技能在需要時讀取。
- **Pi runtime**：連接 Ollama 或雲端模型，執行模型選擇工具、取得結果、繼續處理直到回覆的循環。
- **工具與權限**：工具註冊與執行權限集中管理；各入口使用同一套規則。
- **持續記憶與技能**：保留有用事實與成功流程，支援查閱、更新與刪除；保存內容不構成新的操作授權。

Telegram 使用一次性配對碼綁定單一擁有者。只有配對帳號可使用工作區；群組預設關閉，需在 Web 指定群組 ID。Web 與 bot 共用該擁有者的記憶、技能、模型與歷史，但各 chat/topic 有獨立對話。這不是多租戶系統。

## 已實作

- 共用 TaskService 管理 Web／Telegram 任務、保存歷史、追蹤進度與取消。
- Telegram Token 設定、連線檢查、一次性配對、解除綁定、指定群組授權。
- /new、/stop、/status、/resume，以及 Web 中的 Telegram 對話同步、背景任務停止和續聊指令。
- 技能索引與按需讀取、持久記憶更新、跨 Web／bot 的歷史查找。
- 外部 Hermes 設定收進進階選項，舊模式與既有對話仍相容。
- 程序重啟後標記中斷任務，不自動重試有副作用的工作。

## 目前限制

第一版是單一擁有者、文字訊息的 Telegram adapter，完成後以純文字傳回結果；Web 保留 Markdown 與即時進度。沒有接 Discord、X、附件、語音、排程或自動背景學習。長對話尚無自動摘要壓縮。配對與 API 流程有模擬整合測試；真正 Telegram 帳號的端到端驗證仍需要使用者在 Web 填入自己的 Bot Token。

## 架構參考

- [Hermes Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture/)：入口、Agent loop、工具分派、對話保存與平台 adapter 的分工。
- [Hermes Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)：持久記憶、使用者資訊與歷史對話查找。
- [Hermes Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)：先讀技能索引，按需取得完整流程。

Talaria 將用 Node.js／TypeScript 實作適合自身產品的能力；上述參考不表示與 Hermes 的工具、檔案格式或 runtime 完全相容。
