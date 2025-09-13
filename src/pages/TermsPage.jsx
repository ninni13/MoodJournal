import { Link } from 'react-router-dom'

export default function TermsPage() {
  return (
    <div>
      <h1 className="title">服務條款 Terms of Service</h1>
      <p style={{ color: '#666', fontSize: 14 }}>最後更新日期：2025 年 9 月 13 日</p>

      <p style={{ lineHeight: 1.8 }}>
        歡迎使用「情緒日記」。使用本服務即表示您同意以下條款：
      </p>

      <h2 className="subtitle">1. 使用規範</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>本服務僅供個人用途，請勿用於任何違法或不當行為。</li>
        <li>您需對自己帳號下的所有行為負責。</li>
      </ul>

      <h2 className="subtitle">2. 資料使用</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>您於本服務輸入的日記屬於您個人所有，我們僅在您使用本服務時處理與儲存。</li>
        <li>您授權本服務使用資料進行必要的處理（如情緒分析、可視化），以提供功能。</li>
      </ul>

      <h2 className="subtitle">3. 免責聲明</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>本服務提供「現狀」功能，不保證絕對無誤或不中斷。</li>
        <li>任何因服務使用所產生的資料遺失或心理影響，本服務不承擔法律責任。</li>
      </ul>

      <h2 className="subtitle">4. 修改與終止</h2>
      <ul style={{ lineHeight: 1.8 }}>
        <li>我們保留隨時修改或終止服務的權利。</li>
        <li>條款若有修改，將於本頁公告並即時生效。</li>
      </ul>

      <div style={{ marginTop: 16 }}>
        <Link to="/login" className="btn btn-outline">返回登入</Link>
      </div>
    </div>
  )
}

