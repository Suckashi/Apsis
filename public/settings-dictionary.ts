import { getSettingsLocale } from "./settings-locale.ts";

// Source messages are stable dictionary keys. User content is never translated.
export const english: Record<string, string> = {
  工具與引用: "Tools & context",
  "全域：": "Global: ",
  "全域 · ": "Global · ",
  需要時詢問: "Ask when needed",
  "所有 Bot · 下次操作生效": "All Bots · Next operation",
  模式說明: "About modes",
  "技能 /": "Skills /",
  "連接器 @": "Connectors @",
  傳送方式: "Send behavior",
  全域核准: "Global approvals",
  對話核准模式: "Conversation approval mode",
  "適用所有 Bot，下次工具操作生效。":
    "Applies to all Bots from the next tool operation.",
  "已切換，下次工具操作生效。":
    "Mode saved; applies from the next tool operation.",
  "設定已變更，已重新讀取，請再次選擇模式。":
    "Settings changed and have been reloaded. Select the mode again.",
  "記住的核准只適用於原任務及其派工。舊版永久核准保留供查閱，不再生效。":
    "Remembered approvals apply only to the original task and its delegated work. Legacy permanent approvals are retained for reference and no longer apply.",
  "舊版紀錄（不生效）": "Legacy record (inactive)",
  限原任務及其派工: "Original task and its delegated work only",
  工具核准模式: "Tool approval mode",
  一般核准: "Manual",
  "需要時詢問（預設）": "Ask when needed (default)",
  不要求核准: "Never ask",
  "除明確禁止與硬性權限外自動放行，包括危險命令。":
    "Automatically allow operations, including dangerous commands, except explicit denies and hard permission limits.",
  "一般操作直接執行；命中危險、敏感路徑或詢問規則時要求核准。無法分析的命令也會放行。":
    "Run ordinary operations automatically. Ask when dangerous-command, sensitive-path or ask policies match. Unanalyzable commands are also allowed.",
  "唯讀及符合條件的 Git 工作區寫入自動放行，其他操作要求核准。":
    "Automatically allow read-only tools and eligible Git workspace writes; ask for other operations.",
  "危險命令確認（不要求核准模式不適用）":
    "Dangerous-command guard (not applicable in Never ask mode)",
  "完整命令 glob（選填）": "Whole-command glob (optional)",
  "* 比對任意字元，? 比對單一字元；比對整條命令。":
    "* matches any characters and ? one character; matches the entire command.",
  "本次任務允許相同操作（包含由此任務派工）":
    "Allow the same operation for this task, including delegated work",
  "找不到 Bash。Windows 請安裝 Git for Windows；Linux 請安裝 Bash，或設定 APSIS_SHELL_PATH。":
    "Bash was not found. Install Git for Windows on Windows or Bash on Linux, or set APSIS_SHELL_PATH.",
  "命令執行逾時。": "Command timed out.",
  "請先在模型設定填寫 context 上限。":
    "Set the context limit in model settings before running this model.",
  "Context 上限不足以容納輸出預留與安全空間，請調整模型設定。":
    "The context limit cannot fit the output reserve and safety margin. Adjust model settings.",
  "模型 token 預算格式錯誤。": "Invalid model token budget.",
  "尚有執行中、排隊或等待核准的工作，請完成或停止後再建立新任務。":
    "Finish or stop running, queued or approval-pending work before starting a new task.",
  "記憶已變更，請重新載入後再編輯。":
    "This memory changed. Reload before editing.",
  "此記憶由使用者編輯或鎖定，不能自動覆寫。":
    "This memory was edited or locked by the user and cannot be automatically overwritten.",
  "核心記憶超過 6,000 字元，請先整理或移至參考記憶。":
    "Core memory exceeds 6,000 characters. Consolidate it or move entries to reference memory.",
  "固定指令、工具定義或最新使用者輸入超出模型輸入預算；請縮短輸入、減少工具或調高 context 上限。":
    "Instructions, tool definitions or the latest input exceed the input budget. Shorten the input, reduce tools or increase the context limit.",
  "壓縮後仍超出模型容量，本步已停止；請調整 context 設定。":
    "The model capacity was exceeded after compaction. This step stopped; adjust the context settings.",
  重新交辦原任務: "Retry in the original task context",
  取消重新交辦: "Cancel task retry",
  "新任務已開始，輸入新的工作內容。":
    "New task started. Enter what you want to work on.",
  手動設定優先: "Manual limit takes priority",
  "未填寫時預設 256K（262,144 tokens）":
    "Defaults to 256K (262,144 tokens) when blank",
  互動聊天: "Chat",
  更早的任務: "Earlier tasks",
  需設定: "Setup required",
  "Context token 上限": "Context token limit",
  "官方模型可自動判定；自訂端點需設定":
    "Official models use known profiles; custom endpoints require a limit",
  歷史搜尋與任務: "History and tasks",
  搜尋歷史: "Search history",
  引用: "Quote",
  前後文: "Surrounding messages",
  更早的搜尋結果: "Earlier results",
  瀏覽舊任務: "Browse previous tasks",
  選擇任務: "Select a task",
  更早的訊息: "Earlier messages",
  "Context 用量": "Context usage",
  實際回報: "Reported",
  估計: "Estimated",
  未載入的核心記憶: "Core memories not loaded",
  尚無用量紀錄: "No usage recorded yet",
  壓縮紀錄: "Compactions",
  新增記憶: "Add memory",
  核心: "Core",
  參考: "Reference",
  來源與修訂: "Source and revisions",
  記憶內容: "Memory content",
  分類: "Category",
  鎖定: "Locked",
  啟用: "Enabled",
  新任務: "New task",
  "執行中、排隊或等待核准時無法切換任務":
    "Finish or stop running, queued or approval-pending work before starting a new task",
  任務: "Task",
  "捨棄尚未儲存的設定變更？": "Discard unsaved settings changes?",
  "工具名稱需完全符合，或使用 *。路徑相對於工作區，包含子目錄。拒絕規則優先。":
    "Match an exact tool name or *. Paths are relative to the workspace and include descendants. Deny rules take precedence.",
  工具: "Tool",
  處理方式: "Decision",
  詢問核准: "Ask for approval",
  允許: "Allow",
  "路徑（選填）": "Path (optional)",
  "目標 Bot ID（選填）": "Target Bot ID (optional)",
  任務執行: "Task execution",
  "Bot 協作": "Bot collaboration",
  重設為預設值: "Reset to defaults",
  "移除此範本？既有 Bot 將保留。":
    "Remove this template? Existing Bots will be kept.",
  已不存在: "Unavailable",
  純文字: "Plain text",
  複製程式碼: "Copy code",
  "程式碼，可左右捲動": "Code, scroll horizontally",
  "[圖片：{0}]": "[Image: {0}]",
  未提供說明: "No description provided",
  "表格，可左右捲動": "Table, scroll horizontally",
  "你好，我是 {0}。": "Hello, I’m {0}.",
  "刪除「{0}」？": "Delete “{0}”?",
  "執行紀錄（{0}）": "Run history ({0})",
  "準備加入 {0} 個連接器": "Ready to add {0} connectors",
  "已選 {0} 個模型": "{0} models selected",
  "{0} 個模型": "{0} models",
  "請選擇模型連線。": "Select a model connection.",
  "找不到可用的模型連線。": "No available model connection found.",
  "Codex 接入已移除，請重新選擇模型。":
    "Codex is no longer supported. Select a replacement model.",
  "Codex 接入已移除，請先在 Bot 設定重新選擇模型。":
    "Codex is no longer supported. Select a replacement model in the Bot profile.",
  "Codex 接入已移除，請選擇其他供應商。":
    "Codex is no longer supported. Select another provider.",
  "此模型不在所選連線的模型清單中。":
    "This model is not in the selected connection’s model list.",
  "網址已變更，請重新輸入 API key，或先儲存新網址後再取得模型。":
    "The URL changed. Enter the API key again or save the new URL before fetching models.",
  "未知供應商。": "Unknown provider.",
  "模型清單需包含 1–1000 個模型。":
    "The model list must contain 1–1000 models.",
  "模型清單格式錯誤。": "Invalid model list.",
  "模型清單不能重複。": "Models must not be duplicated.",
  "預設模型必須在模型清單中。":
    "The preferred model must be in the model list.",
  "未知平台。": "Unknown platform.",
  "API key 格式錯誤。": "Invalid API key.",
  "模型參數格式錯誤。": "Invalid model settings.",
  "模型參數必須屬於此連線的模型。":
    "Model settings must belong to models in this connection.",
  "不支援的模型參數。": "Unsupported model setting.",
  "模型顯示名稱需為 1–100 字。":
    "Model display names must be 1–100 characters.",
  "模型輸出上限需為 1–1000000 的整數。":
    "Maximum output tokens must be an integer from 1 to 1000000.",
  "找不到模型連線。": "Model connection not found.",
  "此連線是預設模型，請先切換預設模型。":
    "This connection is the default. Select another default first.",
  "內容為空或超過長度限制。": "Content is empty or exceeds the length limit.",
  "找不到 Bot。": "Bot not found.",
  "Bot 正在刪除中。": "Bot deletion is in progress.",
  "技能或連接器清單格式錯誤。": "Invalid skill or connector list.",
  "技能或連接器已不存在，請重新選擇。":
    "A skill or connector is no longer available. Select available items again.",
  "未知權限模式。": "Unknown permission mode.",
  "描述過長。": "Description is too long.",
  "請選擇有效的 Bot 圖示。": "Select a valid Bot avatar.",
  "外部操作正在傳送，請等待完成後再刪除 Bot。":
    "An external action is being sent. Wait for it to finish before deleting this Bot.",
  "任務尚未停止，請稍後重試刪除。":
    "Tasks have not stopped yet. Try deleting again shortly.",
  "找不到任務紀錄。": "Task history not found.",
  "找不到 Bot 範本。": "Bot template not found.",
  "請先停止目前任務再更換模型。":
    "Stop the current task before changing models.",
  "請先設定可用的預設模型，或指定此 Bot 的模型。":
    "Configure an available default model or choose a model for this Bot.",
  "請先在設定加入模型連線。": "Add a model connection in Settings first.",
  "這項操作被權限規則拒絕。": "Permission rules denied this action.",
  "權限已變更，這項操作已被拒絕。":
    "Permissions changed and this action was denied.",
  "找不到核准要求。": "Approval request not found.",
  "這項核准已失效。": "This approval has expired.",
  "排程沒有下一次執行時間。": "The schedule has no next run.",
  "Cron 或時區格式錯誤。": "Invalid cron expression or time zone.",
  "連接器未啟用。": "Connector is not enabled.",
  "目前沒有可引導的執行中任務。":
    "No running task is available for additional instructions.",
  "請先停止執行中的任務再接管共用瀏覽器。":
    "Stop running tasks before taking control of the shared browser.",
  "不支援這個附件格式。": "Unsupported attachment format.",
  "附件超過 20 MB。": "Attachment exceeds 20 MB.",
  "找不到草稿。": "Draft not found.",
  "草稿已處理，不會重複執行。":
    "The draft has already been processed and will not run again.",
  "請填入有效的 JSON 參數。": "Enter valid JSON arguments.",
  "參數需為 JSON 物件。": "Arguments must be a JSON object.",
  紫色圓圓: "Purple orbit",
  藍色雲朵: "Blue cloud",
  綠色豆豆: "Green bean",
  橘色星星: "Orange spark",
  粉色花花: "Pink bloom",
  黃色方方: "Yellow cube",
  操作失敗: "Operation failed",
  已複製: "Copied",
  複製失敗: "Copy failed",
  複製: "Copy",
  "附件：{0}，工作區路徑：{1}": "Attachment: {0}, workspace path: {1}",
  "附件上限為 20 MB。": "Attachments must be 20 MB or smaller.",
  "請使用連接器「{0}」（ID：{1}）：": "Use connector “{0}” (ID: {1}):",
  "請依照技能「{0}」（ID：{1}）執行：": "Follow skill “{0}” (ID: {1}):",
  跳至對話: "Skip to conversation",
  關閉名單: "Close Bot list",
  "收起 Bot 名單": "Collapse Bot list",
  "新增 Bot": "New Bot",
  "建立中…": "Creating…",
  對話: "Chats",
  "搜尋 Bot": "Search Bots",
  搜尋: "Search",
  "搜尋對話或 Bot": "Search chats or Bots",
  "你的 Bots": "Your Bots",
  最近對話: "Recent chats",
  昨天: "Yesterday",
  已釘選: "Pinned",
  未讀: "Unread",
  已隱藏: "Hidden",
  查看隱藏: "Show hidden",
  返回: "Back",
  "正在處理任務…": "Working on a task…",
  任務失敗: "Task failed",
  等待你的核准: "Waiting for your approval",
  "為你的工作新增一位幫手。": "Add a helper for your work.",
  "沒有隱藏的 Bot": "No hidden Bots",
  "找不到符合的 Bot": "No matching Bots",
  "Bot 名單": "Bot list",
  設定與工具: "Settings & tools",
  切換為淺色模式: "Switch to light mode",
  切換為深色模式: "Switch to dark mode",
  淺色模式: "Light mode",
  深色模式: "Dark mode",
  "Bot 導覽": "Bot navigation",
  "開啟 Bot 名單": "Open Bot list",
  關閉錯誤: "Dismiss error",
  載入中: "Loading",
  隨時可以交辦任務: "Ready for your next task",
  正在工作: "Working",
  等待核准: "Awaiting approval",
  "自訂 Bot：名稱、圖示、角色與模型":
    "Customize Bot: name, avatar, role and model",
  尚未連接模型: "No model connected",
  進入專注模式: "Enter focus mode",
  離開專注模式: "Exit focus mode",
  專注模式: "Focus mode",
  切換詳情面板: "Toggle details panel",
  "Bot 詳情": "Bot details",
  "你好，我是": "Hello, I’m",
  "告訴我你想完成什麼，我會在這裡接著做。":
    "Tell me what you want to accomplish, and I’ll work on it here.",
  "幫我研究一個主題，整理來源與結論":
    "Research a topic and summarize the sources and findings",
  "讀取我的文件，整理成一份報告": "Read my documents and put together a report",
  協助我完成一個程式開發任務: "Help me complete a coding task",
  "先連接一個模型，即可開始對話": "Connect a model to start a conversation",
  "回覆：": "Reply to:",
  無法連線至模型供應商: "Unable to connect to the model provider",
  "請檢查網路及模型連線設定，再重新送出訊息。":
    "Check your network and model connection settings, then resend your message.",
  錯誤詳情: "Error details",
  執行失敗: "Task failed",
  回覆: "Reply",
  "下一個任務：": "Next task:",
  重新交辦: "Retry task",
  關閉: "Close",
  關閉這則任務提示: "Dismiss this task notice",
  "載入對話…": "Loading conversation…",
  取消回覆: "Cancel reply",
  "移除 {0}": "Remove {0}",
  傳送訊息: "Send message",
  "傳訊息給 {0}…": "Message {0}…",
  "傳送中…": "Sending…",
  新增附件: "Add attachment",
  選擇技能: "Choose a skill",
  "選擇技能 /": "Choose a skill /",
  選擇連接器: "Choose a connector",
  "選擇連接器 @": "Choose a connector @",
  補充指示: "Add instructions",
  停止任務: "Stop task",
  排入下一個: "Queue next",
  傳送: "Send",
  排入下一個任務: "Queue as next task",
  "Enter 傳送 · Shift + Enter 換行":
    "Enter to send · Shift + Enter for a new line",
  "可以補充指示，或將新訊息排入下一個任務。":
    "Add instructions or queue a new message as the next task.",
  "把事情交給你的 Bot。": "Put your Bot to work.",
  "一段持續的對話。能動手工作的幫手。":
    "One ongoing conversation. A helper that gets things done.",
  "從研究、整理文件，到完成程式開發。":
    "From research and documents to coding tasks.",
  "建立第一個 Bot": "Create your first Bot",
  研究與整理: "Research & summarize",
  "比較資料，整理有來源的結論":
    "Compare information and summarize findings with sources",
  文件與日常工作: "Documents & everyday work",
  "讀取文件，製作可下載的成果":
    "Read documents and create downloadable results",
  開發與操作: "Develop & operate",
  "使用瀏覽器、檔案和本機工具": "Work with the browser, files and local tools",
  "連接你的 LLM API": "Connect your LLM API",
  關閉詳情: "Close details",
  返回詳情: "Back to details",
  詳情: "Details",
  "Bot 個人檔案": "Bot profile",
  "自訂 Bot": "Customize Bot",
  "附件與成果會顯示在這裡。": "Attachments and results will appear here.",
  檔案與成果: "Files & results",
  "開始瀏覽網頁後會顯示工作畫面。":
    "The browser view will appear when browsing starts.",
  開啟電腦: "Open computer",
  "Bot 瀏覽器畫面": "Bot browser view",
  電腦: "Computer",
  待命: "Ready",
  已連線: "Connected",
  使用者控制中: "Under your control",
  已暫停: "Paused",
  "下次 {0}": "Next: {0}",
  "在指定時間交辦工作。": "Schedule work for a specific time.",
  新增排程: "New schedule",
  排程: "Schedules",
  "告訴 Bot 你希望它記住的偏好。":
    "Tell your Bot which preferences to remember.",
  記憶: "Memory",
  "執行任務後可查看操作紀錄。": "Activity records appear after a task runs.",
  "· 查看紀錄": "· View history",
  最近操作: "Recent activity",
  "建立 Bot": "Create Bot",
  "關閉建立 Bot": "Close Bot creation",
  "Bot 的電腦": "Bot computer",
  "所有 Bots 共用登入狀態，各自使用分頁。":
    "All Bots share sign-in sessions and use separate tabs.",
  關閉電腦: "Close computer",
  "尚未開啟網頁。可在對話中請 Bot 瀏覽網站。":
    "No page is open. Ask your Bot to browse a website.",
  完整瀏覽器畫面: "Full browser view",
  "接管會在本機開啟專用瀏覽器視窗。":
    "Taking control opens a dedicated browser window on this computer.",
  接管瀏覽器: "Take control",
  交還控制權: "Return control",
  成果: "Result",
  附件: "Attachment",
  草稿: "Draft",
  傳送中: "Sending",
  已傳送: "Sent",
  已捨棄: "Discarded",
  結果待確認: "Result unconfirmed",
  操作結果: "Action result",
  編輯操作內容: "Edit action",
  捨棄: "Discard",
  確認並傳送: "Confirm and send",
  需要你的核准: "Your approval is needed",
  "Bot 希望執行": "The Bot wants to run",
  "此 Bot 下次使用完全相同參數時自動允許":
    "Automatically allow this Bot to use the exact same arguments next time",
  拒絕: "Deny",
  核准並繼續: "Approve and continue",
  "處理中…": "Working…",
  "例如：你是我的秘書，依其他 Bot 的角色派工，收到結果後整理回覆給我。":
    "Example: You are my assistant. Delegate to other Bots based on their roles, then summarize their results for me.",
  "釘選 Bot": "Pin Bot",
  取消釘選: "Unpin",
  "隱藏 Bot": "Hide Bot",
  "顯示 Bot": "Show Bot",
  "隱藏不會暫停排程。": "Hiding a Bot does not pause its schedules.",
  "刪除 Bot": "Delete Bot",
  "刪除「": "Delete “",
  "此操作無法復原。將停止這位 Bot 的任務，刪除對話、專屬記憶與技能、排程、草稿、核准規則，以及附件與成果清單。":
    "This cannot be undone. It stops this Bot’s tasks and deletes its conversation, private memory and skills, schedules, drafts, approval rules, and attachment and result lists.",
  "工作區實體檔案與執行日誌會保留；已完成的外部操作不會撤銷。":
    "Workspace files and execution logs are kept. Completed external actions are not undone.",
  取消: "Cancel",
  確認刪除: "Confirm deletion",
  "停止任務並刪除中…": "Stopping tasks and deleting…",
  編輯排程: "Edit schedule",
  關閉排程: "Close schedule",
  名稱: "Name",
  交辦內容: "Task instructions",
  時間: "Schedule",
  "每個工作日 09:00": "Weekdays at 09:00",
  "每天 09:00": "Every day at 09:00",
  "每週一 09:00": "Mondays at 09:00",
  "自訂 Cron": "Custom cron",
  時區: "Time zone",
  "啟用排程（Apsis 需保持執行）": "Enable schedule (Apsis must remain running)",
  立即試跑: "Run now",
  儲存排程: "Save schedule",
  "儲存中…": "Saving…",
  "執行紀錄（": "Run history (",
  "清單更新失敗：{0}": "Could not refresh the list: {0}",
  "已加入 {0} 個 MCP 連接器。": "Added {0} MCP connectors.",
  "已加入 {0} 個。": "Added {0}. ",
  "模型和工具供所有 Bots 使用。": "Configure models and tools for your Bots.",
  關閉設定: "Close settings",
  "MCP 連接器": "MCP connectors",
  "連接支援 Streamable HTTP 的 MCP 服務。工具執行前會出現核准卡片。":
    "Connect MCP services using Streamable HTTP. Actions follow your configured approval rules.",
  移除: "Remove",
  新增連接器: "Add connector",
  手動輸入: "Enter manually",
  "貼上 JSON": "Paste JSON",
  連接器輸入方式: "Connector input method",
  "支援 mcpServers、servers 或單筆 JSON；可一次加入多個 Streamable HTTP 服務。":
    "Supports mcpServers, servers, or a single JSON object. Add multiple Streamable HTTP services at once.",
  "MCP 設定 JSON": "MCP configuration JSON",
  "檢查 JSON": "Validate JSON",
  準備加入: "Ready to add",
  個連接器: "connectors",
  "無需 token": "No token",
  "Bearer token 已提供": "Bearer token provided",
  測試並加入: "Test and add",
  "連線測試中…": "Testing connection…",
  "Bearer token（選填）": "Bearer token (optional)",
  "已連線，Bot 可使用這個服務。":
    "Connected. You can enable this service for your Bots.",
  共用技能: "Shared skills",
  "在對話輸入 / 選擇技能。": "Type / in the conversation to choose a skill.",
  步驟: "Instructions",
  新增技能: "Add skill",
  "技能已建立。": "Skill created.",
  "在 Telegram 私訊你的 Bot，接續本機工作。":
    "Message your Bot on Telegram to continue local work.",
  已停用: "Disabled",
  連線失敗: "Connection failed",
  連線中: "Connecting",
  等待配對: "Awaiting pairing",
  尚未設定: "Not configured",
  已配對: "Paired",
  檢查中: "Checking",
  "啟用 Bot 後即可配對。": "Enable the Bot to pair your account.",
  "正在連線 Telegram，完成後即可配對。":
    "Connecting to Telegram. Pair your account once connected.",
  "Bot 已連線，請建立配對碼綁定你的帳號。":
    "Bot connected. Generate a pairing code to link your account.",
  "先儲存從 BotFather 取得的 token。": "First save the token from BotFather.",
  "你的 Telegram 帳號已綁定，可開始傳訊。":
    "Your Telegram account is linked and ready for messages.",
  "正在讀取 Telegram 設定。": "Loading Telegram settings.",
  "連接你的 Bot": "Connect your Bot",
  "從 Telegram 的 @BotFather 取得 Bot token，儲存在這台電腦。":
    "Get a Bot token from @BotFather on Telegram and save it on this computer.",
  "從 @BotFather 取得": "From @BotFather",
  儲存並啟用: "Save and enable",
  "Token 已儲存，正在連線 Telegram。": "Token saved. Connecting to Telegram.",
  "Token 已儲存": "Token saved",
  "啟用 Bot": "Enable Bot",
  "更換 token": "Replace token",
  "配對 Telegram 帳號": "Pair Telegram account",
  "建立指令後，私訊你的 Bot 完成配對。指令有效 10 分鐘。":
    "Generate a command, then send it to your Bot in a private message. It expires in 10 minutes.",
  建立配對指令: "Generate pairing command",
  重新產生指令: "Regenerate command",
  "等待連線完成…": "Waiting for connection…",
  帳號已配對: "Account paired",
  "傳送給 Bot": "Send to your Bot",
  複製指令: "Copy command",
  "無法自動複製，請手動選取配對指令。":
    "Could not copy automatically. Select and copy the command manually.",
  "配對指令已複製。": "Pairing command copied.",
  配對後可用: "After pairing, use",
  "查看名單、": "to list Bots,",
  "選擇 Bot、": "to select a Bot, and",
  "停止工作。": "to stop work.",
  自動核准規則: "Auto approval rules",
  "只允許指定 Bot、工具與完全相同的參數。其餘操作仍需核准。":
    "Allows only the specified Bot, tool and exact arguments. Other actions still require approval.",
  "尚未儲存自動核准規則。": "No auto approval rules saved.",
  撤銷規則: "Revoke rule",
  "使用 OpenAI API key": "Use an OpenAI API key",
  "使用 Anthropic API key": "Use an Anthropic API key",
  連接本機或自架模型: "Connect a local or self-hosted model",
  自訂供應商: "Custom provider",
  "OpenAI 相容 API、公司閘道或其他平台":
    "OpenAI-compatible APIs, company gateways or other platforms",
  "未找到模型，仍可手動加入模型 ID。":
    "No models found. You can still add a model ID manually.",
  "找到 {0} 個模型。勾選後儲存才會加入供應商。":
    "Found {0} models. Select models and save to add them to this provider.",
  "{0} 也可以手動加入模型 ID。": "{0} You can also add a model ID manually.",
  "← 返回供應商": "← Back to providers",
  "新增 {0}": "Add {0}",
  "編輯 {0}": "Edit {0}",
  新增供應商: "Add provider",
  模型供應商: "Model providers",
  "連線與模型儲存在這台電腦，不會變更其他 Bot 的模型選擇。":
    "Connections and models are stored on this computer. Other Bots keep their model selections.",
  "選擇登入方式或 API 類型，再加入你要使用的模型。":
    "Choose an API provider, then add the models you want to use.",
  "一組連線、多個模型。供所有 Bot 選用。":
    "One connection, multiple models. Available to all your Bots.",
  系統預設模型: "Default model",
  選擇替代模型: "Select a replacement model",
  "已更新系統預設模型。": "Default model updated.",
  "僅用於未指定模型的 Bot；編輯供應商不會切換此設定。":
    "Used by Bots without a specific model. Editing a provider does not change this setting.",
  "尚未加入供應商。新增後即可選擇模型開始對話。":
    "No providers yet. Add one to select a model and start chatting.",
  個模型: "models",
  編輯: "Edit",
  未設定金鑰: "No API key",
  已儲存金鑰: "API key saved",
  "本機／自架服務": "Local / self-hosted service",
  "需要替換：請新增 API 供應商，並更新使用此連線的 Bot。":
    "Replacement needed: add an API provider and update Bots using this connection.",
  系統預設: "Default",
  最近測試失敗: "Last test failed",
  最近測試通過: "Last test passed",
  連線設定: "Connection settings",
  "例如：公司模型服務": "Example: company model service",
  "API 網址": "API URL",
  "網址變更後不會沿用原金鑰，請重新填寫。":
    "Changing the URL clears the saved key. Please enter it again.",
  "輸入 API key（無需驗證的端點可留白）":
    "Enter API key (optional for unauthenticated endpoints)",
  "已儲存；留白保留原金鑰": "Saved; leave blank to keep the current key",
  "金鑰儲存後不會回傳到瀏覽器。":
    "Saved keys are never sent back to the browser.",
  "API 類型：": "API type:",
  模型目錄: "Model catalog",
  已選: "Selected",
  取得可用模型: "Fetch available models",
  "取得中…": "Fetching…",
  "尚未加入模型。可從供應商取得清單，或手動輸入模型 ID。":
    "No models added. Fetch the provider’s list or enter a model ID manually.",
  搜尋模型: "Search models",
  "搜尋模型名稱或 ID": "Search model name or ID",
  "使用中；請先切換使用此模型的 Bot 或系統預設，再移除。":
    "In use. Switch the Bots or default using this model before removing it.",
  "沒有符合的模型。": "No matching models.",
  可用模型: "Available models",
  "手動加入模型 ID": "Add model ID manually",
  "輸入模型 ID": "Enter model ID",
  加入: "Add",
  此供應商的建議模型: "Preferred model for this provider",
  "不會更改系統預設模型。": "Does not change the default model.",
  進階模型設定: "Advanced model settings",
  "僅調整顯示名稱與輸出上限；留白沿用供應商預設。":
    "Set a display name and output limit. Leave blank to use provider defaults.",
  顯示名稱: "Display name",
  "輸出 token 上限": "Maximum output tokens",
  儲存供應商: "Save provider",
  測試已儲存連線: "Test saved connection",
  "測試已儲存的設定：{0}": "Saved connection test: {0}",
  "供應商已儲存。": "Provider saved.",
  模型供應商設定: "Model provider settings",
  "Bot 圖示": "Bot avatar",
  "每個 MCP 服務都必須是 JSON 物件。":
    "Each MCP service must be a JSON object.",
  "每個 MCP 服務都需要名稱（最多 100 字）。":
    "Each MCP service needs a name (up to 100 characters).",
  "{0} 使用 command/stdio，目前只支援 HTTP MCP endpoint。":
    "{0} uses command/stdio. Only HTTP MCP endpoints are supported.",
  "{0} 的傳輸方式不支援；目前只支援 Streamable HTTP。":
    "{0} uses an unsupported transport. Only Streamable HTTP is supported.",
  "{0} 缺少有效的 HTTP MCP endpoint。":
    "{0} requires a valid HTTP MCP endpoint.",
  "{0} 的 endpoint 網址格式錯誤。": "{0} has an invalid endpoint URL.",
  "{0} 需要不含帳密的 HTTP MCP endpoint。":
    "{0} requires an HTTP MCP endpoint without embedded credentials.",
  "{0} 的 headers 格式錯誤。": "{0} has invalid headers.",
  "{0} 的 {1} header 尚不支援。": "The {1} header is not supported for {0}.",
  "{0} 的 Authorization header 格式錯誤。":
    "{0} has an invalid Authorization header.",
  "{0} 的 Authorization 需使用 Bearer token。":
    "{0} requires Bearer token authorization.",
  "{0} 的 token 與 Authorization header 不一致。":
    "{0} has conflicting token and Authorization header values.",
  "{0} 的 token 格式錯誤，請填入實際的 Bearer token。":
    "{0} has an invalid token. Enter the actual Bearer token.",
  "請貼上 MCP 連接器 JSON。": "Paste MCP connector JSON.",
  "JSON 內容過長。": "JSON is too long.",
  "JSON 語法錯誤，請檢查逗號與引號。":
    "Invalid JSON syntax. Check commas and quotation marks.",
  "JSON 必須是 MCP 服務物件或清單。":
    "JSON must contain an MCP service object or list.",
  "mcpServers／servers 必須是以服務名稱為鍵的物件。":
    "mcpServers / servers must be an object keyed by service name.",
  "JSON 中找不到 MCP 服務。": "No MCP services found in JSON.",
  "一次最多加入 20 個 MCP 服務。": "Add up to 20 MCP services at a time.",
};

