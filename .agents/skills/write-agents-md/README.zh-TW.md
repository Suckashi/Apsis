# write-agents-md

[English](README.md) | **繁體中文**

建立、審核與重構高品質 `AGENTS.md` 的 Skill。
先查 Repo 證據，保留必要指引，並在需要時引導 Agent 讀取既有的詳細文件。

版本：**1.0.0** · 研究查核日：**2026-10-01** · 授權：**MIT**

## 安裝

### 使用 skills CLI（推薦）

在要使用這個 Skill 的 Repo 根目錄執行：

```bash
npx skills add Suckashi/write-agents-md
```

需要 Node.js/npm 與 Git。依 CLI 提示選擇 Agent 與安裝方式。預設安裝到目前專案；加上 `--global` 可跨專案使用。

```bash
# 全域安裝
npx skills add Suckashi/write-agents-md --skill write-agents-md --global

# 在目前專案安裝給 Codex、OpenCode、Kimi Code
npx skills add Suckashi/write-agents-md --skill write-agents-md --agent codex opencode kimi-code-cli

# 在目前專案安裝給 Claude Code
npx skills add Suckashi/write-agents-md --skill write-agents-md --agent claude-code

# 只列出可用 Skill，不進行安裝
npx skills add Suckashi/write-agents-md --list
```

若環境無法建立 symlink，例如部分 Windows 設定，可在安裝指令加上 `--copy`。安裝器會處理 Skill 的相關檔案；請保留 `references/` 與 `SKILL.md`。

本 Repo 根目錄已有 CLI 可直接辨識的 `SKILL.md`。從 GitHub 安裝不需要另發 npm 套件，也不需要先登錄到技能目錄。最新參數與 Agent 支援清單見 [skills CLI 官方文件](https://github.com/vercel-labs/skills)。

### 手動安裝

將整份 Repo 內容放到對應的專案目錄：

| Agent | 專案目錄 |
| --- | --- |
| Codex／OpenCode／Kimi Code | `.agents/skills/write-agents-md/` |
| Claude Code | `.claude/skills/write-agents-md/` |

例如，在目標 Repo 根目錄執行：

```bash
git clone https://github.com/Suckashi/write-agents-md.git .agents/skills/write-agents-md
```

Claude Code 使用者將目的地改成 `.claude/skills/write-agents-md`。安裝後用 Agent 的技能清單或載入資訊確認；實際發現行為可能受版本、worktree、session 與組織設定影響。

各工具官方文件：[Codex](https://developers.openai.com/codex/skills) · [OpenCode](https://opencode.ai/docs/skills/) · [Kimi Code](https://moonshotai.github.io/kimi-code/en/customization/skills) · [Claude Code](https://code.claude.com/docs/en/skills)。

## 使用

建議第一次先審核既有指引，確認取捨後再要求修改。Skill 本體與參考文件使用繁體中文；可以要求 Agent 用偏好的語言回覆，流程會保留 Repo 原有的語言慣例。

| Agent | 明確呼叫方式 |
| --- | --- |
| Codex | `$write-agents-md` |
| Kimi Code | `/skill:write-agents-md` |
| Claude Code | `/write-agents-md` |
| OpenCode | 請 Agent 載入 `write-agents-md` Skill。 |

呼叫後可貼上：

```text
使用 write-agents-md，以 audit 模式檢查目前 Repo 的 AGENTS.md。
不要修改檔案。列出需要保留、移動、刪除或確認的內容，
每項建議附上 Repo 證據。
```

### 三種模式

模式是給 Agent 的自然語言要求，不是可執行的 CLI 參數。

| 模式 | 行為 |
| --- | --- |
| `audit` | 預設。唯讀審核，提供證據與建議 diff，不修改檔案。 |
| `create` | 核實命令與規則後新增缺少的指引，保留既有入口。 |
| `refactor` | 在授權範圍內做最小修改，保留有效約束與未提交變更。 |

```text
使用 write-agents-md，以 create 模式建立缺少的 AGENTS.md。
先核實命令與規則，沿用既有文件結構。
尚未確認的政策另列報告。
```

```text
使用 write-agents-md，以 refactor 模式精簡既有 AGENTS.md。
保留有效約束，詳細文件改成有觸發條件的路由。
不要修改程式、依賴、CI 或工具設定，也不要自行 commit。
```

## 工作流程

1. 檢查既有指引、manifest、lockfile、scripts、CI 與相關文件。
2. 建立證據紀錄，區分已查證、已執行與尚未解決的衝突。
3. 逐條判斷內容應放根入口、局部指引、文件、Skill，或交由工具檢查。
4. 產出最小入口，寫清楚命令、行動邊界與條件式文件路由。
5. 核對連結、作用域、矛盾與載入假設，回報已驗證及未驗證事項。

已有 `CONTEXT.md`、`docs/agents/`、`docs/adr/` 就沿用。可搭配 `dev-workflow-tdd`、`grill-with-docs` 等既有工作流程。

## 套件內容

| 檔案 | 用途 |
| --- | --- |
| [SKILL.md](SKILL.md) | 核心流程、模式、證據規則與行動邊界。 |
| [references/templates.md](references/templates.md) | 最小入口、條件式路由與範例。 |
| [references/compatibility.md](references/compatibility.md) | 檔案類型、載入行為與跨工具相容性。 |
| [references/source-notes.md](references/source-notes.md) | 研究來源、採用原則、分歧與限制。 |
| [references/evaluation.md](references/evaluation.md) | 靜態檢查、載入檢查與行為驗收方法。 |
| [evals/evals.json](evals/evals.json) | 10 個人工或自建 harness 的驗收情境，不是可執行的測試程式。 |
| [validation-report.md](validation-report.md) | 原始套件的靜態檢查結果與未驗證事項。 |

參考文件只在相關任務中讀取。研究結合官方文件、作者本人文章與論文；來源筆記保留署名、取捨與結論適用範圍。

## 驗證與限制

套件已做靜態結構檢查。10 個行為驗收情境**尚未**在各 Agent 或使用者的真實 Repo 中完成端到端測試；沒有宣稱任務成功率、成本或 token 用量改善。

指引負責引導行為；權限與不可逆操作的限制仍需由實際工具及執行環境保證。

## 授權

[MIT](LICENSE)。研究來源保留各作者的權利。本專案是獨立撰寫的 Skill，並非來源作者或 Agent 廠商的官方產品，也未宣稱獲得其背書。
