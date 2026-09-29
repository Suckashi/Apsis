# Bot 研發工作台

2026-09-29：依使用者「Ok 你先照這版下去實作吧，先去開發出來」開始正式實作。設計來源為 `product-direction-consensus.md` 和 `product-ui-proposal.md`；原型仍是獨立示例，不能當作正式執行資料。

## 使用方式

1. 開啟正式產品 `http://127.0.0.1:3100`，設定可用模型。首次安裝預建一位 Apsis；左上角「＋」仍可建立多位 Bot，既有 Bots／對話／48 款頭像與收藏保留。
2. 在左側「專案」的「＋」加入已有本機 Git repository 的根目錄。程式不另 clone，不改來源 checkout。沒有 Git 專案時可一般聊天或建立獨立 Plan 任務。
3. 在 Bot 輸入區選專案、起始分支及一般／Plan 模式，送出交辦。來源有未提交修改時，明確選擇帶入或從提交開始。每次交辦建立獨立任務、context 和 worktree；同一 Bot 可平行執行。
4. 交辦成功立即開啟新任務；左側 Bot 下保留可收合的任務清單。「查看變更」顯示實際 Git Diff。頁籤與目前選取任務會在重新整理後恢復，關閉頁籤只關閉檢視。執行中的補充可選「補充目前工作」（下一個模型邊界採用）或「排入下一項」；立即補充顯示待採用／已採用／未採用，排隊補充遇到重啟會保留原文與單次重送入口。
5. 右欄只有「檔案｜變更」；Git 分支圖／提交收在變更內展開，執行與驗證紀錄在對話裡展開。桌面左右 Diff、手機行內 Diff；可選取程式碼引用請 Bot 改。一般檔案提供閱讀／預覽／下載，不加入一般程式編輯器。HTML／HTM 預設呈現網頁，與 Markdown 一樣可切換「預覽／原始碼」、展開與重新整理；PDF／圖片／Office 抽取沿用既有預覽。
6. Plan 先在對話顯示計畫卡；點「編輯計畫」才打開臨時文件，可編輯、儲存版本，再按「開始實作」。版本不一致回傳 409，保留本機草稿。Plan 的寫檔、Shell、派工與外部操作由後端拒絕。切換任務保留訊息、計畫草稿和面板位置。
7. 任務標題下可切換分支或建立分支。有未提交修改、執行中、待核准或已連結 PR 時，阻止不安全切換並說明原因；不 stash／reset／強制搶用其他 worktree 的分支。
8. Skills 透過輸入框 `/` 搜尋選用，沒有獨立 Skills 設定頁。既有 Skill 檔案、Bot 自動選用與使用者自訂 workflow 保留。
9. 從 Bot 標題「⋯ → 排程」選專案、固定分支與時間。主機恢復後補一次，不逐次補跑。相同排程仍在執行或已有未結束 PR 時沿用工作紀錄，不另開修復任務。
10. 點 Bot 頭像或名稱開啟設定；「⋯ → 記憶與背景」查既有任務背景／引用歷史。專案頁「專案設定」管理說明與分範圍記憶，版本衝突保留草稿。
11. 設定中的任務通知可自行開啟；頁面在背景時只通知交付、計畫待確認、阻礙、完成。沒有全域總覽或待處理頁；Bot 狀態標籤區分未讀、待確認和執行中。讀取回覆不會清除 Review／確認狀態。

## 執行與保存

HTML 預覽支援內嵌樣式／腳本、同一工作資料夾內以相對路徑引用的 CSS、JavaScript（含 ES modules）、圖片與字型，以及 HTTPS 外部資源。內容在隔離 iframe 中執行，不能存取 Apsis 主頁、儲存資料、提交表單或呼叫 API；需要後端 API、開發伺服器或根路徑資源（如 `/assets/app.js`）的應用仍應以該專案的伺服器開啟。HTML 主檔沿用 1 MiB 文字預覽上限，個別資源上限 20 MB。分享入口保留登入驗證，隔離預覽資源僅沿用已登入工作階段開啟的預覽授權，登出／到期後失效。