export function uiText(
  source: string,
  values: readonly unknown[] = [],
): string {
  const message =
    getSettingsLocale() === "en" && Object.hasOwn(english, source)
      ? english[source]
      : source;
  return message.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}

const settingsErrors: Record<string, string> = {
  "permissionRules must be an array": "權限規則必須是清單。",
  "Rule scope must be global or bot": "規則範圍必須是全域或 Bot。",
  "Rule effect must be allow, ask, or deny":
    "規則處理方式必須是允許、詢問或拒絕。",
  "Rule tool must be exact or '*'":
    "請填入完整工具名稱或 *；不能包含空白或其他萬用字元。",
  "Global rules cannot have botId": "全域規則不能指定來源 Bot。",
  "Rule path must be a string": "規則路徑必須是文字。",
  "Rule tool must be a nonempty identifier":
    "工具名稱不能留白，且前後不能有空白。",
  "Rule targetBotId must be a nonempty identifier":
    "目標 Bot ID 不能留白，且前後不能有空白。",
  "locale must be zh-Hant or en": "請選擇繁體中文或 English。",
};
export function uiError(message: string) {
  if (getSettingsLocale() === "en") return uiText(message);
  return Object.hasOwn(settingsErrors, message)
    ? settingsErrors[message]
    : message;
}
