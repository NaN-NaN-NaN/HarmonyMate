# HarmonyMate：獨立評估與建議實作計畫

日期：2026-10-22。規劃基準約為蘇黎世／柏林 20:00 CEST；距 10/23 21:00 截止約 25 小時。這是計畫與評估，不代表功能已完成。

依據：使用者提供的完整背景、實作方案、最新產品意圖，以及實際 repo。檢查時 repo 只有標題 README，沒有可確認的程式、音訊原型或部署。官方核對詳見 [來源查核](../OFFICIAL_SOURCE_CHECK.md)。本文件以繁體中文供決策；參賽 README、UI、影片與提交內容使用英文。

## 1. 我的結論

**建議做 HarmonyMate，但要縮成「隨口開始、學一句和聲、聽見彼此」的完整體驗。不要在一天內同時建造通用和聲 AI、遠端錄音平台與原生 Echo 整合。**

你最新說的「大家聚在一起，或只有一個人，突然想唱歌，Alexa 就在身邊」比「用語音操作多軌錄音工具」更有產品吸引力。它解決的是開始唱歌的心理與操作門檻：不知道唱什麼、不敢獨唱、不會和聲，也不想拿手機找 App。

建議定位：

> **HarmonyMate turns “let’s sing” into a shared moment—with a little guidance from Alexa.**

「遠方家人合唱，送給媽媽」可以保留為證明價值的故事，但應是唱完後自然延伸的結果，不是開場就要求使用者管理專案、邀請、音軌與收件人。

最重要的限制是：**這次能交付的是真實可用的瀏覽器音訊系統與 Alexa+ 對話模擬，尚不能承諾既有 Echo 硬體直接收錄歌聲。** 如果本次成功條件必須包含「真的在實體 Echo 上、不開瀏覽器便完成錄音」，目前證據不足，這條實作路線不能滿足它。若接受競賽允許的模擬，則值得做。

## 2. 產品應該長什麼樣子

### 核心互動

1. 使用者：「Alexa, I feel like singing.」
2. 助手：「Let's try a short song. I'll teach you one line.」播放一段原創短旋律。
3. 使用者唱第一聲部，系統保存真實錄音。
4. 使用者：「Help Ben sing with me.」助手播放預編的低聲部，讓 Ben 跟唱練習。
5. Ben 戴有線耳機，聽第一聲部並錄下第二聲部。
6. 使用者：「Let us hear it together.」播放兩個人的真正混音。
7. 使用者選擇把這個版本送給 Mom；確認後，Mom 在自己的 HarmonyMate 收件匣聽見它。

最值得讓評審聽見的一刻：**原本說自己不會和聲的人，跟著一句引導唱完，下一秒聽到自己與親友合成的聲音。** 這比「AI 又生成了一條音軌」更符合你的初衷，也不需要通用音高分析。

### 三種使用情境，共用一條流程

| 情境 | 本次如何表達 | 不新增什麼 |
|---|---|---|
| 一個人 | 自己錄主旋律，再跟引導錄第二聲部 | 不加入擬真人 AI 歌手 |
| 大家同房間 | 先一起聽、練，再輪流錄聲部 | 不宣稱一支麥克風能分離每個人的聲音 |
| 親友不同地方 | 用既有專案加入第二軌，最後送出驚喜 | 不做即時遠端合唱或低延遲通話 |

不要為三種情境做三套 UI。共用「聽 → 練 → 錄 → 一起播放」。同房間自由合唱可以不錄；需要可分離音軌時仍要輪流錄音與耳機。

### Alexa+ 的價值與不足

真正的優勢是家庭場景中的低門檻入口、短句引導，以及用「我想做什麼」代替錄音術語。語音流程應真的支持「再播一次低聲部」「準備好了」「一起聽」「把我的聲音小一點」。

這些優勢是產品假設，模擬器只能證明互動設計，無法證明家庭採用率或原生整合。若使用者仍要先找網站、登入、選裝置，便尚未實現你的「Alexa 已經在這裡」願景。影片要承認這個差距。

