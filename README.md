# Mood Journal｜情緒日記 Web MVP

以 React + Vite 打造的極簡情緒日記，作為「30 天 Vibe Coding」系列的第二篇章。已接入 Firebase：支援 Google 登入與 Firestore 雲端儲存（路徑 `users/{uid}/diaries/{docId}`）。

## 功能特色

### 當前（Day 13 版）

- Google 登入：LoginPage 提供 Google 登入按鈕
- 保護路由：未登入導向 `/login`，登入後進入 `/`
- 雲端儲存：使用者日記存於 Firestore `users/{uid}/diaries/{docId}`
- 新增/編輯/刪除：DiaryPage 可新增、編輯、刪除（軟刪除 `isDeleted=true`）
- 排序：清單依日期新 → 舊排序
- 基本防呆：內容空白無法存檔；存檔後自動清空輸入框

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
- 語言：JavaScript（可逐步導入 TypeScript）
- 狀態管理：React Hooks（`useState`、`useEffect`、`useMemo`）
- 路由：React Router v6
- 身分驗證：Firebase Auth（Google）
- 資料庫：Cloud Firestore（`users/{uid}/diaries/{docId}`）

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
@@ -96,36 +96,34 @@ VITE_SPEECH_INFER_URL=https://your-speech-infer-endpoint
VITE_SPEECH_API_KEY=your-secret-key
```

3) 重新啟動 dev server 後即可登入、寫入與讀取日記。

## 使用方式

- 在輸入框輸入日記內容
- 點擊「存檔」後，下方清單會即時出現新項目
- 清單顯示日期與前 30 字摘要，依日期新 → 舊排序
- 可重整或關閉頁面，資料仍保留於本機（`localStorage`）

路由：
- `/login`：登入頁（Google 登入）
- `/`：日記頁（新增、編輯、刪除；排序）
- `/trash`：垃圾桶（僅顯示 `isDeleted=true`，支援還原/永久刪除）
- `/sentiment-test` - text sentiment inference demo page
- `/speech-test` - speech emotion inference demo page

## 專案結構（重點）

- `src/App.jsx`：路由設定（含保護路由）
- `src/pages/LoginPage.jsx`：登入頁
- `src/pages/DiaryPage.jsx`：日記頁（Firestore CRUD：新增、編輯、軟刪除、排序）
- `src/pages/TrashPage.jsx`：垃圾桶頁（還原／永久刪除）
- `src/state/AuthContext.jsx`：使用者狀態（Firebase Auth）
- `src/lib/firebase.js`：Firebase 初始化（Auth、Firestore）
- `src/App.css`、`src/index.css`：樣式
- `index.html`：頁面入口
- `vite.config.js`：Vite 設定
- `package.json`：腳本與相依套件

### 主要使用的 Firebase API

```js
import { initializeApp } from 'firebase/app'