- `CodingTask` 保存 Bot、獨立 execution session、context、固定 location、專案、起始 commit、工作分支、PR 目標及計畫版本。`Job.taskId/executionSessionId` 決定執行歸屬；主 Bot session 不注入其他任務的背景。
- 新 worktree 在平台使用者資料目錄的 `Apsis/worktrees/<dataDir-hash>/<taskId>`（Windows 為 `%LOCALAPPDATA%`）；可用 `APSIS_WORKTREE_ROOT` 指定獨立根目錄。禁止放在 Apsis 或其他 package.json 範圍內，避免無 package.json 的獨立專案繼承宿主設定。既有任務保留原 path，不自動搬移。只接續目前檢出的變更時才複製 dirty patch／未追蹤檔案；來源分支與檔案不改動。建立失敗保留可復原目錄。已完成 worktree 不自動刪除，清理政策另定。
- worktree 遺失時回報原位置不可存取，不在同名位置重新建立空資料夾。重啟將中斷任務標為需處理，保留原路徑與 context，可在原任務補充指示接續。
- 附件複製到任務相對路徑；成果沿用不可變下載快照。任務詳情顯示相關成果、派工回覆、核准與實際工具紀錄。
- Project 記憶變更需確認；既有禁止規則優先，不因記憶確認而放寬權限。
- 新資料使用現有 ProductDB 的版本化儲存／啟動備份機制和新記錄種類，不移動舊工作檔案。首次 Bot 初始化有可重入標記及並行保護。舊 Bot 訊息、Telegram、排程和 context API 保持相容。

## PR 與外部瀏覽器

Bot 只有在使用者明確授權此任務的遠端流程時，才使用已登入的 Shell／Git 平台 CLI／MCP 建立 PR，並呼叫 `track_pull_request` 註冊實際 URL。Skills、測試成功與已有憑證不代表發布授權；本地任務完成實作与驗證後停止。這是模型提示範圍，不能當成所有網路命令的強制隔離。後端驗證 PR 與工作 repo 的 origin 相符，讀取真實 CI／Review 狀態，將新的失敗／修改要求交回原任務；證據去重、最多自動跟進三次，達上限需使用者處理。正式核准與合併仍由使用者在 Git 平台完成。

- GitHub／Enterprise：需已安裝登入 `gh`。
- GitLab／自架 GitLab：需已安裝登入 `glab`。
- Azure DevOps Services：目前以 `AZURE_DEVOPS_EXT_PAT` 讀取狀態；公司自架 Azure DevOps Server 尚未接入此追蹤器。建立 PR 可使用已設定的 `az` 或 MCP。
- 外部瀏覽器：用使用者設定的 Chrome DevTools MCP，或設定 `APSIS_BROWSER_CDP_URL`。未連接時清楚回報，不把任務退回隱藏瀏覽器。外部網站透過外部瀏覽器開啟，檔案面板可預覽工作資料夾內的 HTML；關閉 Apsis 僅斷開外部 CDP 連線。

