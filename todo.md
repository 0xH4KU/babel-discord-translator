# Babel Architecture TODO

本文件將目前專案的架構改進建議整理成可執行的工作清單，目標不是一次性大改，而是用可落地、可驗證、可逐步發布的方式，把專案從「可用的單機 Bot」提升為「可維護、可擴充、可穩定運維的服務」。

## 使用方式

- 先完成 `P0`，再進入 `P1`，最後才處理 `P2`
- 每個項目都應該有對應 PR、測試與驗收紀錄
- 未完成前不要同時展開過多重構，避免把風險疊在一起
- 除非另有說明，所有變更都應維持目前對 Discord 使用者的功能相容

## 目標

- 降低模組耦合，建立清楚的 application / infrastructure 邊界
- 消除目前單機 JSON 檔與同步 I/O 帶來的可維護性與可靠性風險
- 讓測試、部署、啟停、設定變更與快取行為可預期
- 為未來的多實例部署、資料持久化與監控保留演進空間

## 非目標

- 這一輪不追求微服務化
- 這一輪不優先做 UI 視覺重做
- 這一輪不引入過度複雜的事件驅動或 CQRS 架構

## 目前問題摘要

- 啟動流程、Discord client、Dashboard server、session 與 route handler 耦合過重
- `store` 將設定、統計、偏好與歷史資料全部寫進單一 JSON，且每次同步寫檔
- `Babel` 與 `/translate` 指令流程高度重複，規則容易漂移
- 快取 key 缺少 `model`、`prompt`、內容版本等維度，存在陳舊資料風險
- 生產執行模式不一致，TS 原始碼與 build artifact 並存
- 可觀測性不足，缺少 timeout、structured log、process/server lifecycle 管理
- License 宣告不一致，存在治理風險

## 優先級定義

- `P0` 必做，直接影響穩定性、可測試性、可維護性
- `P1` 應做，能顯著提升架構品質與運維能力
- `P2` 可做，屬於擴充性與中長期演進

---

## P0. 穩定邊界與可測試性

### P0-1. 拆分 Dashboard App 建立與 HTTP Server 啟動

- [x] 將 `src/dashboard.ts` 拆成「建立 Express app」與「綁定 port」兩個責任
- [x] 新增 `createDashboardApp(deps)`，只回傳 `express.Express`
- [x] 新增 `startDashboardServer(app, port)`，回傳 `http.Server`
- [x] `src/index.ts` 保留 server handle，供 graceful shutdown 使用
- [x] 測試改為直接對 app 或測試 server 進行，不依賴模組內隱式 `listen`

完成標準

- `dashboard` 模組不再在 import 或 app factory 階段自行監聽 port
- 測試環境可以獨立啟動與關閉 server
- shutdown 時會同時關閉 Discord client 與 HTTP server

影響檔案候選

- `src/dashboard.ts`
- `src/index.ts`
- `tests/dashboard.test.ts`

### P0-2. 抽出 Translation Application Service

- [x] 建立單一翻譯服務，例如 `src/services/translation-service.ts`
- [x] 把以下流程集中到 service
- [x] setup complete 檢查
- [x] guild whitelist 檢查
- [x] budget 檢查
- [x] cooldown 檢查
- [x] input length 檢查
- [x] target language 決策
- [x] same-language 檢查
- [x] cache lookup / write
- [x] usage 記錄
- [x] log 記錄
- [x] Discord command handler 改為 transport adapter，只處理 interaction 與回覆格式

完成標準

- [x] `handleBabel` 與 `handleTranslate` 不再各自重複核心商業邏輯
- [x] 翻譯規則只存在一份來源
- [x] 新增單元測試覆蓋 service 的成功、快取、預算、錯誤與語言決策分支

影響檔案候選

- `src/commands/babel.ts`
- `src/commands/translate.ts`
- `src/lang.ts`
- `src/translate.ts`
- `src/usage.ts`
- `src/log.ts`

### P0-3. 快取 key 版本化

