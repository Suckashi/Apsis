# 模板與取捨範例

這些是本套件設計的示例，不是已查證的使用者 Repo 規範。
禁止直接把 `<...>` placeholder 或「範例設定」變成正式政策。
不適用的章節直接省略；不要為了模板建立空白文件。

## 1. 最小根入口骨架

```markdown
# Agent instructions

<一句話說明這個 Repo 的用途，以及必要的系統邊界。>

## Commands

- 在 `<工作目錄>` 執行 `<實際查到的命令>`。
  前提：<真正需要的條件>。通過訊號：<可觀察結果>。

## Constraints

- <會改變行為、已確認的跨 Repo 約束>。
- <不可逆操作需要何種授權，以及允許的替代做法>。

## Read when relevant

- 當 <觸發條件>，先讀 `<真實路徑>` 的 <標題>，再 <要做的工作>。
```

章節順序可依風險調整。高後果邊界可以放在 commands 前面。
根目錄不需要角色人設、宣誓、通用 React 教學、完整工具 API 或每次任務的日誌。

## 2. 正反對照

| 不佳內容 | 較好的寫法／處置 |
| --- | --- |
| 「撰寫乾淨、可維護、高品質的程式碼。」 | 刪除空泛口號；有實際例外才寫，例如某個跨層 import 禁止規則及理由。 |
| 「這是 TypeScript 專案，請使用 TypeScript。」 | 通常能從檔案確認；若沒有具體誤用風險，不占根入口。 |
| 「所有開發必須先讀完 docs 下全部文件。」 | 「修改權限判斷前，先讀 `CONTEXT.md` 的 Permission semantics。」只在該路徑與章節存在時使用。 |
| 「一律執行 npm test。」 | 先確認 scripts／workspace／lockfile；寫真正存在的目標與 cwd，沒有就回報缺少驗證途徑。 |
| 「改 generated/ 的程式碼。」 | 若已確認為生成內容，說明真正的來源及生成流程；未找到流程時回報，不猜測 generator 指令。 |
| 根檔案複製 200 行 formatter 規則。 | 指向現有 formatter 設定與檢查命令；不要順便改設定。 |
| 「絕不可改測試。」 | 核對意圖：通常需區分不得竄改評測來掩飾失敗，與合法增補 regression test；無法核實就列決策。 |
| 「每次失誤都在末尾新增一條規則。」 | 找根因；優先補測試／改善既有條文，再去除相似或失效內容。 |

## 3. 自造前端 Repo 範例

**以下假設純屬示範，不代表使用者專案。**
證據假設：根 `package.json` 有 `check:types` 與 `test:unit`，使用 pnpm；
`CONTEXT.md`、`docs/adr/0007-layer-boundaries.md` 已存在且含對應章節；
團隊已確認生成檔不得手改。任何假設不成立，就不能照貼。

```markdown
# Agent instructions

這個 Repo 提供內部知識查詢介面。

## Validation

在 Repo 根目錄執行：
- `pnpm run check:types`：型別檢查，需既有依賴；以 exit code 0 為通過。
- `pnpm run test:unit`：單元測試，需既有依賴；確認測試真的執行且全部通過。

## Constraints

- 不手改 `src/generated/`；修改來源定義後走既有生成流程。
  找不到生成命令時回報，不自行猜測。

## Read when relevant

- 修改詞彙或權限行為前，先讀 `CONTEXT.md` 的 Domain rules。
- 新增跨層 import 前，先讀 `docs/adr/0007-layer-boundaries.md`。
```

範例未聲稱以上命令已實際跑過。產生真實檔案時，執行狀態另列在交付報告。

## 4. 路由到既有 Workflow Skill

只有確定 skill 已存在、目標 Agent 可取得時才寫，例如：

```markdown
- 進入功能實作與驗證流程時，使用已安裝的 `dev-workflow-tdd` Skill。
  若無法載入，回報缺少的能力，不假裝已執行該工作流。
```

不要把 Skill 全文嵌回 AGENTS.md。對跨工具 Repo，不把某個工具專用 slash command
當成所有 Agent 都能呼叫的標準命令。

## 5. 證據與取捨表

| 候選內容 | Repo 證據 | 決定 | 理由 | 狀態 |
| --- | --- | --- | --- | --- |
| 使用某套件管理器 | manifest 與 lockfile | KEEP-ROOT 或 DROP | 是否為非預設且曾造成誤用 | 已查證，未執行 |
| 詳細 domain 規則 | 既有 domain 文件 | MOVE-DOC | 僅特定變更需要 | 已查證 |
| 不得更新資料庫 schema | 無依據的口述推論 | NEEDS-DECISION | 涉及團隊政策，不能從單次任務推廣 | 未知 |
| 詳細縮排規則 | formatter 設定 | ENFORCE-TOOL | 已有機械保證 | 已查證 |

這張表用於審核報告，不應整份變成每個 session 永久載入的內容。

## 6. 交付報告骨架

```markdown
## 結果
模式：audit / create / refactor
檢查範圍：...
實際變更：...（audit：沒有寫檔）

## 關鍵取捨
| 內容 | 決定 | 證據 | 原因 |
| ... | ... | ... | ... |

## 驗證
靜態檢查：...
載入檢查：已執行 / 未執行
命令驗證：已查證 / 已執行通過 / 失敗 / 未執行
行為驗收：已執行 / 未執行

## 未解決事項
...（不把這些疑問寫成正式政策）
```
