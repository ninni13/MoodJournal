import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  return (
    <div>
      <h1 className="title">隱私權政策 Privacy Policy</h1>
      <p style={{ color: '#666', fontSize: 14 }}>最後更新日期：2025 年 9 月 13 日</p>

      <p style={{ lineHeight: 1.8 }}>
        本服務「情緒日記」（以下簡稱「本服務」）重視您的隱私，特此說明我們如何蒐集、使用與保護您的資料。使用本服務即表示您同意以下政策內容。
      </p>

      <h2 className="subtitle">1. 蒐集的資料</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>登入資訊：透過 Google 登入取得的帳號基本識別（名稱、電子郵件）。</li>
        <li>使用內容：您於日記中輸入的文字與情緒標記。</li>
        <li>技術資訊：基本瀏覽器或系統紀錄，用於改善服務。</li>
      </ul>

      <h2 className="subtitle">2. 使用方式</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>您的資料僅用於提供個人化的日記紀錄、情緒分析與回顧功能。</li>
        <li>我們不會將您的日記或個資出售、出租或提供給第三方。</li>
      </ul>

      <h2 className="subtitle">3. 儲存與保護</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>資料儲存於 Google Firestore，並透過 Firebase Security Rules 保護。</li>
        <li>僅限您本人登入後可存取您的日記。</li>
      </ul>

      <h2 className="subtitle">4. 您的權利</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>您可以隨時要求刪除帳號與所有日記紀錄。</li>
        <li>
          若有相關需求，請聯絡我們（Email: <a href="mailto:your-email@example.com">your-email@example.com</a>）。
        </li>
      </ul>

      <h2 className="subtitle">5. 政策更新</h2>
      <p style={{ lineHeight: 1.8 }}>
        我們可能不時更新本政策，更新後將於本頁公告最新版本。
      </p>

      <div style={{ marginTop: 16 }}>
        <Link to="/login" className="btn btn-outline">返回登入</Link>
      </div>
    </div>
  )
}

