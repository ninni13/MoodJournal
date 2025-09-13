# Mood Journal｜情緒日記 Web MVP

以 React + Vite 打造的極簡情緒日記，作為「30 天 Vibe Coding」系列的第二篇章。已接入 Firebase：支援 Google 登入與 Firestore 雲端儲存（路徑 `users/{uid}/diaries/{docId}`）。

## 功能特色

### 當前（Day 25 版）

- Google 登入與保護路由：未登入導向 `/login`，登入後進入 `/`
- 新版登入頁 UI：置中卡片、深色單色背景、可及性與鍵盤操作、卡片底部條款連結
- 雲端儲存：使用者日記存於 Firestore `users/{uid}/diaries/{docId}`
- 新增 / 編輯 / 刪除：支援軟刪除（`isDeleted=true`），垃圾桶頁可還原/永久刪除
- 搜尋與篩選：關鍵字搜尋、日期快速區間與自訂區間
- 情緒視覺化：折線圖 + 月曆熱力圖（Recharts），可切換週/月
- 每日提醒：設定頁可開啟 email 提醒（GitHub Actions 定時寄送，僅當日未寫才寄）
- 匯出 / 匯入：JSON、CSV（含情緒欄位）
- PWA 離線模式：離線可寫，恢復網路自動同步；待同步項目顯示「待同步」標籤
- 本地加密：寫入 Firestore 前以 AES 加密文字內容（欄位 `contentEnc`）
- 語音輸入（Web Speech API）：可開始/停止語音輸入，不支援瀏覽器會顯示提示
- 進階情緒分析整合：可串接外部推論 API（信心分數、關鍵詞貢獻），失敗時回退本地簡易分析
- 法務頁：`/privacy`、`/terms` 簡版內容（可後續擴充）

### 里程碑（Day 12–29）

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

## 技術架構

- 框架：React 19
- 建置工具：Vite 7
- 語言：JavaScript +（少量）TypeScript（`src/lib/sentiment.ts`）
- 狀態管理：React Hooks（`useState`、`useEffect`、`useMemo`）
- 路由：React Router v6（含保護路由）
- 身分驗證：Firebase Auth（Google）
- 資料庫：Cloud Firestore（`users/{uid}/diaries/{docId}`、`users/{uid}/profile/default`）
- 視覺化：Recharts（折線圖、熱力圖）
- 離線儲存：IndexedDB（`src/lib/idb.js`）

## 安全與隱私

- Firestore 規則：帳號隔離（見 `firestore.rules`）
  - 只允許本人讀寫自己的資料：
    - `users/{uid}/diaries/{docId}`（日記）
    - `users/{uid}/profile/{docId}`（提醒設定）
  - 規則部署：
    - Console：Firestore → Rules → 貼上後 Publish
    - 或 CLI：`firebase deploy --only firestore:rules`
- 本地加密（前端）：
  - 寫入時用 AES 加密內容，Firestore 儲存密文欄位 `contentEnc`
  - 讀取時在前端解密後顯示明文（相容舊資料）
  - 備註：金鑰採用使用者 `uid`，不適合高度敏感資料，正式版可引入更完整 KMS 流程

## 快速開始

環境需求：Node.js 18+、npm

```bash
# 安裝依賴
npm install

# 開發模式
npm run dev

# 建置產物
npm run build

# 本地預覽（預設 http://localhost:5173）
npm run preview
```

### Firebase 設定

1) 在 Firebase Console 建立專案與 Web App，啟用 Authentication（Google）與 Firestore。

2) 建立 `.env.local`，填入專案設定（Vite 使用 `VITE_` 前綴）：

```
VITE_FIREBASE_API_KEY=xxx
VITE_FIREBASE_AUTH_DOMAIN=xxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=xxx
VITE_FIREBASE_APP_ID=1:xxxx:web:xxxx
VITE_FIREBASE_STORAGE_BUCKET=xxx.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=xxxx
```