- [x] 為翻譯快取補上版本維度
- [x] key 至少包含 `sourceContentHash`
- [x] key 至少包含 `targetLanguage`
- [x] key 至少包含 `geminiModel`
- [x] key 至少包含 `promptVersion` 或 `translationPrompt` hash
- [x] `Babel` 不能只用 `message.id` 作為來源鍵
- [x] Dashboard 更新 prompt、model、token 設定後，要清 cache 或 bump cache version

完成標準

- [x] 修改 prompt/model 後，不會命中舊翻譯結果
- [x] 訊息內容變更後，不會沿用舊 cache
- [x] 快取命中率統計仍然可正常運作

影響檔案候選

- `src/cache.ts`
- `src/commands/babel.ts`
- `src/commands/translate.ts`
- `src/dashboard.ts`
- `src/store.ts`

### P0-4. 統一 production artifact 與啟動方式

- [x] 明確區分 `dev` 與 `prod`
- [x] `dev` 使用 `tsx`
- [x] `prod` 一律執行 `dist`
- [x] 調整 `package.json` 的 `start` / `build` script
- [x] 調整 `ecosystem.config.cjs` 改跑 build artifact
- [x] 驗證 Docker、PM2、本機 production 啟動行為一致

完成標準

- [x] production 不再直接執行 `src/index.ts`
- [x] 所有部署方式都以同一套 build artifact 為準
- [x] README 的部署指令與實際執行模型一致

影響檔案候選

- `package.json`
- `ecosystem.config.cjs`
- `Dockerfile`
- `README.md`

### P0-5. 完成真正的 Graceful Shutdown

- [x] shutdown 時關閉 Discord client
- [x] shutdown 時關閉 HTTP server
- [x] 清理 interval / timer
- [x] 若未來有 DB 連線，也要在此處關閉
- [x] 為 shutdown 增加 timeout 與錯誤保護，避免 process 卡死

完成標準

- [x] 收到 `SIGTERM` / `SIGINT` 時，不會直接 `process.exit(0)` 跳過資源釋放
- [x] 測試可驗證 shutdown sequence

---

## P1. 資料層與可靠性

### P1-1. 將單一 JSON Store 拆分為明確的 Repository 邊界

- [x] 定義 repository 介面，而不是在各模組直接使用 `store.get/set/update`
- [x] 至少拆出以下邊界
- [x] `ConfigRepository`
- [x] `UsageRepository`
- [x] `UserPreferenceRepository`
- [x] `SessionRepository`
- [x] `GuildBudgetRepository`
- [x] 禁止 command / route 直接操作原始資料結構

完成標準

- [x] `store` 不再是整個系統的共享全域資料入口
- [x] domain logic 依賴介面，不依賴具體 JSON 格式

### P1-2. 將資料持久化從 JSON 升級到 SQLite

- [x] 引入 SQLite 作為單機正式資料層
- [x] 設計 migration 機制
- [x] 提供從現有 `data/config.json` 遷移的腳本
- [x] 保留 rollback 策略

建議資料表

- [x] `app_config`
- [x] `user_language_preferences`
- [x] `guild_budgets`
- [x] `daily_usage`
- [x] `guild_daily_usage`
- [x] `usage_history`
- [x] `sessions`
- [x] `cache_metadata` 或 `translation_cache`（若決定持久化）

完成標準

- [x] 設定、偏好、usage 不再依賴同步檔案寫入
- [x] 重啟後資料一致
- [x] 資料結構變更可透過 migration 管理

### P1-3. Session 與 Auth 模組化

- [x] 將 session 管理從 `dashboard.ts` 抽成獨立模組
- [x] 將 password 驗證、cookie 組裝、csrf 驗證分層
- [x] 規劃 session persistence 策略
- [x] 若仍採記憶體 session，需明確標註單機限制
- [x] 若要支援多實例，改為 SQLite 或 Redis session store

完成標準

- [x] `dashboard.ts` 不再同時承擔認證實作細節
- [x] session 行為可獨立測試

### P1-4. 外部 API Client 正規化

