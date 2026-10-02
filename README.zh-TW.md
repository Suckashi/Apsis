# Apsis

[English](README.md) · [入門指南](docs/getting-started.zh-TW.md) · [文件索引](docs/README.md) · [版本發佈](https://github.com/Suckashi/Apsis/releases)

[![Test](https://github.com/Suckashi/Apsis/actions/workflows/test.yml/badge.svg)](https://github.com/Suckashi/Apsis/actions/workflows/test.yml) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Apsis 是本機優先的個人助理：一段持續對話，加上可獨立執行的背景工作。**

背景工作進行時仍可聊天；工作卡可展開查看、補充指示或停止指定工作。重要進度、決策和結果保持可見，工具細節預設收合。48 款原始頭像全部可直接選用。

開發分支使用新的 schema 5 資料目錄；重大或未知影響的操作，即使在自動模式也需要當次核准。詳見[單一助理設計與限制](docs/single-assistant.md)。以下標記版本早於本次改版。

![Apsis 對話畫面，包含完成的報告與可下載成果](docs/assets/single-assistant/desktop.png)

_實際桌面介面，以隔離示範資料和固定模型替身拍攝；這不是外部模型的能力評測。_

## 目前狀態

**Alpha：`v0.2.0-alpha.2`。** Apsis 持續開發中，目前以本機、單一使用者為範圍。Alpha 期間資料格式與公開 API 可能變動，每次發佈都需說明不相容變更。詳見[已知限制與路線圖](docs/roadmap.md)、[版本與備份政策](docs/releases.md)。

唯一執行引擎是 **Deep Agents**，支援 OpenAI、Anthropic、Ollama 與 OpenAI 相容端點。模型服務由使用者提供，API 供應商可能按請求計費；固定模型替身的測試不能代表所有真實模型或端點的表現。

## 安裝與啟動

需要 **Node.js 22.19 以上**與 npm。CI 基準為 Windows／Ubuntu 搭配 Node.js 22.19；macOS 尚未納入 CI 驗證。下載程式庫需要 Git；Windows 的 Git for Windows 同時提供 Shell 工具使用的 Bash，Linux 使用系統 Bash。沒有 Bash 時，其他工具仍可使用。

```sh
git clone --branch v0.2.0-alpha.2 https://github.com/Suckashi/Apsis.git
cd Apsis
npm ci
npx playwright install chromium
npm start
```

Linux 若缺少瀏覽器系統套件，使用 `npx playwright install --with-deps chromium`。瀏覽器工具需要安裝 Chromium，基本聊天可以先使用。也可從[版本頁](https://github.com/Suckashi/Apsis/releases)下載原始碼 ZIP，解壓縮後在該目錄執行相同 npm 指令。本版提供原始碼，尚無桌面安裝程式或 npm 發佈套件。

開啟 <http://localhost:3100>，在「設定與工具 → 模型連線」新增連線，測試串流與工具呼叫，並設為預設。選取初始 Bot 或建立一位，傳送：

> 請在目前工作資料夾建立 `hello.md`，寫一小段 Apsis 的介紹，發布成可下載成果，最後簡短說明你檢查了什麼。

成功的標準是：檔案可讀、成果可下載、操作紀錄可展開，重新整理後對話仍在。[入門指南](docs/getting-started.zh-TW.md)提供完整步驟、設定與故障排除。開發時可下載預設分支，執行 `npm ci` 後使用 `npm run dev`。

## 可以做什麼

| 工作流程           | 範例                                                           |
| ------------------ | -------------------------------------------------------------- |
| 修改既有專案       | 連結工作資料夾，請 Bot 修改一項需求，再查看檔案與 Git 差異。   |
| 整理資料並產出成果 | 附上來源資料，請 Bot 製作報告，預覽或下載已發布成果。          |
| 固定時間交辦       | 建立含時區的排程，先試跑，再查看每次結果；Apsis 必須持續執行。 |

Deep Agents 原生 `task` 僅處理同次執行內的暫時子代理；`start_background_work` 建立獨立、持久的背景工作階段。原生 `execute` 已停用，主機命令一律使用有核准與記錄的 Shell。

製作靜態網頁時，`verify_web` 可操作真實瀏覽器，檢查項目隱藏、勾選狀態及重新整理後的狀態。重試限制依實際失敗的檢查計數，其他檢查失敗不會提早中止 Bot 工作。
`publish_file` 僅在 HTML 入口使用 `assets` 打包本機資源；發布 Markdown 等單檔成果時省略 `assets`，即可取得獨立成果卡。

## 資料與執行範圍

預設資料目錄為 `.apsis-v5/`，包含設定、對話資料庫、記憶、成果、瀏覽器狀態與預設工作區。可在選用的 `.env` 中設定 `APSIS_DATA_DIR`。連結到目錄外的既有專案仍留在原處，需要另外備份。

API key 由伺服器讀取，設定也可引用環境變數。使用外部模型時，必要的任務背景仍會傳送到所選模型服務；本機優先指應用程式的儲存與執行位置。資料目錄及備份應視為私人資料保管。

Shell 在主機執行，核准與路徑規則不是作業系統沙箱。連接工具前請閱讀[核准模式](docs/approval-modes.md)與[安全範圍](SECURITY.md)。重啟後未完成工作標為中斷，不會自動重播外部操作。完整備份需先停止 Apsis，依[備份與還原流程](docs/releases.md#backup-and-restore)操作。

Shell 以 UTF-8 記錄指令輸出；透過 Shell 啟動的 Python 也以 UTF-8 輸出至管線。

本版只接受 schema 5；舊 `.apsis/` 保留，不自動匯入。

## 參與與驗證

從[貢獻指南](CONTRIBUTING.md)、[架構分工](docs/architecture.md)與[適合入門的工作](docs/roadmap.md#contribution-entry-points)開始。一般問題透過 [Issues](https://github.com/Suckashi/Apsis/issues/new/choose)回報，漏洞請[私下回報](https://github.com/Suckashi/Apsis/security/advisories/new)。

```sh
npm run check:docs
npm run build
npm test
npm run test:chat:browser
npm run test:bots:browser
npm run test:settings:browser
```

瀏覽器驗證使用隔離資料與固定模型替身。備份還原整合測試驗證停止後的完整資料、已發布成果與對話保存；真實模型與獨立使用者的驗收另列於 [Alpha 驗收](docs/alpha-acceptance.md)。

## 授權

Apsis 採用 [Apache License 2.0](LICENSE)。內含的 Kimi Bash 程式碼保留 MIT 授權，詳見 [NOTICE](NOTICE) 與[第三方聲明](THIRD_PARTY_NOTICES.md)。
