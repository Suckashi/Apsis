# Talaria 的產品方向

## 已確認的方向

Talaria 是自己的 bot 產品。使用體驗參考使用者所說的「Grok bot」，底層架構借鏡 Hermes Agent，模型與工具執行沿用 Pi 的 Node.js runtime。

開發環境維持 TypeScript、Node.js 與 `npm run dev`。使用核心能力不應要求另外部署 Python Hermes 或提供 Hermes gateway。這是產品方向修正；下述目標尚未全部實作。

「Grok bot」具體指 Web 對話、通訊平台私訊／提及，或 X 貼文串回覆，仍待使用者確認。不得因此假定要接 xAI 模型、建立 X bot，或開始對外發布訊息。

## 目標分工

- **入口**：Web UI 與後續確定的平台 adapter，把訊息送入同一個 Talaria 核心。
- **對話與任務管理**：識別使用者、對話與工作區，載入歷史，管理執行狀態、取消與結果回傳。
- **上下文組裝**：組合 Agent 身分、精簡的使用者偏好與專案記憶、技能索引及目前任務。完整技能在需要時讀取。
- **Pi runtime**：連接 Ollama 或雲端模型，執行模型選擇工具、取得結果、繼續處理直到回覆的循環。
- **工具與權限**：工具註冊與執行權限集中管理；各入口使用同一套規則。
- **持續記憶與技能**：保留有用事實與成功流程，支援查閱、更新與刪除；保存內容不構成新的操作授權。

如果後續接通訊平台，需要先設計使用者配對與資料隔離。現有分享密碼提供的是同一個擁有者工作區，不能直接當成多使用者 bot 的身分系統。

## 現有版本與差距

| 部分       | 現有版本                           | 調整方向                           |
| ---------- | ---------------------------------- | ---------------------------------- |
| Agent 執行 | Pi 已能使用本機工具並串流回覆      | 作為 Talaria 的執行核心            |
| 記憶       | 本機保存，截取文字後全部注入上下文 | 精簡偏好／專案事實，提供查找與更新 |
| 技能       | 本機保存，截取文字後全部注入上下文 | 索引與完整內容分離，按需讀取       |
| 對話       | 保存歷史與 Pi transcript           | 抽出共用對話管理，後續入口可重用   |
| Hermes     | 外部 HTTP connector，UI 有獨立模式 | 架構參考不應表現成必填的外部服務   |
| 入口       | Web UI                             | 依使用者確認的 bot 模式擴充        |

現有 Hermes connector 是先前解讀所產生的整合功能，不代表已移植 Hermes 的內部架構。後續調整需保留既有對話、模型設定、Markdown 顯示與 Cloudflare 分享功能；舊模式與 connector 的相容處理應在實作時明確決定。

## 架構參考

- [Hermes Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture/)：入口、Agent loop、工具分派、對話保存與平台 adapter 的分工。
- [Hermes Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)：持久記憶、使用者資訊與歷史對話查找。
- [Hermes Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)：先讀技能索引，按需取得完整流程。

Talaria 將用 Node.js／TypeScript 實作適合自身產品的能力；上述參考不表示與 Hermes 的工具、檔案格式或 runtime 完全相容。
