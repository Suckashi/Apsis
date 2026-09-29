# 持續對話與任務工作資料夾

每位 Bot 保留原本的主對話。一般訊息延續目前任務；「新任務」切開模型背景，但不清除聊天歷史。任務不需要專案就能開始。

## 工作位置

- 新任務預先分配 `<workspace>/tasks/<id>`，第一次寫檔或執行 Shell 時才建立實體目錄。
- 對話上方的「工作資料夾」是唯一位置入口。預設自動分配，需要使用既有檔案時才打開視窗，選擇已登記位置或輸入主機資料夾完整路徑。
- 送出工作後，`WorkContext.location` 與 `Job.location` 固定；更換位置請建立新任務。送出前上傳的附件會在切換位置時從快照帶入。
- 右側「檔案」只顯示目前任務的工作資料夾；不提供另一個瀏覽位置選擇器，也不顯示專案管理表單。已使用的資料夾持續登記，切換位置不會搬走原始檔。
- 派工建立接收 Bot 的獨立 context，繼承來源位置與必要的交辦背景。成果快照同時出現在來源 Bot 對話。
- 排程保存建立時的位置及專案，每次執行建立獨立 context。無專案的新排程執行使用自己的任務記憶；既有排程保留 legacy 範圍。
- 重試保留原 context、工作位置與檔案引用。

`WorkLocations` 是檔案、Shell、文件、圖片、附件與成果的共同解析入口。`Session.project`／`TaskRun.project` 保留相容的執行目錄快照。工作資料夾不是作業系統沙箱；Shell 仍受既有核准政策管制。

## 背景與記憶

模型只載入目前 context 的訊息與 checkpoint、專案說明及可見記憶。模型的歷史查詢限制在目前 context；使用者仍可搜尋完整歷史並引用原訊息。

`Memory.scopeKey` 的範圍：

| 值                    | 可見範圍                                |
| --------------------- | --------------------------------------- |
| `task:<contextId>`    | 此任務及其派工                          |
| `project:<projectId>` | 此專案的任務與 Bot                      |
| `global`              | 原 Bot 的跨工作偏好，由使用者明確指定   |
| `legacy`              | 遷移前的既有工作，沿用原 Bot 的記憶歸屬 |

新增、查詢、修改、核心記憶容量、去重及合併使用同一範圍。Bot 的記憶工具不能自行提升跨工作偏好；使用者可在記憶編輯器指定「跨工作偏好」。使用者編輯／鎖定的記憶仍不可被 Bot 自動覆寫。

成果卡片的「引用給 Bot」把發布快照複製到目前任務的 `references/`，並把版本化引用加入輸入框。檔案面板的引用使用預覽載入時的磁碟版本。引用在送出及執行前都會檢查版本。

## 檔案面板

- 預設顯示目前任務的檔案樹；展開資料夾載入下一層，重新整理會更新清單。
- 點擊檔案進入唯讀預覽，返回檔案可繼續瀏覽；支援放大預覽、下載與引用給 Bot。
- UTF-8 文字／程式碼上限 1 MiB；Markdown、PNG／JPEG、PDF 預覽；DOCX／XLSX 抽取文字閱讀。其他格式與較大檔案提供下載。
- 不提供手動新增、上傳、編輯、搬移、刪除或回收區介面。需要修改檔案時在對話交辦 Bot；聊天附件功能仍可使用。
- 舊編輯器草稿儲存不清除；這版唯讀介面不載入草稿，也不覆寫磁碟檔案。
- 底層檔案 API、版本檢查、工作鎖及回收還原能力保留相容，但不呈現在檔案面板。
- 路徑仍拒絕越界、symbolic link／junction、Git 內部資料及 Apsis 系統資料；Bot 的敏感路徑核准仍生效。
- 成果快照位於 `<dataDir>/artifacts/`，與原始檔獨立，既有下載保持相容。

第一版不含 Git 管理、worktree、多根目錄或群組聊天。

## API

所有路徑以 `/api/v2` 為前綴；修改請求沿用 `X-Apsis-Client: 1` 與既有本機來源檢查。

| 路徑                                      | 操作                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `/bots/:id/work-location`                 | GET 目前 context；PUT `{contextId, projectId}` 或 `{contextId, path, name?}` |
| `/projects`                               | GET／POST `{name, path?, description?}`；省略 path 由 Apsis 建立             |
| `/projects/:id`                           | PATCH 名稱與說明，不能搬動根目錄                                             |
| `/work-locations`                         | GET 已登記位置                                                               |
| `/work-locations/:id/files`               | GET `?path=&offset=`，每頁 200 筆                                            |
| `/work-locations/:id/content`             | GET `?path=`；PUT `{path, content, revision}`，建立時 revision 為 null       |
| `/work-locations/:id/download`、`preview` | GET `?path=`                                                                 |
| `/work-locations/:id/upload`              | POST `?path=` 原始檔案內容                                                   |
| `/work-locations/:id/directory`           | POST `{path}`                                                                |
| `/work-locations/:id/move`                | POST `{path, to, revision?}`，檔案必須提供 revision                          |
| `/work-locations/:id/trash`               | GET 回收清單；POST `{path}`                                                  |
| `/work-locations/:id/restore`             | POST `{id, path?}`，可選擇不同還原路徑                                       |
| `/bots/:id/artifact-reference`            | POST `{contextId, artifactId}`，把快照帶入目前任務                           |

訊息 API 接受 `workContextId` 與 `fileReferences: [{locationId, path, revision}]`。過期 context 回傳 `409`。核准與成果帶有任務歸屬；工作及事件也可透過 run／job ID 追溯。

## 遷移與驗證

首次啟動執行 `task-locations-v1` 遷移，先在 `<dataDir>/backups/task-locations-v1/` 保存 `state.json`、`product.sqlite` 與 `conversations.sqlite`。完成後寫入版本標記；中斷可重入，既有備份不覆寫。舊 context、工作、排程與記憶標記為既有範圍，不搬動原檔、不提升為 global。停機恢復備份時需一起還原這三個檔案；恢復前另行保存目前資料。

```sh
npm test
npm run build
npm run test:files:browser
npm run test:bots:browser
npm run test:settings:browser
```

檔案驗證報告與桌面／手機截圖在 `artifacts/work-files-verification/`。測試使用隔離資料及模型替身，真實模型的服務連線需另行驗證。