純網站也能成立；Alexa 的長期意義在於日常入口，而不是讓錄音技術本身變得可行。短期不要為了看起來像 Alexa 而讓每次操作都必須等 LLM。

## 3. 原計畫保留與修改

| 原提案 | 決定 | 原因／修改 |
|---|---|---|
| Node/TypeScript 單一服務 | 保留 | 同一服務提供 UI、REST、agent、MCP，降低整合成本 |
| 真 MCP + 自製模擬器 | 保留為工程選擇 | 有可重用價值，但不是所有模擬參賽作品的強制條件 |
| React + Vite | 保留 | 簡單單頁介面，不引入另一套 server runtime |
| 第一時間雲端部署 | 改為第一時間驗證 Docker，本機為保底 | 雲端試部署限時，避免 ECS/IAM 吞掉音訊時間 |
| Supabase Postgres + S3 | 改為 Supabase Postgres + 私有 Storage | 單一資料供應商；若已有可用 S3 設定，才沿用 S3 |
| Bedrock + Polly | Bedrock 優先，Polly 可砍 | AWS 用途以真正的工具選擇與對話為主；語音輸出可先用瀏覽器 TTS |
| AudioWorklet | 優先採用，限時驗證 | 能取得 PCM 與音訊時鐘，並不保證硬體收音零延遲 |
| baseLatency + outputLatency 補償 | 修改 | 不是完整輸入／輸出往返延遲；需要實測校準與人工微調 |
| 每軌 wavesurfer.js 共用播放頭 | 延後 | 第一版只用一個 Web Audio 播放引擎；波形是視覺，不另設播放時鐘 |
| 同步 ffmpeg 混音工具 | 改為非同步工作 | MCP 快速回 jobId，另取狀態，避免讓混音阻塞工具回覆 |
| create_surprise(confirmed:true) | 修改 | 布林值可由模型自行填入；必須驗證伺服器保存的確認狀態 |
| 通用音高偵測 P1 | 改成賽後 | 不會讓這條短 demo 主線更完整 |
| 預編原創引導 | 保留，升為主線 | HarmonyMate 的產品辨識度來源，明確標為預編 guide tone |
| 驚喜收件匣 | 保留簡版 | 綁定確切 mix 版本，示範帳號私有存取 |
| 至少五筆 Friction | 改成如實記錄 | 不湊數，不把未嘗試的假設寫成遇到的障礙 |

## 4. 原生能力、模擬能力與未知能力

| 能力 | 本次狀態 | 對外表述 |
|---|---|---|
| 對話工具呼叫、專案權限、混音、儲存 | 必須真做 | 真實後端功能 |
| 瀏覽器收音與同步播放 | 必須真做 | Browser recording |
| Alexa+ 對話面板、語音卡片 | 模擬 | 常駐 `Simulated Alexa+ experience` |
| Bedrock 作為模擬 agent | 可真做 | Bedrock-powered simulator；不稱為真正 Alexa 模型 |
| Alexa 原生帳號辨識 | 不做 | alex / ben / mom 是 demo 身分 |
| Echo 原始麥克風 PCM、邊播邊錄 | 未取得可用整合證據 | 未實作，不能以硬體有麥克風作為 API 存在的證明 |
| Mom 在任何 Alexa 對話收到通知 | 不做 | Mom 開啟 HarmonyMate 後查詢收件匣 |
| Echo 原生媒體播放與家庭裝置相容性 | 尚未驗證 | 不聲稱已支援所有現有 Alexa 裝置 |

「沒有找到可用文件」不等於「平台永遠不支援」。賽後第一個平台工作是向 Amazon 確認音訊取得、媒體控制、支援裝置、地區與帳號整合權限，再決定是否能消除瀏覽器交接。

## 5. 最小交付範圍

### P0：必須完成

