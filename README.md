# Mood Journal｜情緒日記 Web MVP

以 React + Vite 打造的情緒日記，作為「30 天 Vibe Coding」系列的第二篇章。支援 Google 登入、Firestore 雲端儲存，以及文字 × 語音情緒分析。

## 功能特色

- Google 登入與保護路由：未登入時導向 `/login`。
- 日記新增、編輯、搜尋與日期篩選，依日期新到舊排序。
- 軟刪除與垃圾桶：支援還原及永久刪除。
- 雲端儲存：日記位於 `users/{uid}/diaries/{docId}`，內容以 AES 密文儲存。
- 情緒分析：儲存或編輯日記時呼叫 Fusion API；失敗時使用本地關鍵詞備援。
- 語音輸入：支援瀏覽器語音辨識與錄音；是否附加音訊分析依隱私設定而定，需瀏覽器支援及麥克風權限。
- 七類情緒 chip、每日情緒分布圖與情緒月曆。
- 設定頁提供提醒、隱私選項及 JSON／CSV 匯入匯出。
- 離線日記暫存於 IndexedDB，恢復連線後嘗試同步。

## 七類情緒與視覺化

日記列表、月曆當日明細與垃圾桶共用情緒 chip，統一顯示名稱、emoji 與顏色：

| API 標籤 | 顯示名稱 |
| --- | --- |
| `Anger` | 😠 生氣 |
| `Disgust` | 🤢 厭惡 |
| `Fear` | 😨 害怕 |
| `Happy` | 😊 開心 |
| `Neutral` | 😐 中立 |
| `Sad` | 😢 難過 |
| `Surprise` | 😮 驚訝 |

API 回傳有效的 `confidence` 時，chip 顯示信心百分比。本地備援只依關鍵詞估計類別，不顯示模型信心值；滑鼠提示會標註「本地估計」。

### 每日情緒分布

- 使用堆疊長條圖，可切換最近 7 天或 30 天。
- 每篇日記依主要情緒計數，縱軸為篇數；同一天的多篇日記會累加。
- 顏色代表情緒類別，不代表好壞或強度，也不將信心值當作情緒分數平均。
- 主頁圖表會套用目前的搜尋與日期篩選；整段期間沒有日記時顯示空狀態。

### 情緒月曆

- 預設顯示本月；主頁有日期篩選結束日時，顯示該日期所在月份。
- 每天顯示日記篇數與各類情緒的篇數比例，同一天可呈現多種情緒。
- 點選日期可查看當日日記、情緒 chip 與可用的關鍵詞。
- 無日記的日期顯示「—」，不視為中立。

### 舊資料相容

舊 `neutral` 標籤相容於 `Neutral`。舊 `positive`／`negative` chip 保留「舊分類：正向／負向」提示，在圖表中與未辨識標籤歸入「舊分類／未分類」，不推測成某一種七類情緒。編輯並儲存日記可觸發重新分析；載入頁面不會批次重寫舊三分類標籤。

## 技術架構

- React 19、Vite 7、React Router v6
- JavaScript／JSX，情緒 API 客戶端使用 TypeScript
- Firebase Auth（Google）與 Cloud Firestore
- Recharts（情緒圖表）、date-fns（日期處理）
- CryptoJS（前端 AES）、IndexedDB（離線待同步日記）

## 快速開始

環境需求：Node.js **20.19+ 或 22.12+**、npm。建議使用 Node 22.12+；Node 18 不符合目前 Vite 7 的需求。

```bash
# 安裝依賴
npm ci

# 開發模式（依終端輸出網址開啟）
npm run dev

# 建置至 dist/
npm run build

# 預覽建置產物（預設 http://localhost:4173）
npm run preview

# 靜態檢查
npm run lint
```

### Firebase 與環境變數

1. 在 Firebase Console 建立專案與 Web App，啟用 Authentication 的 Google 登入及 Firestore。
2. 確認開發及部署網域已加入 Firebase Authentication 的授權網域。
3. 在專案根目錄建立 `.env.local`：

```dotenv
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-firebase-app-id
VITE_FIREBASE_STORAGE_BUCKET=your-storage-bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id

# 情緒融合服務基底網址，不含 /predict-fusion
VITE_GATEWAY_BASE=https://your-fusion-gateway.example.com
```

Firebase 初始化至少需要 `API_KEY`、`AUTH_DOMAIN`、`PROJECT_ID` 與 `APP_ID`。修改環境變數後需重新啟動開發伺服器；部署環境需設定相同變數並重新建置。

### 情緒分析服務

前端透過 `src/lib/fusion.ts` 向 `${VITE_GATEWAY_BASE}/predict-fusion` 發送 `POST`，格式為 `multipart/form-data`：

- `text`：日記文字。
- `file`：選用的錄音檔；允許音訊分析且有錄音時才附加。

