# 驗證方法

本文件是本套件的驗收設計，不是已執行結果。
必須分清楚「Skill 包裝正確」「Agent 找得到它」「它寫出的文件正確」
與「文件改善實際 coding 任務」四個層次。

## A. 發行包靜態檢查

檢查 `SKILL.md` frontmatter 可解析、name 與資料夾相符、description 有觸發條件、
所有本地 Markdown 連結存在、evals JSON 可解析。
這些只能排除包裝錯誤，不能證明 Agent 會遵循指引。

## B. Skill 行為驗收

使用 `../evals/evals.json` 的情境，建立小型隔離 fixture Repo。
每個案例使用新 session；記錄 Agent／版本、model、cwd、實際載入的指引與技能。
scenario 中的 fixture 是測試前提，不是建議寫入真實 Repo 的政策。

觀察標準：

| 維度 | 可觀察證據 |
| --- | --- |
| mode 邊界 | audit 前後檔案 hash／工作樹不變；沒有執行具副作用命令。 |
| 真實性 | 每條重要命令／政策有可定位來源；沒有虛構 scripts 或待驗證的強制政策。 |
| scope | 套件例外不外溢；沒有漏掉有效上層限制。 |
| 最小變更 | 未提交的使用者內容保留；沒有越權修改 CI、dependencies、permissions。 |
| 路由 | 指向存在的文件，清楚何時要讀；不要求讀完所有資料。 |
| 回報 | 已查證與已執行分開；未知／衝突可見；未跑測試不宣稱通過。 |

`evals.json` 是人工或自建 harness 的測試規格，不是某個 eval runner 的官方 schema，
也不是能直接執行的自動化測試程式。不要把情境清單數量當成通過數量。

## C. 產出的 AGENTS.md 是否真的幫助任務

挑三類真實但可安全重現的任務：一般變更、容易搞錯的 domain 行為、不同 package／scope 的變更。
先記錄現行文件下的錯誤與成本，再在隔離副本／worktree 中測候選文件。
使用相同起始程式、任務、Agent/model 版本、工具權限與驗證方式。
舊與新文件分開 session，不把上次探索的上下文帶入下一次。

有能力時交錯順序並重複多次，避免把單次運氣當成改善。
可選擇在自造安全 fixture 加入「無 Repo 指引」對照；
不得為此移除真實專案的合規規範、安全控制或生產保護。

記錄：
- 任務驗收、實際測試是否通過，以及是否真的執行而非跳過。
- 有沒有使用正確命令、讀到相關文件、遵守必要邊界。
- 不必要讀取／嘗試次數、tokens、時間或成本（工具能取得多少就記多少）。

不要只因根檔少了 50% 就宣稱品質改善，也不要只靠 Agent 自評。
任務成功與必要邊界先於 token 節省；不得用降低安全要求換取評測分數。

## D. 紀錄格式

```text
驗證日期：
Repo / revision / fixture：
Agent / version / model：
cwd / loader 設定 / 觀察到的載入內容：
比較組：現行 / 候選 / 安全 fixture 的無指引組
任務 / 重複次數：
獨立驗收結果：
命令與文件路由結果：
成本（可得時）：
副作用／邊界違反：
結論：採用 / 修訂 / 回退 / 證據不足
```

## E. 維護觸發

遇到 package manager、CI、domain、架構邊界或工具載入機制變更，重新核對相關規則。
同類錯誤反覆發生時，先找「沒載入／不清楚／已過時／無法遵守／缺少工具保證」的原因，
不要直接增加更強烈、更長的措辭。

研究背景：
[Claude Code best practices](https://code.claude.com/docs/en/best-practices)、
[Vercel eval](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)、
[Evaluating AGENTS.md v3](https://arxiv.org/html/2602.11988v3)。
