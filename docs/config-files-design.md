# Apsis 設定檔

一般設定和模型連線使用 `.apsis-v4/settings.toml`，MCP 使用 `.apsis-v4/mcp.json`。
設定頁與手動編輯讀寫同一份檔案。這份文件已由最初的 JSON 設計稿更新為實作說明。

路徑由 `createApp({ dataDir })` 決定，預設是啟動目錄下的 `.apsis-v4`。
從本專案根目錄啟動時，位置為 `D:\Code\Apsis\.apsis-v4`。
目前只有這一層設定，不會自動讀取 Bot 工作目錄內的同名檔案。

## 分工

| 位置                   | 內容                                                  |
| ---------------------- | ----------------------------------------------------- |
| `settings.toml`        | 語言、執行限制、權限規則、providers、models、預設模型 |
| `mcp.json`             | HTTP MCP 伺服器、驗證方式、啟用狀態、逾時             |
| `product.sqlite`       | Bot、範本、任務、排程、核准歷史、連線測試結果等資料   |
| `conversations.sqlite` | 對話資料                                              |
| `skills/`              | Apsis 共用技能，與 `~/.agents/skills/` 合併讀取       |
| 瀏覽器 localStorage    | 主題、版面、上次選取的 Bot，維持現況                  |

設定格式參考 Kimi Code 的主設定與 MCP 分離，以及 providers/models 結構。
Apsis 使用 camelCase 與自身的模型協定、權限規則，不宣稱完全相容 Kimi。
參考：[Kimi 主設定](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files)、
[Kimi MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html)（2026-09-27 查閱）。

## settings.toml

可複製完整的[預設範例](examples/settings.toml)。不必手動建立；首次啟動會自動產生。
TOML 支援 `#` 註解，設定頁寫回時只修改改動的欄位，保留未移除欄位的註解。

```toml
version = 1

[ui]
locale = "zh-Hant"

[runtime]
maxTurns = 100
shellTimeoutSeconds = 60 # 每個指令的秒數

[permissions]
approvalMode = "yolo"
dangerousCommandGuard = true
rules = []
```

`version` 是格式版本。省略一般設定欄位時沿用 `shared/settings.ts` 的預設值；
未知欄位、拼字錯誤、無效數值或未支援的格式版本會報錯。
`runtime.outputLimit` 以字元計算，模型的 `maxOutputTokens` 以 token 計算。

權限規則沿用 Apsis 的 PermissionRule，包含 `id`、`scope`、`tool`、`effect`，
可選 `botId`、`path`、`targetBotId`、`commandPattern`。例如：

```toml
[[permissions.rules]]
id = "ask-shell"
scope = "global"
tool = "shell"
effect = "ask"
```

上面的陣列表寫法和 `rules = []` 擇一，不要同時使用。
Bot 本身的工具選取與 Bot 規則仍保存在 Bot 資料中。

模型連線範例（模型 ID 和環境變數請換成實際值）：

```toml
[defaults]
model = "company/main"

[providers.company]
name = "公司模型服務"
type = "openai-compatible"
baseUrl = "https://model.example.com/v1"
apiKeyEnv = "COMPANY_MODEL_API_KEY"
defaultModel = "company/main"

[models."company/main"]
provider = "company"
model = "my-model"
displayName = "主要模型"
maxOutputTokens = 4096
contextWindowTokens = 131072
```

- `providers` 的 key 是可讀別名，例如 `kimi`、`command-code` 或 `"本機-qwen3-5"`。
  新連線依顯示名稱產生別名，重名加 `-2`、`-3`；中文別名使用 TOML 引號。
  key 本身就是 connection ID，不接受額外的 `id` 欄位，也不保留 UUID 對照。
- 修改 `name` 只改顯示名稱，既有別名保持穩定。要手動改段落別名時，同步修改
  相關 `models` 項目的 `provider`，並重新選擇使用該連線的 Bot 模型。
  若也修改模型別名，需同步更新 `defaults.model` 和供應商的 `defaultModel`。
- `type` 支援 `openai`、`anthropic`、`ollama`、`openai-compatible`。
  自訂 API 網址使用 openai-compatible；Codex 不屬於本版格式。
- `models` 的 key 是別名；`model` 才是送到服務端的真實模型 ID。
  新增模型使用 `供應商別名/模型ID`，一般斜線和句點保留，特殊引號等字元會跳脫。
  同一 provider 不接受重複的真實模型 ID。
- `providers.<id>.defaultModel` 是該連線的預設模型別名；`defaults.model` 是全域
  預設。`defaults.model` 留空時沿用第一個可用連線；明確指定不存在的別名會報錯。