提供者參考：[GitHub CLI](https://cli.github.com/manual/gh_pr_view)、[GitLab CLI](https://docs.gitlab.com/cli/mr/view/)、[Azure PR API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1)、[Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。

## 驗證範圍與目前界線

本輪 `npm run check`、`npm run build` 通過，`npm test` 218 項全部通過。`verify-coding-workspace`、`verify-bots`、`verify-avatar-collection`、`verify-settings`、`verify-work-files`、`verify-context` 六套瀏覽器驗證通過。新增任務整合測試使用真實臨時 Git repo 和資料庫、可控模型 runner，涵蓋平行隔離、Diff、Plan 權限／版本、dirty copy、排程去重、重啟、遺失目錄、請求去重、PR 跟進上限／停止與網址歸屬。瀏覽器腳本 `scripts/verify-coding-workspace.ts` 驗證實際 API、Bot 下的任務導航、Diff、計畫、草稿保存、桌面／手機、深色和溢出。

外部模型的整個開發品質、真實帳號建立 PR、Git 平台端的完整 CI／Review 和使用者 CDP 瀏覽器仍需使用已設定帳號做實際驗收，不能把 fixture 結果當作這些已驗證。真實模型與瀏覽器實測另見 `live-ux-audit-2026-09-29.md`。Git 圖目前為實際分支圖文字與 commit 清單，沒有圖形化 rebase／merge 編輯器。任務手動標記完成不刪除 worktree。

### 網頁檢查與失敗停止

`verify_web` 使用任務內 HTML 相對路徑及結構化步驟，在一次性本地瀏覽器中輸入、點擊、按鍵並斷言可見文字／輸入值／可見狀態。至少要有一個結果斷言；網頁例外與失敗步驟會產生失敗紀錄。瀏覽器只可載入這個任務的本地靜態資源，不連外，也不需要使用者設定 CDP。此工具不支援需要 API／開發伺服器的完整應用，那些仍須使用對應測試與瀏覽器工具。

紀錄持久化檢查步驟、錯誤與載入檔案雜湊；檔案再修改會顯示需要重驗。畫面的「網頁檢查通過」只代表列出的操作與結果，不代替完整需求驗收或單元測試。單純載入、模型說完成，均不產生通過紀錄。

同一工具／目標／錯誤類別連續累積三次失敗會停止本輪，保留操作與檔案，要求使用者處理後續作；修改參數文字或讀取其他檔案不會重置次數。真正成功的同一操作可以解除尚未達上限的計數。停止保護同時涵蓋工具與模型迴圈邊界。

模型回合上限按實際工作模型請求計數（含供應商重試），不再把內部流程節點當成使用者設定的回合。達上限會用可操作的訊息停止並保留成果。執行中補充會在下一個內部模型呼叫前注入，進入該回合輸入後才確認「已採用」；若尚未採用就停止，不會偷帶入下一次續作。

模型看到的私有暫存工具一律使用 `scratch_*` 名稱；真正專案檔案使用 `workspace_*`。命名轉換只在模型邊界處理工具欄位，內部 dispatch／checkpoint／大型結果暫存機制沿用原名；不替換使用者文字或程式碼內容。

`4317` 仍是靜態原型；正式程式在 `3100`，目前使用 `dev:share` 的 `3102` 驗證入口分享。公開真實操作服務應使用專案既有 `dev:share` 的驗證入口，不能把靜態原型 tunnel 直接轉成無驗證的完整 API。

2026-09-29 對話精簡回歸：移除泡泡內的任務／工作範圍標籤與輸入框重複的完成結果。任務清單的展開不標已讀；點入任務才讀取回覆。型別、build 及 coding-workspace／bots 瀏覽器流程驗證桌面、手機、鍵盤展開、任務草稿、Diff、Plan、核准、成果與進度。純前端調整不修改任務資料、context、排程或工具執行歸屬。

## 手機輸入框（2026-09-29）

手機主對話採文字區＋固定單排工具列；專案／起始分支／一般與 Plan 模式移入交辦選項對話框，執行時的補充／排隊傳送方式也在此調整。核准模式維持可見，不改全域核准語意。工作資料夾改由 Bot「⋯」開啟；手機頂部移除多餘的專注入口與工作資料夾第二行。主對話與任務補充輸入在手機按 Enter 換行，以傳送按鈕送出；桌面鍵盤行為保留。

`npm run test:composer:browser` 驗證 320／375／390／430px、44px 觸控範圍、控制項無重疊、長專案名、選项與草稿保存、核准選單不越界，以及縮小可視範圍後閒置／執行中的輸入和訊息區仍可用。已檢視淺色／深色截圖。visualViewport 高度隨可視空間變動；目前自動化以短視窗模擬，沒有操作實體 iOS／Android 鍵盤。
