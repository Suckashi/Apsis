# 聊天中的程式工作

Apsis 只有 Bot 持續聊天。一般問題、文件、規劃與程式修改共用訊息入口，不再建立 CodingTask、獨立 session、任務頁籤或計畫版本流程。

## 操作

- Bot 選單 → 聊天選項：模型、核准模式、工作資料夾。未設定時使用自動資料夾。
- 使用既有 Git repository 時可直接選資料夾，或勾選隔離 Git 工作區。隔離模式預設取目前分支，未提交修改須選擇帶入或排除；不改動來源 checkout。
- 送出後固定工作位置，變更位置請先完成／停止，再選「開啟新話題」。歷史聊天保留，以分隔線標示新話題。
- 「先規劃」直接用訊息提出；計畫就是 Bot 回覆，回覆確認後接著做。
- 工作中直接傳訊息補充，狀態為已收到、已採用或未採用。停止或結束前未採用的訊息不自動重播，可重新傳送。
- 檔案側面板提供預覽、下載與引用；變更面板顯示目前話題 Git 起始 commit 的差異、網頁驗證紀錄及 PR 連結。
- verify_web 在目前工作資料夾執行，證據歸屬 context。track_pull_request 驗證真實 PR URL，最多跟進三次；切換新話題後不再自動跟進舊話題。
- `verify_web` 的 `expect_hidden` 檢查元素已隱藏或移除；`expect_checked` 檢查 checkbox／radio 已勾選，`value: "false"` 則檢查未勾選。可在同一次檢查中 `reload` 後再次斷言，驗證保存狀態。錯誤回報指明失敗步驟；重試限制依同一路徑、失敗類別與實際步驟計數，成功執行相同檢查才清除其失敗次數。`expect_style` 比對瀏覽器的計算後 CSS 值，尺寸可能是像素而非原樣式中的百分比。
- Shell 分別解碼標準輸出與錯誤輸出的 UTF-8 位元組，避免跨區塊的中文字破損；Python 的管線輸出固定為 UTF-8。若程式自行輸出其他編碼，須由指令先轉成 UTF-8。
- 排程仍使用獨立背景。指定專案的排程每次建立隔離 worktree，結果回到 Bot 聊天。跨 Bot 派工保留權限限制與獨立背景。

## 介面與資料

POST /api/v2/bots/:id/messages 為唯一前端傳送入口，後端選擇一般執行或補充，並以 requestId 去重。附件、檔案引用及目前 context 都在後端驗證。錯過當前回合但尚未接收的訊息接續為下一輪；已持久化卻未採用的補充明確保留未採用狀態。

GET /api/v2/bots/:id/changes?context=<id>&path=<relative-path> 與 verification?context=<id> 查閱該 Bot 的修改與驗證。Git metadata 及 PR 保存在 WorkContext，Job 與 Run 僅為內部執行與證據紀錄。舊 /coding-tasks 路由已移除。

## 資料格式

本版只接受 schema 4，不保留獨立程式任務的型別、執行器或遷移流程。
預設啟動使用 `.apsis-v4/`，原本 `.apsis/` 不讀取也不修改。
若以 `APSIS_DATA_DIR` 指定不支援的舊資料目錄，仍會停止啟動並保留原檔。

## 驗證

npm run check、npm test、npm run test:chat:browser。新瀏覽器流程以模型替身驗證補充採用、重新整理、草稿、檔案、新話題、桌面和手機；真實模型行為需另行實測。
