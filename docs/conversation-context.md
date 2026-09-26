# 長期對話、Context 與記憶

Apsis 保留 Deep Agents 1.14.0 的執行迴圈；對話生命週期、持久化、預算與記憶由 Apsis 管理。

## 使用行為

- Bot 聊天持續使用 active context。按「新任務」建立空白工作狀態，session ID、歷史、Bot 設定、長期記憶與檔案保留。
- 有執行中、排隊或待核准的工作時，建立新任務回傳 HTTP 409。
- 「重新交辦」會保留原 context 與繼承權限，仍須由使用者送出；不自動重播操作。
- Job 入隊即固定 context；每次排程（含手動測試）與派工有自己的 context，不修改聊天的 active context。
- 舊任務只能瀏覽、搜尋、引用；引用由後端按訊息 ID 查詢，只有被引用的內容加入新任務。
- 聊天初始讀取最新 50 則，向上分頁。詳情的記憶區提供歷史搜尋、舊任務、用量、壓縮紀錄與記憶編輯。

## 資料位置

| 資料                                                                            | 位置                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------ |
| Session metadata、工作 contexts、可見訊息、模型／工具訊息、checkpoint、壓縮紀錄 | `conversations.sqlite`，WAL、外鍵、版本化 schema |
| 核心與參考記憶、Bot agent 定義、技能、專案                                      | `state.json`，schemaVersion 3；不再包含對話訊息  |
| 私有 scratch、大型工具輸出、分 run 的歷史卸載                                   | `context-files/<session hash>/<context hash>/`   |
| 外部操作證據、執行狀態                                                          | 原有 `runs/` 與 `product.sqlite`                 |

SQLite 訊息有穩定 ID 與排序 sequence。一般 Store 僅快取每個 session 最新一頁；執行讀取指定 context 的 checkpoint，不從完整歷史重建輸入。FTS5 使用 trigram；兩字查詢使用限制在授權 session 範圍的子字串查詢。搜尋每頁最多 20 筆，前後文最多 11 筆。

Scratch 與真實 workspace 分開。Deep Agents 的虛擬檔案工具只操作 scratch；真實檔案走 `workspace_*` 與既有權限流程。Scratch adapter 拒絕 traversal 與符號連結。`read_scratch_part` 可分段讀取長行或大型 JSON，避免再次把完整結果塞入 context。

## 遷移與備份

首次啟動先備份 v2 state 至 `state-before-conversations-<hash>.json`，再匯入 session、訊息、engine state、虛擬檔案。每個舊 session 有初始 context；原有 Bot/session/message/run ID 保留。舊記憶預設為 reference、revision 1。

匯入標記只在檢查訊息筆數、內容與 scratch 成功後寫入；中斷可重試，既有不同內容的 scratch 不覆蓋。失敗保留原始資料並停止啟動。已使用 schema 3 卻找不到對話資料庫時也停止啟動。舊資料缺少的時間與工具證據不補造。

`GET /api/storage/backup` 輸出版本化串流 JSON，包含 metadata、記憶、SQLite 歷史／checkpoint／摘要與 scratch 內容（base64）。資料庫部分使用讀取快照；運行中的檔案可能繼續改變，因此這是邏輯匯出，不是完整離線還原映像。完整備份仍須停止程式後複製整個資料目錄，包括 `product.sqlite`、`runs/`、連線設定與 workspace。

第一版不自動刪除歷史；刪除 Bot 會清理其對話資料與 scratch。

## 模型預算與 checkpoint

模型設定增加 `contextWindowTokens`，保留 `maxOutputTokens`。所有供應商與模型未填寫 context 上限時，預設使用 256K（262,144 tokens）；手動設定優先。介面與 API 區分預設及手動來源，清空欄位會恢復預設值。

- 輸入預算 = window − output reserve − max(1,024, window × 5%)。
- 約使用 80% 輸入預算時壓縮；近期保留約 20%、最多 12,000 tokens，保留工具配對及最新輸入。
- 系統指令、工具 schema、記憶與訊息都計入；多語言估計搭配供應商 usage 校正，用量明確區分估計與實際回報。
- 最新使用者輸入不靜默截斷。固定指令或單筆輸入放不下時回報原因。
- 更換小模型造成摘要來源過大時，使用同模型／連線逐段彙整全部來源，不裁掉來源前段。
- Context overflow 在同一步最多重試一次；摘要失敗或再度 overflow 不覆蓋有效 checkpoint。

同名 `SummarizationMiddleware` 替換預設 middleware，避免雙重壓縮。摘要包含目標、最新修正、限制、決策、完成／未完成事項與證據位置。摘要呼叫使用 metadata 標記，串流不把內部摘要當成正式回答。

版本 1 checkpoint 只保存正規化的摘要＋近期訊息、todos 與引擎版本，不保存舊 cutoff。還原時不再套用先前 cutoff。完整工具往返及有效最終回答後保存安全 checkpoint；中途失敗保留原始模型／工具紀錄、scratch 與操作證據，不自動重播外部操作。

## 記憶

沿用 private/shared scope。核心每範圍最多 6,000 字元，reference 放較少使用的事實；兩層各最多 1,600 tokens 且不超過輸入預算 15%。未載入的核心條目 ID 可在用量區查看。

`remember` 去重；`update_memory` 使用建立工具時的 revision；`manage_memory` 支援分類、更新、合併、停用及明確 revision。全部走既有 memory permission、policy 與 operation journal。手動編輯過或鎖定的記憶不能由 agent 覆寫；修改在下次模型輸入組裝生效，不增加每輪背景萃取呼叫。

## API

以下路徑都在 `/api/v2/bots/:botId` 下：

| 路徑                                             | 行為                                 |
| ------------------------------------------------ | ------------------------------------ |
| `GET /history?before=<sequence>&context=<id>`    | 最新／較早可見訊息頁，含 olderCursor |
| `GET /history/search?q=<text>&before=<sequence>` | 限定 Bot 的歷史搜尋                  |
| `GET /history/around?sequence=<sequence>`        | 限定 Bot 的前後文                    |
| `GET /contexts?beforeId=<id>`                    | 工作 context 清單，每頁 50 筆        |
| `POST /contexts`                                 | 建立新互動 context；忙碌時 409       |
| `GET /context`                                   | Active context、用量、最近壓縮紀錄   |
| `GET /memories`                                  | 該 Bot 記憶範圍的條目                |
| `POST /memories`                                 | 新增或帶 id/revision 編輯；衝突 409  |

## 驗證

`npm test` 包含可重現 HTTP 模型替身，實際呼叫 Deep Agents middleware。新增測試涵蓋三次壓縮、重啟、steering、todo 保留、摘要串流隔離、overflow 一次重試、摘要失敗、超大輸入、工具卸載與取消、8K/32K/128K 預算、未知模型、縮小模型、10,000 則歷史、遷移重試、中文／英文搜尋、scope、記憶修訂／容量及工作 context 隔離。

瀏覽器流程：`npm run test:bots:browser`、`npm run test:settings:browser`、`npm run test:context:browser`。最後一項專門驗證最新 50 則、向上分頁、新任務、核心記憶與鎖定、中文搜尋、跨 context 引用及行動版。

真實模型抽驗使用手動設定容量，未填寫時使用 256K 預設值；模型替身通過不代表已完成真實供應商驗證。

真實模型測試指令：`npm run test:context:model -- <connectionId> <modelId>`；省略參數會使用預設模型。測試使用暫存資料目錄，不修改既有對話；會產生三次壓縮及重啟，檢查專案識別碼與未完成工作，並使用供應商的正常 token 額度。
