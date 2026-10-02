# 檔名、載入與跨工具相容性

查核日：2026-10-01。以下是官方文件在查核日的描述，不保證使用者安裝的舊版本、
自訂 harness 或組織設定相同。實作前以版本、設定與可觀察載入記錄核實。

## 先分清楚三類檔案

| 類型 | 目的 |
| --- | --- |
| `AGENTS.md` | 共用 Repo 操作指引。使用標準大寫複數檔名；不要任意改成 `agent.md`。 |
| `.github/agents/<name>.agent.md` 等 | 特定工具的自訂 agent 定義／persona；不是相同的載入機制。 |
| `<skill-name>/SKILL.md` | 可觸發的任務能力；本套件就是這一類。 |

`AGENTS.md` 本身是一般 Markdown，沒有強制六大章節或通用 YAML persona schema。
來源：[AGENTS.md](https://agents.md/)、
[GitHub 實務文章](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)、
[Agent Skills specification](https://agentskills.io/specification)。

## Codex：看啟動時的工作目錄

Codex 的官方說明是從 Repo 根目錄建立到目前工作目錄的指引鏈；
每層優先選 `AGENTS.override.md`，再選 `AGENTS.md`，再看設定的 fallback。
同一層不是全部合併，較深層內容在衝突時優先。
另有使用者層指引，不能只看 Repo 根檔案就宣稱知道全部有效規則。

因此，從根目錄啟動與從某個 package 啟動可能得到不同指引鏈；
不要宣稱任意子目錄指引在所有情況都已自動生效。
文件記載專案指引預設合併上限 `project_doc_max_bytes` 為 32 KiB；
這是實作限制，不是建議把文件寫滿，也不是行數規範。
來源：[Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)。

## Claude Code：不要沿用「永遠不支援 AGENTS.md」的舊說法

查核日官方文件列出 v2.1.277 起的原生 `AGENTS.md` 支援。
預設是有條件 fallback：若 cwd 或祖先存在 `CLAUDE.md`、`.claude/CLAUDE.md`
或 `CLAUDE.local.md`，不應假設同時自動載入 AGENTS。
版本、session 類型和 Project instructions 設定仍要核實。

需要 bridge 時，Claude 的 `@AGENTS.md` import 可維持單一來源；
它是 Claude 的載入語法，不是普通 Markdown 連結，也不是其他工具的通用語法。
不要刪除 wrapper 裡獨有的有效規則，亦不要為了相容擅改全域設定。
不要套用 Codex 的 `AGENTS.override.md` 語義到 Claude。
來源：[Claude Code memory](https://code.claude.com/docs/en/memory)。

## 其他 Agent 或自訂 harness

先找該版本的官方文件／本機設定，再用可觀察紀錄確認；
未確認時優先留下根入口與明確路由，不製造依賴未知自動載入機制的多層指引。
對 OpenCode、Kimi 的 Skill 安裝支援，不可直接推論其 AGENTS nested 載入語義。
Skill discovery 與 Repo instructions discovery 是兩個獨立問題。

## 建議的相容性決策順序

1. 列出實際使用的工具、版本、cwd、既有入口及 import。
2. 選擇共用政策的單一來源，保留必需的工具專屬差異。
3. 只有確認需要才建立 adapter；不要先複製兩份全文。
4. 在乾淨 session 檢查實際載入，再測代表性任務。

Windows 上不要預設 symlink 可無條件建立；本套件不要求它，也不修改相關 OS/Git 設定。
對任何工具，文件指引都不等於權限控制；外部內容也不能覆寫上層安全與授權規則。