- `apiKey` 與 `apiKeyEnv` 擇一。前者直接儲存金鑰，後者僅儲存環境變數名稱。
  缺少指定的環境變數時，該連線呼叫失敗，不將解析後的金鑰寫回檔案。
- `vendor`、`archived` 和各模型的 `displayName`、`maxOutputTokens`、
  `contextWindowTokens` 都保留現有語意。API 不回傳金鑰。

## mcp.json

[完整範例](examples/mcp.json)預設停用示意伺服器。可使用純 `mcpServers` 結構：

```json
{
  "mcpServers": {
    "company-tools": {
      "url": "https://mcp.example.com/mcp",
      "bearerTokenEnvVar": "COMPANY_MCP_TOKEN",
      "enabled": true,
      "startupTimeoutMs": 15000,
      "toolTimeoutMs": 60000
    }
  }
}
```

- key 是 connector ID，Bot 與 Draft 使用此 ID 引用。
- 可使用 `headers` 設定靜態 HTTP headers，或使用 `bearerTokenEnvVar` 指向 token。
  Authorization header 與 bearerTokenEnvVar 互斥；列表與模型提示不包含憑證。
- `enabled` 預設 true；連線逾時預設 15000ms，工具呼叫逾時預設 60000ms。
  逾時接受 1–2147483647 的整數毫秒。
- 啟用代表工具可供選取；Bot 仍須透過自己的 `connectorIds` 選取工具。
- Apsis 可選的 `x-apsis` 區塊包含 `version = 1` 和 `serverNames` 顯示名稱對照。
  未指定名稱時顯示 connector ID。匯出給其他客戶端時可移除這個擴充區塊。
- 本版只支援 Streamable HTTP。stdio 的 command/args、SSE、OAuth 或其他未支援
  欄位會報錯，不能直接貼入這些設定後期待能執行。

## 儲存與生效

設定頁儲存後立即寫檔。手動存檔後，下一次相關設定讀取就會載入；重新整理
頁面可更新顯示，不需重啟，也不會啟動檔案監聽器。編輯器若把尚未寫完的內容
暴露給程式，暫時會收到格式錯誤；完成有效存檔後即可恢復。

- `GET /api/v2/settings` 回傳字串 revision（settings.toml 原始內容的 SHA-256）。
  `PATCH` 必須帶回這個 revision；不再使用數字加一。手動修改或模型設定修改
  都會使舊 revision 失效，回 409 且不覆寫檔案。
- 模型連線的 API view 提供 `configRevision`；模型編輯表單送回該值防止覆蓋
  開啟表單後的外部修改。內部程式直接呼叫時可省略。
- 應用寫入使用短期檔案鎖、同目錄暫存檔、flush 與 rename 原子替換。
  寫入前後檢查原內容；出錯保留舊檔，損毀檔不重置成預設值。
- 外部編輯器不遵守應用的鎖，仍有檢查後至 rename 前的極短競態。
  不保證同時在文字編輯器與 UI 儲存能自動合併；保留備份供恢復。
- `.bak` 保存上一次應用成功寫入前的有效內容；`.initialized` 記錄檔案已建立，
  避免設定遺失後靜默重置成預設值。
  程序崩潰的鎖可在確認 PID 已結束後自動回收。
- Runtime 限制在新任務開始時建立快照；權限在下一次工具執行前重新判定。
  MCP endpoint 或憑證變動會使原核准指紋失效，需依當前模式重新核准；
  不承諾撤回已送出的外部操作。

## 初始化與復原

新資料目錄直接建立目前格式的 `settings.toml` 與 `mcp.json`，不讀取舊 JSON、
舊 SQLite 設定或連接器紀錄。知識資料只接受 schema 4；舊格式不會被轉換、
刪除或覆寫。預設使用 `.apsis-v4/`，原本 `.apsis/` 不讀取、不修改；
`APSIS_DATA_DIR` 可指定自訂資料目錄，工作資料夾預設位於該目錄的 `workspace/`。

設定檔格式錯誤會阻止啟動。若檔案遺失但 `.initialized` 還在，請恢復完整備份
或把 `.bak` 複製回正式檔名；不會靜默建立空白設定。復原完整資料時須停機，
一起還原 SQLite、state.json、設定、run journals、scratch 與工作檔案。

## 實作與驗證

`ConfigFile` 管理鎖、內容版本與原子寫入；`ConfigStore` 管理 TOML 與模型映射；
`McpConfig` 管理 MCP JSON。SettingsService 和 Connections 使用同一設定來源。

測試涵蓋目前資料格式驗證、固定 ID、註解與引號、外部編輯衝突、寫入失敗、
無效/遺失檔案保留、環境變數憑證、HTTP MCP headers 和核准失效。
既有設定頁瀏覽器測試驗證儲存、跨視窗同步、衝突、模型參數及 Bot 工具選取。