服務需允許前端來源的 CORS 請求，並回傳 `mode`（`text_only` 或 `multimodal`）、`labels`、`text_pred`、`audio_pred`、`fusion_pred`、`text_top1`、`audio_top1`、`fusion_top1` 與 `confidence`。機率分布使用上述七類英文標籤，純文字模式的音訊結果可為 `null`。

Fusion 推論服務需另外提供。未設定 gateway 或呼叫失敗時，日記儲存流程會使用本地關鍵詞備援。

## 使用方式與路由

1. Google 登入後，在主頁輸入日記，或使用瀏覽器支援的語音輸入。
2. 儲存後查看清單中的情緒 chip；可編輯內容並重新分析。
3. 在主頁「情緒視覺化」切換情緒分布與月曆，搭配搜尋和日期篩選查看紀錄。
4. 刪除的日記可在垃圾桶還原，或確認後永久刪除。

| 路由 | 功能 |
| --- | --- |
| `/login` | Google 登入 |
| `/` | 日記 CRUD、搜尋、日期篩選、情緒分析與視覺化 |
| `/trash` | 已刪除日記、還原與永久刪除 |
| `/settings` | 提醒、隱私、匯入匯出 |

目前 `InsightsPage.jsx` 保留獨立視覺化頁面實作，但未在 `App.jsx` 註冊路由；日常使用的圖表位於主頁。

## 安全與隱私

- `firestore.rules` 限制登入者只可讀寫自己的日記與設定：`users/{uid}/diaries/{docId}`、`users/{uid}/profile/{docId}`。
- 可在 Firebase Console 的 Firestore Rules 貼上規則並發布，或在已設定 Firebase CLI 的環境執行 `firebase deploy --only firestore:rules`。
- 前端以使用者 UID 作為 AES key，Firestore 儲存 `contentEnc`；這是示範用加密方式，並非以使用者私密金鑰建立的端對端加密。情緒標籤等中繼資料另行儲存。
- 呼叫情緒服務時會傳送日記文字，允許音訊分析時也可能傳送錄音。
- `VITE_` 環境變數會包含於前端產物，不應放入需保密的服務端金鑰。

## 專案結構（重點）

- `src/App.jsx`：路由與保護路由。
- `src/pages/DiaryPage.jsx`：日記 CRUD、分析、篩選、離線同步與主頁圖表。
- `src/pages/TrashPage.jsx`：垃圾桶與情緒 chip。
- `src/pages/SettingsPage.jsx`：使用者設定及匯入匯出。
- `src/pages/InsightsPage.jsx`：獨立視覺化頁面實作（未掛載路由）。
- `src/components/EmotionChip.jsx`：共用情緒 chip 與信心值顯示。
- `src/components/EmotionInsights.jsx`：堆疊長條圖、情緒月曆與當日明細。
- `src/lib/emotions.js`：七類情緒定義、標籤相容、每日統計與本地備援。
- `src/lib/fusion.ts`：Fusion API 型別與請求。
- `src/lib/firebase.js`：Firebase 初始化及登入登出。
- `src/lib/idb.js`：離線待同步資料。
- `src/state/AuthContext.jsx`：登入狀態。
- `src/App.css`、`src/index.css`：樣式。
- `firestore.rules`：Firestore 存取規則。
- `vite.config.js`、`package.json`：建置設定與指令。

## 開發里程碑（Day 11–29）

以下保留系列開發規劃；目前功能與路由以上方說明及程式碼為準。Day 14–15 的三分類與折線圖已由七類情緒視覺化取代。

- Day 11：日記mvp
- Day 12：Firestore 串接 + 帳號登入（僅本人可見）
- Day 13：CRUD（編輯、刪除、排序）
- Day 14：基礎文字情緒分析（正向/中立/負向）
- Day 15：情緒視覺化（折線圖 + 月曆熱力圖）
- Day 16：標籤與搜尋（tag / 日期篩選）
- Day 17：提醒與通知（每日提醒寫日記）
- Day 18：隱私與安全（Firestore Rules、本地加密選項）
- Day 19：匯出／匯入（JSON/CSV）
- Day 20：PWA 離線模式（離線可寫，上線自動同步）
- Day 21：測試、部署與事件追蹤（Playwright、Vercel、GA4/PostHog）
- Day 22–23：進階文字情緒分類器＋可解釋性（HuggingFace、信心分數、關鍵詞貢獻）
- Day 24：將進階分類器整合回日記（更準確的標籤與信心）
- Day 25：語音輸入（錄音 → 轉文字）
- Day 26：語音情緒模型挑選（dataset 與 baseline）
- Day 27：語音 API 串接與 Demo（機率分布顯示）
- Day 28：效果驗證（UAR ≥ 0.6、混淆矩陣、F1）
- Day 29：文字 × 語音融合（Late Fusion）＋ 隱私選項