- [x] 為 Vertex AI 建立獨立 client 模組，例如 `src/infra/vertex-ai-client.ts`
- [x] 所有外部請求統一加上 timeout
- [x] retry、錯誤分類、response parse、sanitization 集中處理
- [x] health check 與 translate 共用同一個 client

完成標準

- [x] 外部 API 呼叫策略只有一份
- [x] 不再有一個地方有 timeout、另一個地方沒有 timeout 的情況

### P1-5. 補齊設定變更的副作用管理

- [x] 盤點所有會影響 runtime 行為的設定
- [x] `cooldownSeconds`
- [x] `cacheMaxSize`
- [x] `geminiModel`
- [x] `translationPrompt`
- [x] `maxInputLength`
- [x] `maxOutputTokens`
- [x] `dailyBudgetUsd`
- [x] 對每種設定定義「更新後要即時套用什麼」
- [x] 建立統一的 config update hook 或 domain event

完成標準

- [x] 設定變更不再散落於 route handler 中手動同步
- [x] runtime state 與 persisted config 不會漂移

---

## P1. 測試與品質保證

### P1-6. 重建測試分層

- [ ] 區分 unit test、integration test、contract test
- [ ] application service 以 unit test 為主
- [ ] dashboard API 以 integration test 為主
- [ ] Discord adapter 可用 mock interaction 驗證
- [ ] repository 層要有 persistence 測試

完成標準

- 測試命名與責任清楚
- 新架構下測試不依賴隱式全域狀態

### P1-7. 補齊回歸風險測試

- [ ] prompt 變更後 cache 失效測試
- [ ] model 變更後 cache 失效測試
- [ ] 訊息編輯或內容 hash 差異測試
- [ ] shutdown 與 server close 測試
- [ ] settings update 後 cooldown/cache runtime 套用測試
- [ ] translate timeout / retry / partial failure 測試

### P1-8. CI 強化

- [ ] 將 `npm run build` 納入 CI
- [ ] 若引入 migration，CI 要驗證 migration 可執行
- [ ] 若引入 SQLite，增加 integration test job
- [ ] 若保留 Docker，CI 應驗證 container 啟動與 health check

完成標準

- CI 不只檢查 type/lint/test，還要檢查 production build 與啟動鏈

---

## P1. 可觀測性與運維

### P1-9. Structured Logging

- [x] 將目前 `console.log/warn/error` 收斂為統一 logger
- [x] log 至少包含 level、event、requestId、guildId、userId、command
- [x] 對外部 API 錯誤分類打點
- [x] 避免把敏感資訊寫入 log

完成標準

- [x] 能從 log 還原一次翻譯請求的主要生命週期

### P1-10. Metrics 與 Health Model

- [x] 定義應用層 metrics
- [x] `translations_total`
- [x] `translation_api_calls_total`
- [x] `translation_cache_hits_total`
- [x] `translation_failures_total`
- [x] `budget_exceeded_total`
- [x] `webhook_recreate_total`
- [x] 區分 liveness 與 readiness
- [x] `/healthz` 不應只回傳 process 活著，應回傳基本依賴狀態策略

完成標準

- [x] 可從 metrics 或 stats 看出容量、失敗率與 cache 效益

### P1-11. Runtime 限流策略檢視

- [x] 盤點 Discord 使用者 cooldown、login limiter、外部 API retry 的交互作用
- [x] 規劃全域併發限制，避免瞬時大量翻譯打爆 Vertex AI
- [x] 規劃 per-guild / per-user / global queue 策略

完成標準

- [x] 高峰請求下系統會降級，而不是直接失控

---

## P2. 擴充性與中長期演進

### P2-1. 模組目錄重整

- [ ] 以分層或 bounded context 重整目錄

建議方向 A

- [ ] `src/app`
- [ ] `src/domain`
- [ ] `src/infra`
- [ ] `src/interfaces/discord`
- [ ] `src/interfaces/http`

建議方向 B

