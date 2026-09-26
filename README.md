# Mood Journal｜中文多模態情緒日記

Mood Journal 是一個使用 **React + Vite + Firebase** 建置的情緒日記 Web App。

這個專案最初來自我的 **iThome 鐵人賽「30 天 Vibe Coding」系列**，並保留每日功能開發與系統演進紀錄。

隨著專案持續開發，目前已從最初的 Web MVP 擴充為完整的 **文字 × 語音多模態情緒辨識系統**，整合：

- MacBERT 中文文字情緒辨識
- WavLM 語音情緒辨識
- Balanced Logistic Regression Late Fusion
- 七類情緒分類
- FastAPI inference backend
- Hugging Face model storage
- Google Cloud Run backend deployment
- Vercel frontend deployment

七類情緒：

```text
Anger
Disgust
Fear
Happy
Neutral
Sad
Surprise
```

---

## iThome 鐵人賽系列

本專案的開發過程記錄於 iThome 鐵人賽：

[30 天 Vibe Coding 系列](https://ithelp.ithome.com.tw/users/20140998/ironman/8438)

README 最下方亦保留 Day 11–29 的原始開發規劃與功能演進紀錄。

> 部分早期設計，例如正向／中立／負向三分類與初版情緒圖表，後續已由目前的七類多模態情緒辨識架構取代，但仍保留作為專案演進紀錄。

---

## Project Links

### Frontend Repository

[https://github.com/ninni13/MoodJournal](https://github.com/ninni13/MoodJournal)

### Current Backend / Machine Learning Repository (v2)

[https://github.com/ninni13/MoodJournal-backend-v2](https://github.com/ninni13/MoodJournal-backend-v2)

The v2 backend includes:
- M3ED preprocessing
- MacBERT training
- WavLM training
- Late Fusion experiments
- Balanced Logistic Regression Fusion
- Evaluation / reproducibility utilities
- FastAPI inference API
- Google Cloud Run deployment configuration

### Legacy Backend (v1)

The original version used separate services for text inference, speech inference,
and multimodal fusion. These repositories are retained for historical reference:

- Text inference: https://github.com/ninni13/MoodJournal_Text-infer
- Speech inference: https://github.com/ninni13/MoodJournal_Speech-infer
- Fusion gateway: https://github.com/ninni13/MoodJournal_fusion-gateway

The current production system has been consolidated and redesigned in
**MoodJournal-backend-v2**.
---

## 目前系統架構

```text
User Browser
     │
     ▼
Vercel
React + Vite Frontend
     │
     │ text + optional recorded audio
     ▼
Google Cloud Run
FastAPI Backend
     │
     ├───────────────┐
     │               │
     ▼               ▼
  MacBERT          WavLM
   Text            Speech
     │               │
     │ 7 probs       │ 7 probs
     └───────┬───────┘
             │
             ▼
   14-dimensional feature
             │
             ▼
Balanced Logistic Regression
             │
             ▼
      7-class Emotion
             │
             ▼
     Firebase Firestore
```

模型權重不儲存在 frontend repository。

Backend 啟動時由 Hugging Face private model repository 載入：

```text
MacBERT
WavLM
Balanced Fusion Model
```

---

## 功能特色

- Google 登入與保護路由：未登入時導向 `/login`。
- 日記新增、編輯、搜尋與日期篩選，依日期新到舊排序。
- 軟刪除與垃圾桶：支援還原及永久刪除。
- Firebase Firestore 雲端儲存。
- 七類文字情緒辨識。
- 七類語音情緒辨識。
- 文字 × 語音 multimodal emotion recognition。
- MacBERT + WavLM probability-level Late Fusion。
- API 無法使用時提供本地關鍵詞 fallback。
- 瀏覽器語音辨識與 MediaRecorder 錄音。
- 七類情緒 chip。
- 每日情緒分布圖。
- 情緒月曆。
- JSON／CSV 匯入匯出。
- IndexedDB 離線暫存與恢復連線同步。

---

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

API 回傳有效的 `confidence` 時，chip 顯示信心百分比。

本地 fallback 僅根據關鍵詞估計情緒，不代表正式 ML model prediction，也不顯示模型 confidence。

---

### 每日情緒分布

- 使用堆疊長條圖。
- 可切換最近 7 天或 30 天。
- 每篇日記依主要情緒計數。
- 同一天多篇日記會依情緒類別累加。
- 顏色僅代表情緒類別，不代表情緒好壞或強度。
- 不將模型 confidence 當作連續情緒分數進行平均。
- 主頁圖表會套用目前搜尋與日期篩選。
- 整段期間沒有日記時顯示空狀態。

---

### 情緒月曆

- 預設顯示本月。
- 主頁有日期篩選結束日時，顯示該日期所在月份。
- 每天顯示日記篇數與各類情緒比例。
- 同一天可呈現多種情緒。
- 點擊日期可查看當日日記與情緒 chip。
- 無日記日期顯示 `—`，不視為 Neutral。

---

### 舊資料相容

此專案最早使用：

```text
positive
neutral
negative
```

三分類。

目前已改為：

```text
Anger
Disgust
Fear
Happy
Neutral
Sad
Surprise
```

舊 `neutral` 標籤相容於 `Neutral`。

舊 `positive` / `negative` chip 會保留：

```text
舊分類：正向
舊分類：負向
```

提示。

在新版視覺化中，舊三分類資料與未辨識資料歸入：

```text
舊分類／未分類
```

系統不會自動推測舊 `positive` / `negative` 應對應至哪一個七類情緒。

重新編輯並儲存日記時可再次執行情緒分析。

---

## Multimodal Emotion Recognition

目前正式情緒辨識由獨立 FastAPI backend 提供。

### Text-only Mode

```text
Diary Text
    ↓
MacBERT
    ↓
7-class probabilities
```

若沒有錄音：

```text
audio_pred = null
audio_top1 = null
```

---

### Text + Speech Mode

```text
Text
 ↓
MacBERT
 ↓
7 probabilities
         \
          \
           → 14-dimensional feature
          /
         /
Audio
 ↓
FFmpeg
 ↓
WavLM
 ↓
7 probabilities
        ↓
Balanced Logistic Regression
        ↓
Final 7-class prediction
```

Fusion 使用兩個模型完整的 probability vectors，而不是單純比較兩個模型的 top-1。

因此：

```text
text_top1
audio_top1
fusion_top1
```

三者不一定相同。

---

## 技術架構

### Frontend

- React 19
- Vite 7
- React Router v6
- JavaScript / JSX
- TypeScript API client
- Recharts
- date-fns
- CryptoJS
- IndexedDB

### Firebase

- Firebase Authentication
- Google Sign-In
- Cloud Firestore
- Firestore Security Rules

### Backend

- Python
- FastAPI
- Uvicorn
- FFmpeg
- PyTorch
- Transformers
- scikit-learn

### Machine Learning

- MacBERT
- WavLM
- Balanced Logistic Regression Late Fusion

### Deployment

- Vercel — frontend
- Google Cloud Run — backend
- Hugging Face Hub — model storage
- Google Secret Manager — backend secret management

---

## 快速開始

環境需求：

```text
Node.js 20.19+
或
Node.js 22.12+
```

建議使用 Node.js 22。

Node 18 不符合目前 Vite 7 的需求。

安裝：

```bash
npm ci
```

開發模式：

```bash
npm run dev
```

Build：

```bash
npm run build
```

預覽 build：

```bash
npm run preview
```

Lint：

```bash
npm run lint
```

---

## Firebase 與環境變數

在 Firebase Console：

1. 建立 Firebase project。
2. 建立 Web App。
3. 啟用 Firebase Authentication。
4. 啟用 Google Sign-In。
5. 建立 Cloud Firestore。
6. 將開發及正式網域加入 Firebase Authentication Authorized Domains。

在專案根目錄建立：

```text
.env.local
```

例如：

```dotenv
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-firebase-app-id
VITE_FIREBASE_STORAGE_BUCKET=your-storage-bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id

# FastAPI backend base URL
VITE_GATEWAY_BASE=http://127.0.0.1:8000
```

Firebase 初始化至少需要：

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

---

## Production API Configuration

正式部署時：

```env
VITE_GATEWAY_BASE=https://<google-cloud-run-service-url>
```

Frontend 使用：

```text
${VITE_GATEWAY_BASE}/predict-fusion
```

呼叫 FastAPI。

因為 Vite 的 `VITE_` environment variables 會在 **build time** 寫入前端 bundle，因此修改 Vercel Environment Variables 後必須重新部署 frontend。

---

## 情緒分析 API

Frontend API client：

```text
src/lib/fusion.ts
```

發送：

```http
POST /predict-fusion
```

Content type：

```text
multipart/form-data
```

欄位：

```text
text
```

必填，日記文字。

```text
file
```

選填，瀏覽器錄音。

---

### API Response

Backend 回傳：

```text
mode
labels
text_pred
audio_pred
fusion_pred
text_top1
audio_top1
fusion_top1
confidence
```

其中：

```text
text_pred
```

為 MacBERT 七類 probabilities。

```text
audio_pred
```

為 WavLM 七類 probabilities。

```text
fusion_pred
```

為 Balanced Fusion 七類 probabilities。

純文字模式時：

```text
audio_pred = null
audio_top1 = null
```

---

## 本地 Fallback

若：

- 未設定 `VITE_GATEWAY_BASE`
- API 無法連線
- Backend request 失敗

日記仍可透過本地關鍵詞規則產生 fallback label。

這個結果僅用於確保日記功能仍可使用，不代表正式 ML model prediction。

---

## 使用方式與路由

1. 使用 Google 帳號登入。
2. 在主頁輸入日記。
3. 可選擇使用瀏覽器語音輸入或錄音。
4. 儲存時呼叫 FastAPI 進行情緒分析。
5. 查看七類情緒 chip 與 probability distribution。
6. 使用每日情緒分布與情緒月曆查看歷史情緒紀錄。
7. 可編輯既有日記並重新分析。
8. 刪除的日記可於垃圾桶還原或永久刪除。

| 路由 | 功能 |
| --- | --- |
| `/login` | Google 登入 |
| `/` | 日記 CRUD、搜尋、日期篩選、情緒分析與視覺化 |
| `/trash` | 已刪除日記、還原與永久刪除 |
| `/settings` | 提醒、隱私、匯入匯出 |

目前 `InsightsPage.jsx` 保留獨立視覺化頁面實作，但未在 `App.jsx` 註冊路由。

日常使用的視覺化位於主頁。

---

## 安全與隱私

Firestore Rules 限制登入使用者僅能存取自己的：

```text
users/{uid}/diaries/{docId}
users/{uid}/profile/{docId}
```

規則可於 Firebase Console 發布，或在設定 Firebase CLI 後：

```bash
firebase deploy --only firestore:rules
```

日記內容目前使用 CryptoJS AES 於前端加密後儲存為：

```text
contentEnc
```

目前實作使用 UID 作為 AES key。

這屬於示範用途的 client-side encryption，並非真正以使用者私密金鑰建立的端對端加密方案。

情緒標籤等 metadata 會另外儲存。

進行情緒分析時：

```text
日記文字
```

會傳送至 backend。

若啟用錄音分析：

```text
audio
```

也會送往 backend 進行 WavLM inference。

---

## Environment Variable Security

所有：

```text
VITE_*
```

environment variables 都會包含於 frontend bundle。

因此不要將以下資訊放入 frontend：

```text
Hugging Face access token
Google Cloud private credential
server secret
private API key
```

Hugging Face token 只存在 backend，並由 Google Secret Manager 管理。

---

## 專案結構

```text
src/
├── App.jsx
│   └── Router / protected routes
│
├── pages/
│   ├── DiaryPage.jsx
│   ├── TrashPage.jsx
│   ├── SettingsPage.jsx
│   └── InsightsPage.jsx
│
├── components/
│   ├── EmotionChip.jsx
│   └── EmotionInsights.jsx
│
├── lib/
│   ├── emotions.js
│   ├── fusion.ts
│   ├── firebase.js
│   └── idb.js
│
├── state/
│   └── AuthContext.jsx
│
├── App.css
└── index.css

firestore.rules
vite.config.js
package.json
```

主要檔案：

- `src/App.jsx`：路由與 Protected Route。
- `src/pages/DiaryPage.jsx`：日記 CRUD、分析、搜尋、篩選、離線同步與主頁視覺化。
- `src/pages/TrashPage.jsx`：垃圾桶。
- `src/pages/SettingsPage.jsx`：設定及匯入匯出。
- `src/pages/InsightsPage.jsx`：獨立情緒視覺化實作。
- `src/components/EmotionChip.jsx`：七類情緒 chip。
- `src/components/EmotionInsights.jsx`：情緒分布與月曆。
- `src/lib/emotions.js`：情緒定義與舊資料相容。
- `src/lib/fusion.ts`：FastAPI client。
- `src/lib/firebase.js`：Firebase 初始化。
- `src/lib/idb.js`：IndexedDB offline queue。
- `src/state/AuthContext.jsx`：登入狀態。

---

# iThome 鐵人賽開發歷程｜Day 11–29

以下內容保留本專案在「30 天 Vibe Coding」系列中的原始開發規劃。

部分功能後續已有更新或被正式 ML 系統取代，因此此區主要作為 **project evolution history**。

完整系列：

[https://ithelp.ithome.com.tw/users/20140998/ironman/8438](https://ithelp.ithome.com.tw/users/20140998/ironman/8438)

- Day 11：日記 MVP
- Day 12：Firestore 串接 + 帳號登入（僅本人可見）
- Day 13：CRUD（編輯、刪除、排序）
- Day 14：基礎文字情緒分析（正向／中立／負向）
- Day 15：情緒視覺化（折線圖 + 月曆熱力圖）
- Day 16：標籤與搜尋（tag / 日期篩選）
- Day 17：提醒與通知（每日提醒寫日記）
- Day 18：隱私與安全（Firestore Rules、本地加密選項）
- Day 19：匯出／匯入（JSON / CSV）
- Day 20：PWA / 離線模式概念與 IndexedDB
- Day 21：測試、部署與事件追蹤
- Day 22–23：進階文字情緒分類研究
- Day 24：進階分類器整合回日記
- Day 25：語音輸入
- Day 26：語音情緒模型研究
- Day 27：語音 API 串接與 Demo
- Day 28：模型效果驗證、Macro-F1、UAR 與 confusion matrix
- Day 29：文字 × 語音 Late Fusion

在原始鐵人賽階段結束後，專案持續開發並完成：

- 七類 MacBERT fine-tuning
- 七類 WavLM fine-tuning
- Weighted Fusion
- Learned Fusion
- Balanced Learned Fusion
- M3ED multimodal experiments
- FastAPI backend
- Hugging Face model storage
- Google Cloud Run deployment
- Google Secret Manager integration
- Vercel × Cloud Run production integration
- 七類 emotion visualization
- Production text-only inference
- Production multimodal inference

---

## 目前狀態

目前 Mood Journal 已完成：

- [x] Firebase Authentication
- [x] Firestore diary CRUD
- [x] Search / date filter
- [x] Trash / restore
- [x] IndexedDB offline queue
- [x] Import / export
- [x] Seven-class emotion system
- [x] MacBERT text inference
- [x] WavLM speech inference
- [x] Balanced Late Fusion
- [x] Browser microphone recording
- [x] Seven-class emotion visualization
- [x] FastAPI integration
- [x] Vercel frontend deployment
- [x] Google Cloud Run backend deployment
- [x] Production multimodal inference

Backend implementation and machine learning experiments are documented separately in:

[https://github.com/ninni13/MoodJournal-backend-v2](https://github.com/ninni13/MoodJournal-backend-v2)