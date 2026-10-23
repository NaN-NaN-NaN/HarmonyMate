# HarmonyMate 官方資料核對

核對日期：2026-10-22。下列區分「官方明文」、「文件未證實」與「實作建議」；不是正式資格裁定。

## 競賽規則：應修正的假設

- 截止：2026-10-23 12:00 PDT，即 **10 月 23 日 21:00 蘇黎世／柏林時間**。評審期至 11 月 20 日。參賽資格仍須依所在地、成年條件及利益衝突限制個別確認。[Official Rules](https://amazonappdev2026.devpost.com/rules)
- MCP 路徑要求至少 `2025-11-25`、Streamable HTTP、實際執行整合；但另有**純模擬 Alexa+ 路徑，明文豁免 runtime technology hook，沒有特定 SDK 或 MCP 外形要求**。因此真 MCP 是有價值的工程選擇，並非所有模擬提交的硬性門檻。[Official Rules](https://amazonappdev2026.devpost.com/rules)
- GitHub 原始碼、可重現說明與影片必要。公開 repo 要開源授權（不限定 MIT）；私人 repo 要授權評審。影片建議少於三分鐘，公開於 YouTube／Vimeo。材料須英文或附英文翻譯。[Official Rules](https://amazonappdev2026.devpost.com/rules)
- AWS Builder 要記錄 AWS 使用方式；不強制 Bedrock、Polly、AWS 託管三者同時使用。Friction Log 選填、最高加 10%，未見「至少五筆」條款。測試須免費提供評審至評審結束。[Official Rules](https://amazonappdev2026.devpost.com/rules)

## FAQ 消除了部署與硬體壓力

- 官方 Alexa+ Category SDK、MCP Toolkit、CLI、Web Simulator 只開放選定合作夥伴；一般參賽者目前無申請管道。應使用自己的前端／模擬器。[官方 FAQ](https://amazonappdev2026.devpost.com/details/faqs)
- Alexa+ 不要求實體裝置；本機可執行的公開 repo 與 demo 影片足夠，**不必公開託管，也不必提交後持續運行 MCP server**。因此「免費提供評審」不可直接改寫成「公開網站連續運作至 11/20」。若自行選擇提供網站，需確保測試說明與憑證可用。[官方 FAQ](https://amazonappdev2026.devpost.com/details/faqs)
- 「已有 Echo 硬體就可以立即接上我們的 Alexa+ add-on」不能當本次交付承諾。真正的裝置接入權限與模擬器是否成功是不同問題。[官方 FAQ](https://amazonappdev2026.devpost.com/details/faqs)
- AWS credits 已於 10 月 7 日公告用罄，不應把拿到免費額度列為時程依賴。[Resources](https://amazonappdev2026.devpost.com/resources)

## Alexa+ MCP 技術要求與認證邊界

官方 QuickStart 確實要求：Streamable HTTP、遠端 URL、未認證回 `401` 且不帶 `WWW-Authenticate`、round-trip query response 小於 500 ms。完整 account linking 還包含 OAuth 2.1 authorization code + PKCE S256、PRM、授權伺服器 metadata、`resource` 與 scopes，並非只有一個 Bearer token。[Alexa+ MCP QuickStart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart)

建議：本次採明確標示的 demo bearer auth，權限仍由後端執行；不要稱已完成 Alexa+ 正式 account linking。若未來接入官方平台，再補完整 OAuth。混音若超過 500 ms，讓 `create_mix` 建立 job 後立即回傳，再查詢結果；500 ms 不應拿來承諾完成 ffmpeg 運算。這是架構推論，不是官方提供的 HarmonyMate 工作流程。

注意：通用 MCP 授權規範允許透過 `WWW-Authenticate` 或 well-known URI 發現 PRM；Alexa+ 文件則明列不支援該 header。應將這視為特定 client 相容性要求，避免宣稱「所有 MCP server 都不得回 header」。[MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## Echo 原始音訊：未證實，不等於已證明不存在

本次查閱的公開 Alexa+ MCP 與 ASK 音訊文件，沒有找到第三方 add-on 直接取得 Echo 麥克風原始 PCM、長時間歌唱錄音或多軌同步擷取的正式介面。ASK 文件描述的 AudioPlayer、SSML、APL Audio 是播放能力，不能據此推論有錄音能力。[ASK 音訊指南](https://developer.amazon.com/en-GB/docs/alexa/custom-skills/add-audio.html)

結論應寫成「目前未找到可供本專案使用的官方 Echo 錄音 API」，不要寫成全球、永久不可能。這次讓瀏覽器取得使用者麥克風權限並錄音，是可展示的替代輸入管道，但必須清楚標示；它尚未實現『完全只靠現有 Echo、無額外介面』的產品願景。

## 對計畫的直接建議

1. 保留真 MCP 作為可驗證整合；若時間緊迫，官方允許退回真實運作的模擬體驗。
2. 優先做本機 Docker 一鍵跑通，雲端部署設時間上限。AWS 價值可由一個真正使用的服務提供。
3. 影片同時交代：產品願景是自然說話開始唱歌；現在的實測是模擬 Alexa+ 對話加瀏覽器錄音。
4. 不把尚未取得的硬體權限、原始音訊 API 或主動通知視為已完成能力；Friction Log 只記真實操作及觀察，不為湊數捏造事件。