- 一首 12–20 秒原創旋律，固定節拍與兩個預編聲部。素材必須實際唱過、確認好聽。
- 首次進入一次使用者操作以啟用音訊／允許麥克風；之後以短指令引導。
- 建立或打開 song、播放示範、聽低聲部。
- 真正錄製兩個獨立 take；第二次錄製時播放第一軌。
- 原始錄音保留、音量與正負 offset 可調、生成可播放混音。
- 真 MCP 初始化、列出工具、呼叫工具；UI 顯示真實呼叫紀錄。
- alex / ben / mom 三個可測試身分；Ben 有指定專案權限。
- 分享確認、固定版本驚喜、Mom 同意後播放。
- README、環境範例、可重現啟動、影片與提交資料。

### P1：P0 跑通才做，依序

1. Bedrock 自然語言體驗與真人語音指令可靠度提升；若已順利接上則留在主線。
2. 簽章邀請連結與兌換流程，取代預設 Ben 成員關係。
3. 公開部署網址。
4. Polly、波形視覺、收件匣動畫。

Bedrock 應在第一小時試呼叫，但不讓模型權限阻止音訊開發。若最後只剩規則路由，介面與影片必須明說「scripted simulator mode」，不聲稱實測了自然語言 agent。是否參加 AWS Builder 依實際使用與回饋文件決定。

### 賽後

任意歌曲和聲、音準評分、即時 AI 歌聲、真正 Echo 收音、家庭成員聲紋辨識、排程通知、社交分享、完整版本歷史、獨立 npm 套件。

## 6. 建議架構

```text
Browser: React + Vite
  ├ Conversation / recording / recipient views
  ├ One Web Audio engine + AudioWorklet capture
  └ HTTPS REST: agent messages, recording uploads, job polling
          │
Node + Express in one Docker image (includes ffmpeg)
  ├ /api/agent → Bedrock Converse or explicit scripted mode
  │              → MCP client → /mcp (Streamable HTTP)
  ├ /mcp → validated tools → domain services
  ├ REST → same domain services + upload validation
  └ Small job runner → ffmpeg → private audio storage
          │
Supabase: Postgres + private Storage
```

這是單一部署服務，不是所有程式塞進單一檔案。建議只分 `web/audio`、`web/views`、`server/agent`、`server/mcp`、`server/domain`、`server/jobs`。避免自己建立微服務與通用 workflow framework。

### MCP 邊界

| Tool | 用途 | 重要約束 |
|---|---|---|
| `create_song` | 建立固定曲目專案 | idempotency key 綁定 actor 與輸入 |
| `get_song` | 回傳軌道、可用 guide、目前 mix | 僅成員；清單功能可之後加 |
| `get_harmony_guide` | 取得指定聲部／句子的音訊 | 標記 curated guide，非從使用者聲音自動推導 |
| `start_recording_session` | 建立短效錄音授權 | 回 token/card；不是從 MCP 直接開麥克風 |
| `set_track_mix` | 音量、靜音、正負 offset | 僅允許專案授權軌道，檢查數值範圍 |
| `create_mix` | 建立混音工作 | 快速回 jobId；以軌道版本與參數去重 |
| `get_mix_status` | 查工作狀態與結果 | 簽章播放 URL 於授權讀取時產生 |
| `create_surprise` | 準備／提交分享 | 伺服器確認記錄、mixId、recipientId 必須吻合 |
| `list_surprises` | 查本人收件匣 | 不接受任意 actorId 代查 |
| `reveal_surprise` | 同意後取得播放資訊 | 僅收件人；opened 與 played 狀態分開 |

`invite_contributor`、`list_songs` 是延伸，不要讓工具數量成為目標。上傳經 REST 完成，伺服器驗證檔案後才登記 take；不要讓 LLM 提交任意 URL 就成為有效音軌。

固定 SDK 版本與 lockfile，實際測試協商到要求的 protocol version。工具 schema 用 zod，annotations 如實設定 readOnlyHint、destructiveHint、idempotentHint；這些提示不能代替權限控制。保留 initialize、tools/list、tools/call 的測試證據；只 import SDK 或在畫面印出假 log 都不算本方案完成。

### 身分、確認與資料