- [ ] `src/modules/translation`
- [ ] `src/modules/dashboard`
- [ ] `src/modules/config`
- [ ] `src/modules/usage`
- [ ] `src/shared`

完成標準

- 新成員能在 10 分鐘內理解責任分布

### P2-2. Bot 與 Admin API 進程分離評估

- [ ] 評估是否需要將 Discord gateway worker 與 dashboard/admin API 分開執行
- [ ] 若分離，先確定共享資料層與 session 策略已穩定
- [ ] 評估拆分帶來的部署與維運成本

何時才值得做

- [ ] 已出現不同擴容需求
- [ ] Dashboard 與 Bot 有不同 SLA
- [ ] 需要把 public/admin 面與 Discord worker 分開部署

### P2-3. Cache 升級路線

- [ ] 評估是否保留記憶體 LRU
- [ ] 若需要跨實例共享，改為 Redis
- [ ] 若只要單機重啟可恢復，可考慮 SQLite cache
- [ ] 加入 TTL 與 cache invalidation policy

### P2-4. Webhook 管理獨立化

- [ ] 將 `getOrCreateWebhook` 抽成 webhook service
- [ ] 增加 stale webhook 偵測、metrics 與錯誤分類
- [ ] 明確定義 cache eviction 策略

### P2-5. i18n 與文案治理

- [ ] 將 Discord reply 文案與 dashboard API error 文案系統化
- [ ] 避免文案散落在 command / route handler
- [ ] 為管理後台與 Discord 使用者訊息建立不同層級的 message catalog

---

## 文件與治理

### DOC-1. README 對齊實作

- [ ] 更新啟動方式、部署方式、測試方式
- [ ] 補上目前架構圖與模組責任
- [ ] 補上資料持久化與單機限制說明

### DOC-2. ADR

- [ ] 建立 `docs/adr/` 目錄
- [ ] 先寫以下 ADR
- [ ] 為何從 JSON store 遷移到 SQLite
- [ ] 為何將 dashboard app 與 server 分離
- [ ] 快取 key 設計與 invalidation 策略
- [ ] 是否維持單體架構而非微服務

### GOV-1. License 一致性修正

- [ ] 確認專案真正授權條款
- [ ] 對齊 `package.json`、`README.md`、`LICENSE`
- [ ] 若有歷史發布版本，補上變更說明

---

## 建議執行順序

### Milestone 1

- [x] P0-1 Dashboard App / Server 拆分
- [x] P0-5 Graceful Shutdown
- [x] P0-4 統一 production artifact

### Milestone 2

- [x] P0-2 Translation Service
- [x] P0-3 Cache key 版本化
- [ ] P1-7 回歸測試補齊

### Milestone 3

- [x] P1-1 Repository 邊界
- [x] P1-2 SQLite 遷移
- [x] P1-3 Session/Auth 模組化
- [x] P1-4 外部 API client 正規化

### Milestone 4

- [x] P1-9 Structured Logging
- [ ] P1-10 Metrics / Health
- [ ] P1-11 併發與限流策略

### Milestone 5

- [ ] P2 系列擴充性工作
- [ ] ADR 與 README 補齊
- [ ] License 治理收斂

---

## 驗收清單

- [ ] `npm run lint` 通過
- [ ] `npm run typecheck` 通過
- [ ] `npm test` 通過
- [ ] `npm run build` 通過
- [ ] Docker image 可正常啟動
- [ ] PM2 production mode 可正常啟動
- [ ] 修改 prompt/model 後 cache 不會回傳舊結果
- [ ] shutdown 不會留下未關閉的 server / timer
- [ ] 資料遷移後舊資料可正確讀取
- [ ] README、部署方式、實作狀態一致

## 備註

- 若只打算把此專案維持在個人自架、單機、低流量場景，`P0` 仍然建議全部完成，因為這些工作主要是在修正邊界，不是過度設計。
- 若未來目標是公開 SaaS 或多租戶產品，則 `P1-2`、`P1-3`、`P1-9`、`P1-10` 應提升為近程優先事項。
