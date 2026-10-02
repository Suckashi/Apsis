# 發行包驗證紀錄

日期：2026-10-01。版本：1.0.0。

## 已執行：靜態檢查

以下 32 項檢查通過。它們不代表 Agent 行為測試通過。

| 檢查 | 結果 |
| --- | --- |
| SKILL.md 以 YAML frontmatter 開頭 | PASS |
| name 與目錄名一致 | PASS |
| name 符合可攜命名格式與長度 | PASS |
| description 非空且不超過 1024 字元 | PASS |
| metadata 為字串對字串 | PASS |
| 未使用非標準控制欄位 | PASS |
| 核心少於建議的 500 行 | PASS |
| 三種模式均有明確說明 | PASS |
| 七種取捨分類均存在 | PASS |
| 存在未執行與未驗證的揭露要求 | PASS |
| README.md 沒有殘留聊天引用代碼 | PASS |
| README.md code fence 成對 | PASS |
| SKILL.md 沒有殘留聊天引用代碼 | PASS |
| SKILL.md code fence 成對 | PASS |
| 本地連結有效：SKILL.md → references/templates.md | PASS |
| 本地連結有效：SKILL.md → references/compatibility.md | PASS |
| 本地連結有效：SKILL.md → references/evaluation.md | PASS |
| 本地連結有效：SKILL.md → references/source-notes.md | PASS |
| references/compatibility.md 沒有殘留聊天引用代碼 | PASS |
| references/compatibility.md code fence 成對 | PASS |
| references/evaluation.md 沒有殘留聊天引用代碼 | PASS |
| references/evaluation.md code fence 成對 | PASS |
| references/source-notes.md 沒有殘留聊天引用代碼 | PASS |
| references/source-notes.md code fence 成對 | PASS |
| references/templates.md 沒有殘留聊天引用代碼 | PASS |
| references/templates.md code fence 成對 | PASS |
| 案例 JSON 標示尚未執行 | PASS |
| 10 個案例且 ID 唯一 | PASS |
| 各案例有前提、提示、驗收與失敗條件 | PASS |
| 含一般 coding 不觸發的負向案例 | PASS |
| 論文引用固定至已核實的 v3 | PASS |
| 包中沒有可執行檔或 symlink | PASS |

核心 SKILL.md：138 行。Description：223 字元。
未使用模型 tokenizer 計算 tokens；不宣稱已驗證 token 上限。

## 尚未執行

未在 Codex、OpenCode、Kimi Code、Claude Code 中執行端到端測試。
未讀取或修改使用者的實際 Repo。
10 個案例是驗收規格，不是 10 個通過的測試。
未測量任務成功率、推論成本或 tokens 改善。

## 打包

ZIP 建立後以 Python zipfile 檢查 CRC，並逐一比對封包內位元組與本地原檔。
只包含 Markdown 與 JSON；沒有安裝程式、外部依賴或自動執行腳本。