- 瀏覽器 demo 登入由伺服器發 session；actor 由驗證後的 session/token 決定，不能由 prompt 或工具參數決定。
- 只允許合成測試資料。公共 demo 的三個帳號可被評審使用，因此不能宣稱它是適合真實家庭資料的正式身分系統。
- 模擬器呼叫自身 MCP 時攜帶短效、綁定 actor 的伺服器簽發 token；token 不放進 LLM context。
- 靜態 Bearer 是 demo 認證，不等於完成 Alexa 原生 OAuth onboarding。Alexa 特定 401 行為與標準 MCP OAuth 要分別核對，不混稱全面相容；詳見來源查核。
- 先讓 `create_surprise` 回待確認摘要：收件人、固定 mix 版本、可存取內容。使用者在明確確認狀態按確認，或由語音互動層記錄對該摘要的肯定回應，再給一次性確認憑證。模型自填 `confirmed:true` 無效；不能讓「幫我做一首歌」等同同意分享。
- 最小資料：users、songs、song_members、takes、mix_jobs/mixes、surprises、pending_confirmations。邀請加入時才增加 invitations。
- mix 保存 take ID、gain、offset 的不可變快照。驚喜綁 mixId，不能使用會隨後續錄音變動的 `latestMix`。
- 原軌私有存放，短效 URL 到期重新授權取得。URL 是暫時存取憑證；不要寫入公開 log。
- 上傳限制時長、大小、聲道與可接受格式；伺服器解碼驗證。ffmpeg 用參數陣列執行，不拼接使用者 shell 字串。

### 混音工作

一個 process 內的 runner 足夠；工作狀態保存在 DB，限制同時執行數。process 中斷後，逾時 running 工作可恢復為可重試狀態。不要只把 job 放在記憶體，也不需要此刻加 Redis。

Alexa+ QuickStart 的查詢往返延遲要求小於 500 ms；因此慢工作應快速回工作識別碼，而非等待完成。這也不代表採用 job 就自動達標：實際部署仍須量測網路、資料庫與冷啟動成本。細節見來源查核。

單一容器是預期運行模式。若雲端會多副本執行，必須用 DB 原子 claim／lease，不能靠「應該只會開一台」避免同一工作重複跑。對短音檔設定處理 timeout；失敗顯示可重試，不讓 UI 永久轉圈。

## 7. 音訊是第一關，驗收要可觀察

### 時鐘與延遲

