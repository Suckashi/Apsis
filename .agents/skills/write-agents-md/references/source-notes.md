# AGENTS.md 寫作研究與來源筆記

查核日：2026-10-01。這是多來源綜合後的設計，不是客觀排名，也不宣稱存在所有 Repo 通用的最佳模板。
採官方文件、作者本人文章與研究論文為主；不把社群轉述當成標準。
Boris 的貼文另註明使用公開鏡像核對。

## 一、標準與官方操作規範

### S01 — AGENTS.md 官方

來源：<https://agents.md/>

它提供通用的 Markdown 入口概念，不要求固定章節。採用專案指令、必要約束與適用範圍；
不把任何單一作者的模板升格成官方 schema。實際載入仍取決於各工具。

### S02 — Anthropic：Claude Code best practices

來源：<https://code.claude.com/docs/en/best-practices>

採用只放必要的專案差異、刪除不影響行為的文字、持續檢查遵循效果。
官方允許 `/init` 起草後再整理；不是「自動生成即代表正確」。
這與部分作者的強烈反 `/init` 立場不同，因此本 Skill 加入逐條取證與審核。

### S03 — OpenAI：Harness engineering

來源：<https://openai.com/index/harness-engineering/>

採用把入口當成文件地圖、細節留在可維護的知識結構，避免巨大單檔。
文中的約百行入口是團隊實例，不是標準限制。本 Skill 增加文件路由與 freshness 檢查。

### S04 — Codex：AGENTS.md discovery

來源：<https://developers.openai.com/codex/guides/agents-md>

用來核實工作目錄、override、合併與大小限制；不是寫作品質排名。
本 Skill 要求核對實際載入，而不是僅因檔案存在就認定它會被讀到。

### S05 — Claude Code：Memory / project instructions

來源：<https://code.claude.com/docs/en/memory>

查核日版本已提供有條件的原生 AGENTS 支援。
舊文章對相容性的判斷不能當成現在的產品事實。細節見 `compatibility.md`。

## 二、實務作者：採用哪些觀點、保留哪些限制

### S06 — Matt Pocock：A Complete Guide To AGENTS.md

來源：<https://www.aihero.dev/a-complete-guide-to-agents-md>
文章更新日：2026-01-18。

採用小入口、按需展開、拆解矛盾、刪除空泛與重複內容。
不照搬其對當時工具支援的描述；不把「禁止自動起草」當成普遍定律。
本 Skill 保留自動檢查與起草，但要求證據和人工政策邊界。

### S07 — HumanLayer / Kyle：Writing a good CLAUDE.md

來源：<https://www.humanlayer.dev/blog/writing-a-good-claude-md>
發布日：2025-11-25；頁面署名 Kyle。

採用聚焦 WHY／WHAT／HOW、指向文件、不讓 LLM 代替 formatter。
不要把這篇誤署為 Dex Horthy 的文章；不要把其引用的 instruction 數量或行數
當成跨模型、跨工具、跨任務的硬上限。

### S08 — Boris Cherny：分享自己的 Claude Code 使用方式

原始貼文串：<https://x.com/bcherny/status/2007179832300581177>
公開鏡像：<https://threadreaderapp.com/thread/2007179832300581177.html>
日期：2026-01-02。

原始 X 全文未能直接取得，使用公開鏡像核對其團隊共用、納入 git、從錯誤更新指引的描述。
採用團隊共同維護與真實回饋；本 Skill 額外要求去重／刪除過時項目，
避免誤解成每個錯誤都永久加一條。後者是綜合設計，不是 Boris 的逐字規則。

### S09 — Addy Osmani：How to write a good spec for AI agents

來源：<https://addyosmani.com/blog/good-spec/>
發布日：2026-01-13。

這是 Agent 任務規格寫作，不是 AGENTS.md 的格式標準。
採用可驗收目標、邊界與迭代；不把每個任務的完整 spec 塞進永久 Repo 入口。

### S10 — GitHub / Matt Nigh：Lessons from over 2,500 repositories

來源：<https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/>
發布日：2025-11-19；更新日：2025-11-25。

採用具體命令、範例與 always／ask／never 行動邊界。
作者是 Matt Nigh，不是 Matt Pocock；文章包含 Copilot 自訂 agent 情境，
不能把 persona 檔的結構與六個面向視為根 AGENTS 的強制模板。

## 三、實測證據：結論為什麼不能只看作者名氣

### S11 — Vercel / Jude Gao：AGENTS.md outperforms skills in our agent evals

來源：<https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals>
發布日：2026-01-27。

在其特定 Next.js API 任務中，版本相符文件的精簡索引取得比被動等待 Skill 觸發更好的結果。
採用重要知識可被找到、測試載入與觸發機制的觀點。
不推論所有 AGENTS 都優於所有 Skills；本套件本身仍是按需執行的寫作工作流。

### S12 — Gloaguen 等：Evaluating AGENTS.md

論文：<https://arxiv.org/abs/2602.11988>
查核版本：<https://arxiv.org/html/2602.11988v3>
v1：2026-02-12；v2：2026-06-23；v3：2026-09-29（查核日最新版本）。

依 v3：Repo context files 一般未改善任務成功率，平均成本增加超過 20%；
非標準專案做法比冗長概覽更有價值。研究在其 benchmark 與工具設定下成立，
不能外推所有公司 Repo；也不證明「越短必然越好」。因此本 Skill 附行為驗收流程。

## 四、Skill 包裝與安裝依據

### S13 — Agent Skills specification

來源：<https://agentskills.io/specification>

採 `SKILL.md`、name／description frontmatter 與按需 references。
本套件的三個模式、證據分類、文件結構和行數警訊是自行設計，不是該標準規定。

### S14–S17 — 各工具 Skills 官方文件

- Codex：<https://developers.openai.com/codex/skills>
- OpenCode：<https://opencode.ai/docs/skills/>
- Kimi Code：<https://moonshotai.github.io/kimi-code/en/customization/skills>
- Claude Code：<https://code.claude.com/docs/en/skills>

用來核實安裝路徑與手動呼叫方式，不代表本套件已於四個工具完成端到端測試。

## 五、最後採取的綜合原則

| 分歧／風險 | 本 Skill 的決策 |
| --- | --- |
| 能不能讓 Agent 自動寫？ | 可以自動起草；不得把推測當政策，必須取證、刪減與揭露未知。 |
| 要不要放完整 Repo 地圖？ | 只保留穩定且能避免走錯的必要定位；詳細地圖用可維護文件，不預設全刪或全留。 |
| 文件越短越好？ | 不成立；先確保內容必要，再減少重複。行數是審核訊號，不是品質分數。 |
| 學到的教訓都永久追加？ | 先修既有規則／補工具驗證，再考慮最小增補，同時清理過期內容。 |
| 寫完就算成功？ | 先做靜態與載入檢查；改善行為需要獨立任務測試，而非模型自評。 |
| AGENTS 還是 Skills 二選一？ | 不是；入口負責必要資訊與路由，Skill 負責有明確觸發的工作流。 |

研究內容主要保留在本筆記，不塞入產生的 Repo 入口；Repo 規則的根據必須來自該 Repo 與團隊決策。
