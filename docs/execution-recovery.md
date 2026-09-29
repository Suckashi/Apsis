# 執行重試與工具回饋

Apsis 使用 Deep Agents 的單步模型與工具 middleware 處理恢復，不重新執行整個任務。

- 尚未產生串流輸出的模型請求遇到暫時性網路問題、408、429、500/502/503/504/529 時，最多額外重試三次。等待時間為 0.5、1、2 秒；供應商 Retry-After 優先，單次上限 30 秒。
- 已輸出部分內容、授權或參數錯誤、取消操作不自動重試。停止按鈕可取消等待。摘要模型目前維持原本的錯誤處理。
- 工具錯誤會以 ToolMessage 回傳模型，使其修正參數或換用適合的工具。同一工具的相同參數失敗三次後，第四次執行前停止。實際工具操作不由重試器重播，權限檢查仍在每次操作時執行。
- 內建 scratch、計畫及工作區工具都有操作紀錄；scratch 的操作名稱以 scratch\_ 區別真實工作區。紀錄包含工具、目標、起訖狀態、錯誤或有長度上限的結果，經現有敏感資訊遮蔽流程保存。
- 執行中的工具紀錄預設展開，顯示最新五項，可收合或顯示更早紀錄。完成後收回回覆摘要內。模型重試也會出現在紀錄中。
- 使用者的程式或文件成果應透過 workspace_write_file 建立；scratch write_file 只用於暫存，接受 /notes.txt 等虛擬路徑。

設計參考（2026-09-27 查閱，獨立實作，未複製上游程式碼）：

- [Kimi Code 的單步重試及事件傳遞](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/soul/kimisoul.py)：限制單步嘗試次數，等待期間送出重試事件。
- [OpenCode 的重試分類與等待時間](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/retry.ts)：區分暫時性錯誤，尊重 Retry-After 並限制等待。
- [OpenCode 的工具生命週期](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts)：工具呼叫、完成及錯誤更新各自的狀態。

驗證使用本機模型替身：錯誤 scratch 路徑 → 模型修正 → 真實工作區寫檔；寫檔後模型 API 503 → 重試成功且不重複寫檔。另覆蓋重試次數、取消、部分串流及相同工具參數失敗上限。

## 工作過程

Bot 在重要工具步驟前提供簡短的公開進度說明。這些說明與工具操作按發生順序保存在 run journal 的 timeline；工具狀態更新會更新同一筆操作，不另增重複列。說明不包含模型推理區塊或內部摘要。

對話中以說明段落穿插工具群組呈現。工具群組預設顯示摘要，展開後可查看目標、輸出與錯誤；較早紀錄可逐步展開。最終回答只保留最後一段成果，過程留在可追查的工作紀錄。舊紀錄若沒有保存進度說明，仍顯示既有操作，不補造過程。