AudioWorklet 的價值是取得音訊處理執行緒中的 PCM 與取樣位置；`baseLatency` 和 `outputLatency` 涵蓋的輸出路徑並非整個麥克風往返路徑。不要用兩者相加就宣稱同步精確。[Web Audio 規範](https://www.w3.org/TR/webaudio/)

實作決策：

1. 同一 AudioContext 解碼、排程所有參考音與錄音起點；參考檔先載入，倒數後在未來時間 T0 同步開始。
2. 保存 sampleRate、首個捕捉 frame 相對 T0 的位置、take 長度、裝置校準量。不要用 JS callback 到達時間當成實際收音時間。
3. 關閉回音消除、降噪、自動增益是請求，不保證每個裝置都接受；讀取實際 settings，避免虛假的硬體保證。
4. 校準只估計錄放路徑延遲，不「修正」演唱者本人的節奏。加入一個正負 offset 滑桿，定義正值＝延後，負值＝提前。
5. 正 offset 以 delay 處理；負 offset 需要裁掉起始樣本並重設 timestamp，不能只用 adelay。統一 sample rate、單聲道、增益、amix 與 limiter。
6. 唱歌時暫停指令 STT 與 TTS，避免歌詞變成命令或助手聲音進入 take。錄音固定長度自動結束，另保留明確停止按鈕。
7. 預設有線耳機；不承諾 Bluetooth、跨瀏覽器與不同音效驅動都能有同樣表現。

### 第一關驗收（最多約 2 小時）

- 先以可重現的合成 click 檔測 offset 算法，再以實際錄放 loopback／聲學校準確認裝置行為。人的拍手只能輔助聽感，不能當精密延遲真值。
- 同一 demo 裝置連錄三次短片段，校準後起點殘差目標不超過 30 ms；片段前後不出現明顯漂移。這是本專案門檻，非平台保證。
- 戴耳機錄第二聲部時，獨聽新 take 不應含明顯第一聲部串音；混音可聽到兩個獨立人聲。
- 重新錄製建立新 take；舊檔 checksum 不變。
- UI 重播與伺服器輸出對相同 offset 的效果一致。

如果 AudioWorklet 實作卡住，先評估 MediaRecorder + 解碼 + 校準是否足以通過同一驗收；不能只因不是 Worklet 就排除可用方案，也不能放寬到剪影片假裝成功。

若疊錄仍失敗，退回「同房間分句教唱＋大家一起唱」是**改變交付產品**，必須同步刪除獨立軌、遠端疊錄的對外宣稱。這仍符合你最新產品意圖，但不等同原本完整協作方案。

## 8. 模擬器與 AWS

首頁只放主指令、目前狀態、一張主卡片與播放／錄音控制；進階設定收起。不必複製 Echo Show 外觀，更不必用 Amazon 商標讓畫面看似官方。大字、清楚的正在聽／正在錄／正在播放，會比卡片動畫更有用。

Bedrock loop：讀取已授權上下文 → 模型選工具 → MCP 呼叫 → 回工具結果 → 短回覆。限制每回合工具數、timeout 與重試；重要寫入都做 idempotency。沒有 active song 等必要資訊時應追問或顯示選項，不猜私有資源 ID。

現在就用目標 AWS account、region、model 做一次實際 Converse tool-use 測試。原計畫的「必須先在 console 開模型存取」不是所有模型的通則；官方說明許多模型在具備所需權限時預設可用，部分仍有額外前提。以實際 API 結果為準。[Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)

規則路由只處理明確支援的指令，同樣經 MCP、權限與確認機制。Bedrock 失敗時顯示降級提示；不要靜默切換後繼續把它描述為模型完成。

Web Speech 輸入與瀏覽器 TTS 先在 demo Chrome 上驗證；文字輸入與按鈕永遠可用。Polly 僅在音質確實能提升影片且時間足夠時加入。不可讓語音辨識、原始歌聲錄音、TTS 同時搶控制權。

## 9. 25 小時排程：包含睡眠與提交

以下從 10/22 約 20:00 起算；若開始時間已晚，砍 P1，不借用提交緩衝。約 13 小時開發、6 小時睡眠、4 小時影片／文件、2 小時提交緩衝，沒有容納原方案全部功能的空間。

| 蘇黎世時間 CEST | 交付／關卡 | 失敗處理 |
|---|---|---|
| 10/22 20:00–22:00 | 原創素材、雙軌錄音 spike、Bedrock 一次測試；第一關 | 疊錄失敗即啟動同房間教唱簡版 |
| 22:00–00:00 | Docker、MCP 初始化與核心工具、DB／私有 Storage、最小身分 | 雲端試部署最多 45 分鐘；失敗保留本機 Docker 路徑 |
| 10/23 00:00–02:00 | take 上傳、mix job、播放混音、重錄保留 | 削除波形與邀請，確保兩個真實軌道 |
| 02:00–08:00 | 睡眠 | 不把長任務成功寄託在無人確認的執行結果 |
| 08:00–11:00 | 對話、guide、三身分、分享確認與收件匣；第二關 | 兩人→混音→Mom 必須通；否則縮小展示故事 |
| 11:00–13:00 | 權限、重試、乾淨啟動、實際工具證據 | 修阻塞，不加新服務 |
| 13:00–15:00 | 緩衝、可選部署或邀請、影片預演 | 15:00 功能凍結 |
| 15:00–19:00 | 影片、README、Product Feedback、Devpost 欄位、全新環境驗證 | 未完成 P1 全部移出宣稱 |
| 19:00–21:00 | 正式提交、確認影片與 repo 存取、處理表單失誤 | 禁止再加功能 |

工作量估計（工程判斷，不是承諾）：音訊 3–5 小時；MCP／資料／權限 2–3 小時；上傳／混音 2–3 小時；對話 UI／guide 2–3 小時；驚喜與整合 1–2 小時；驗證 1–2 小時。合計 11–18 小時，已接近或超過可用開發時間。部署再加 0.5–2 小時；真正邀請與 Polly 另計。因此預設 Ben 成員關係、單一曲目、無波形是有意識的必要取捨。

### 砍除順序

1. 通用和聲／音高分析、開源套件挑戰、完整歷史。
2. 動畫、波形、Polly。
3. 公開部署與正式邀請流程，保留可重現環境與 demo 成員。
4. 模型的自由對話廣度，保留明確標示的腳本路徑。

不要砍掉真正錄音、獨立 take、可聽混音、真實／模擬界線、權限檢查與提交時間。若連這些都保不住，就正式縮成教唱作品，重新寫描述。

## 10. 2 分 40 秒 demo

| 時間 | 畫面與聲音 | 要證明的事 |
|---|---|---|
| 0:00–0:15 | “Alexa, I feel like singing.” 助手邀請唱一句；常駐模擬標記 | 你的 ambient singing 初衷 |
| 0:15–0:40 | 播原創旋律、錄 Alex；字幕說 browser captures audio | 真錄音，沒有冒稱 Echo 收音 |
| 0:40–1:00 | “Help Ben sing with me.” 播低聲部 guide，Ben 跟一句 | 讓不會和聲的人加入 |
| 1:00–1:30 | Ben 戴有線耳機疊錄，先獨聽、再混合 | 兩個真人聲部，讓評審聽清楚差別 |
| 1:30–1:55 | “Save this for Mom.” 確認對象與版本 | 分享意圖由使用者確認 |
| 1:55–2:15 | Mom 開啟 HarmonyMate、同意播放 | 私有驚喜；不是一般 Alexa 對話攔截 |
| 2:15–2:35 | 真 MCP 呼叫、mix job、兩個 take、Streamable HTTP | 工程證據與可重現性 |
| 2:35–2:40 | “A little guidance. Our voices, together.” | 人是主角 |

錄製可剪短等待，不可把失敗功能換成預製成功畫面。預錄真人素材可作 demo seed 與重播範例，但須標示；至少展示一次本次實際錄音產生新的 take 與混音。引導音預編完全合理，不要稱為即時從任意歌聲生成的和聲。

「不用拿手機」是未來體驗意圖；影片若拍實體 Echo，只能作概念背景，不能剪接成它已執行本系統。瀏覽器首次權限與啟動音訊的操作可簡短交代。

## 11. 競品與評審視角

| 既有產品 | 已存在的能力 | HarmonyMate 不能宣稱的新穎性 |
|---|---|---|
| [BandLab](https://help.bandlab.com/hc/en-us/articles/115002945253-How-do-I-invite-other-users-to-collaborate) | 邀請其他創作者協作 | 「可以邀請別人做音樂」不是新發明 |
| [Smule](https://smule.zendesk.com/hc/en-us/articles/31018793346964-Turn-a-Join-into-an-Invite) | 合唱加入與邀請延伸 | 「朋友一起唱、接著邀請別人」已有成熟產品 |
| [Sing Harmonies](https://www.singharmonies.com/faq) | 逐聲部播放／靜音以學和聲 | 分聲部教唱不是獨有技術；此處比較其官方描述，不推斷當前可購買狀態 |

差異化應是「在家中自然開始、有人引導、把剛唱出的聲音留給在乎的人」的一段低門檻旅程。這是設計整合上的差異，不是已證明的市場護城河。

以下為本人的主觀評估，不是官方預測或得獎機率；目前 repo 不能算完成作品分數。

| 評分面向 | 完成縮小版的估計／10 | 最可能扣分原因 |
|---|---:|---|
| Technical Implementation | 7 | 真 MCP、音訊與權限可加分；失準或假 log 立即失去可信度 |
| Design | 8 | 教一句就能加入很清楚；登入、耳機與專案設定可能打斷情緒 |
| Potential Impact | 7 | 家庭共同創作有價值，但使用頻率與需求未驗證 |
| Quality of the Idea | 7 | 組合有感染力，錄音與教唱本身都已有競品 |

最尖銳的問題會是：「這在 Echo 上真的能做嗎？為什麼不直接用 Smule？」答案要誠實：本次驗證 voice-first interaction 和工具／音訊鏈路；原生硬體整合仍待平台確認。亮點應由教唱後的真合聲說話。

### 與其他候選案比較

此表是對題目方向的工程與產品判斷，沒有把其他候選案當成已驗證市場或現成程式。

| 題目 | 相對優勢 | 短期風險 |
|---|---|---|
| HarmonyMate | 可聽見的情緒結果、獨特 demo、符合你的興趣 | 音訊同步與原生硬體落差 |
| TournamentPilot | 語音記分有明確 hands-free 理由，資料操作較容易 | demo 較常見，需要清楚的多賽局狀態 |
| RepairPit | 手忙時語音輔助合理 | 診斷可信度、視覺輸入與操作安全難在短 demo 證明 |
| ChaosPilot | 現場協調價值明確 | 多人、多來源事件容易只剩腳本演戲 |
| PopUpOS | 可量化營運便利 | 依賴真交易／庫存整合，題目辨識度較弱 |

若唯一目標是低工程風險，TournamentPilot 比 HarmonyMate 安全。若目標包含令人記得的創作體驗，我選 HarmonyMate，條件是第一關驗證音訊；此刻換題也有重做規劃與素材的成本。

## 12. 提交與驗收清單

規則的精確表述與 FAQ 差異以 [官方來源核對](../OFFICIAL_SOURCE_CHECK.md) 為準；不要把本方案的工程選擇誤寫成官方義務。

- [ ] repo license、安裝、環境範例、固定依賴、seed、demo 登入方式均可取得。
- [ ] README 明列實作／模擬／未實作，MCP 傳輸與版本、AWS 真正用途、音樂素材來源。
- [ ] 乾淨環境可啟動；需哪些外部憑證、如何取得、沒 Bedrock 時如何評估都清楚。
- [ ] 未授權 MCP 拒絕存取；非成員不能讀寫 song；非 Mom 不能 reveal 她的 surprise。
- [ ] upload token 到期／重放、跨專案 track ID、重複 tool call、混音失敗可合理處理。
- [ ] 改 prompt、actorId 或 confirmed 欄位不能越權。
- [ ] 兩軌可獨聽、重錄不覆寫、正負 offset 與混音輸出一致。
- [ ] 拒絕麥克風、自動播放受限、語音辨識失敗時有可操作的 UI。
- [ ] 影片英文、公開、少於三分鐘；連結在未登入狀態可開。
- [ ] Product Feedback 寫實際使用的服務與經驗；AWS mini challenge 只在實際符合時勾選。
- [ ] Feedback 逐一回答：用了什麼與如何使用、哪裡順、哪裡需改善、上手經驗、是否會再用及原因。只寫親自驗證的結果。
- [ ] Friction Log 邊做邊記，包含重現步驟、預期／實際、影響、變通與建議；不杜撰五筆。
- [ ] 測試存取方式在 judging/testing 期間可用；本機方式也要讓評審能完成，不只提供無法取得金鑰的空殼。
- [ ] 提交前對照當日 Devpost 表單的必填欄位；本文件不宣稱已完成參賽提交。

## 13. 下一步順序

先做 20 秒雙軌音訊原型與原創素材，再建 MCP 垂直流程；不要從完整資料模型或 Echo 外框開始。第一個能交給另一個人試的版本，應該已能讓他聽一句、唱一句，然後聽見兩個人的聲音。

這份計畫的成功條件是：**產品願景講清楚，模擬邊界講清楚，真正的歌聲與人際連結做出來。**