3) 重新啟動 dev server 後即可登入、寫入與讀取日記。

### 文字情緒推論 API（可選）

若要使用外部情緒推論 API，於 `.env.local` 加上：

```
VITE_INFER_URL=https://your-infer-endpoint
VITE_API_KEY=your-api-key   # 若不需要驗證可省略
```

前端會以 `POST { text }` 呼叫 API，期望回傳：`{ ok, label: 'neg|neu|pos', confidence, probs: {neg,neu,pos}, top_tokens, ... }`。
若呼叫失敗，會自動回退本地簡易分析。

## 使用方式

- 在輸入框輸入日記內容
- 點擊「存檔」後，下方清單會即時出現新項目
- 清單顯示日期與前 30 字摘要，依日期新 → 舊排序
- 可重整或關閉頁面，離線亦可書寫（IndexedDB），恢復網路後自動同步
- 可使用語音輸入：不支援之瀏覽器顯示替代提示

路由：
- `/login`：登入頁（Google 登入＋卡片式 UI）
- `/`：日記頁（新增、編輯、刪除、搜尋、排序、語音輸入）
- `/insights`：洞察頁（情緒折線圖、月曆熱力圖）
- `/settings`：設定頁（Email 提醒開關、匯出/匯入）
- `/trash`：垃圾桶（僅顯示 `isDeleted=true`，支援還原/永久刪除）
- `/privacy`、`/terms`：隱私權政策、服務條款

### 每日提醒（GitHub Actions）

Workflow 檔：`.github/workflows/reminder.yml`（預設每天 21:00 台灣時間寄送）。

Secrets 需求：

- `FIREBASE_PROJECT_ID`、`CLIENT_EMAIL`、`PRIVATE_KEY`：Firebase Admin 憑證（私鑰記得用 `\n` 轉義換行）
- `SENDGRID_API_KEY`：SendGrid API Key
- `FROM_EMAIL`（必要）、`FROM_NAME`（可選）：寄件人
- `APP_URL`（可選）：信件按鈕前往的網站 URL

說明：

- 腳本路徑 `reminder/scripts/sendReminder.mjs`，使用 Firestore `collectionGroup('profile')` 掃描所有 `users/{uid}/profile/default`，僅對 `reminderEnabled=true` 且當日未寫者寄信。
- 你也可於本機執行：

```bash
cd reminder
npm i
SENDGRID_API_KEY=xxx FROM_EMAIL=noreply@example.com FIREBASE_PROJECT_ID=... CLIENT_EMAIL=... PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" node scripts/sendReminder.mjs
```

## 專案結構（重點）

- `src/App.jsx`：路由設定（含保護路由）
- `src/pages/LoginPage.jsx`：登入頁
- `src/pages/DiaryPage.jsx`：日記頁（Firestore CRUD、搜尋 / 篩選、語音輸入、離線同步）
- `src/pages/InsightsPage.jsx`：洞察頁（折線圖、熱力圖）
- `src/pages/SettingsPage.jsx`：設定頁（Email 提醒、匯出/匯入）
- `src/pages/TrashPage.jsx`：垃圾桶頁（還原／永久刪除）
- `src/pages/PrivacyPage.jsx`、`src/pages/TermsPage.jsx`：法務頁面
- `src/state/AuthContext.jsx`：使用者狀態（Firebase Auth）
- `src/lib/firebase.js`：Firebase 初始化（Auth、Firestore）
- `src/lib/idb.js`：IndexedDB 封裝（離線待同步）
- `src/lib/sentiment.ts`：外部情緒推論 API 封裝
- `src/App.css`、`src/index.css`：樣式
- `src/pages/login.css`：登入頁專用樣式
- `index.html`：頁面入口
- `vite.config.js`：Vite 設定
- `package.json`：腳本與相依套件
- `public/sw.js`：PWA Service Worker（僅正式環境註冊）

### 主要使用的 Firebase API

```js
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore'
```
