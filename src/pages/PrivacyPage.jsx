import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  return (
    <article className="legal-page">
      <p className="eyebrow">PRIVACY</p>
      <h1 className="title">隱私權政策</h1>
      <p className="legal-updated">最後更新日期：2026 年 9 月 26 日</p>

      <p>
        「情緒日記」專案維護者（以下稱「本服務」）重視你的隱私。本政策說明本服務蒐集哪些資料、使用方式、可能接觸資料的服務供應商，以及你可以如何管理自己的資料。
      </p>

      <h2 className="subtitle">1. 資料蒐集者與聯絡方式</h2>
      <p>
        資料蒐集者：情緒日記專案維護者。若對個人資料、刪除帳號或本政策有疑問，請來信
        {' '}<a href="mailto:ninni13.dev@gmail.com">ninni13.dev@gmail.com</a>。
      </p>

      <h2 className="subtitle">2. 我們蒐集或處理的資料</h2>
      <ul>
        <li><strong>帳號資料：</strong>Google 登入提供的使用者識別碼、姓名、Email 與頭像等基本資料。</li>
        <li><strong>日記資料：</strong>你輸入或透過語音辨識產生的日記文字、日期，以及編輯、刪除與同步狀態。</li>
        <li><strong>情緒分析資料：</strong>模型產生的情緒類別、信心分數、機率、關鍵詞及相關分析結果。這些結果是自動推測，可能不準確。</li>
        <li><strong>錄音資料：</strong>你主動啟用語音輸入並允許使用錄音分析時所產生的音訊。</li>
        <li><strong>偏好設定：</strong>主題、Email 提醒、是否使用錄音分析等設定。</li>
        <li><strong>技術資料：</strong>Firebase 或其他基礎服務為登入、安全、防濫用及維運而處理的 IP 位址、瀏覽器、裝置或錯誤資訊。</li>
        <li><strong>本機資料：</strong>主題偏好，以及離線時尚未同步的日記內容。</li>
      </ul>

      <h2 className="subtitle">3. 蒐集與使用目的</h2>
      <ul>
        <li>驗證身分並讓你存取自己的日記。</li>
        <li>儲存、同步、搜尋、匯出、匯入及呈現日記。</li>
        <li>提供文字、語音及多模態情緒分析與趨勢圖表。</li>
        <li>在你開啟提醒且當日尚未寫日記時寄送 Email。</li>
        <li>維護服務安全、偵錯、避免濫用及改善穩定性。</li>
        <li>遵守適用法令或回應合法要求。</li>
      </ul>
      <p>我們不會出售你的日記或個人資料，也不會將日記用於與本服務無關的廣告投放。</p>

      <h2 className="subtitle">4. 錄音與情緒分析</h2>
      <p>
        語音輸入可能同時進行瀏覽器語音辨識與錄音。當你允許使用錄音分析時，日記文字及錄音會傳送至本服務設定的情緒分析後端，以產生分析結果。本應用前端不會將原始錄音寫入 Firestore；錄音會保留在目前的瀏覽器工作階段中，直到你移除錄音、儲存日記、重新錄音或離開頁面。
      </p>
      <p>
        本服務不以永久保存原始錄音為目的。分析服務仍可能依其安全、錯誤排查或基礎設施設定處理必要的短期技術紀錄。若不希望傳送錄音，可以在設定中關閉錄音分析，或在送出前按「移除錄音」；此時系統只會使用文字進行分析。
      </p>

      <h2 className="subtitle">5. 資料保存、地區與處理方式</h2>
      <ul>
        <li>帳號、設定、日記與分析結果通常保存至你刪除資料、帳號終止，或本服務不再需要該資料為止；依法必須保存者不在此限。</li>
        <li>日記內容會以應用程式層的加密格式存入 Cloud Firestore，並搭配 Firebase Security Rules 限制存取；任何安全措施均無法保證絕對安全。</li>
        <li>離線待同步的日記會暫存在目前裝置的 IndexedDB，恢復連線後再同步。清除瀏覽器資料可能使尚未同步的內容遺失。</li>
        <li>資料可能由位於台灣境外的雲端與服務供應商處理，包括美國或供應商設施設置的其他地區。</li>
      </ul>

      <h2 className="subtitle">6. 服務供應商</h2>
      <p>為提供功能，本服務可能由下列供應商受託處理必要資料：</p>
      <ul>
        <li><strong>Google Firebase：</strong>Google 登入、身分驗證、Cloud Firestore 與相關雲端基礎服務。</li>
        <li><strong>情緒分析 API：</strong>處理你送出的文字及選擇提供的錄音，回傳情緒分析結果。</li>
        <li><strong>Twilio SendGrid：</strong>在你開啟提醒後寄送提醒 Email。</li>
        <li><strong>GitHub Actions：</strong>依排程執行提醒工作，短暫處理寄送所需的帳號與提醒狀態。</li>
        <li><strong>網站託管與網路供應商：</strong>提供網站、連線、安全與部署服務。</li>
      </ul>
      <p>供應商只應在提供服務及履行法定義務所需範圍內處理資料，並受各自條款與隱私政策約束。</p>

      <h2 className="subtitle">7. 你的選擇與權利</h2>
      <p>依適用法令，你可以請求查詢、閱覽、取得複本、補充、更正、停止蒐集或利用，以及刪除個人資料。你也可以：</p>
      <ul>
        <li>直接編輯、刪除或永久刪除個別日記。</li>
        <li>從設定頁匯出 JSON 或 CSV 格式的日記。</li>
        <li>隨時關閉 Email 提醒或錄音分析。</li>
        <li>來信申請刪除帳號及相關雲端資料。</li>
      </ul>
      <p>我們可能需要先確認申請人身分，並會在法令及合理作業期間內處理。若你不提供登入所需資料，將無法建立帳號或使用雲端同步；不提供錄音不影響文字日記功能。</p>

      <h2 className="subtitle">8. 資料安全與事件通知</h2>
      <p>
        本服務使用身分驗證、資料庫存取規則、傳輸加密及必要的權限控管保護資料。如發現可能影響你權益的資料外洩或安全事件，我們會依適用法令採取應變措施並進行通知。
      </p>

      <h2 className="subtitle">9. 未成年人</h2>
      <p>未成年人應在法定代理人理解並同意本政策後使用本服務。若我們得知在缺乏必要同意的情況下蒐集了未成年人的資料，將在合理範圍內協助刪除。</p>

      <h2 className="subtitle">10. 政策更新</h2>
      <p>本政策可能因功能、供應商或法令變更而更新。我們會在本頁標示更新日期；若變更會重大影響你的權利，將以適當方式另行通知。</p>

      <div className="legal-actions">
        <Link to="/login" className="btn btn-outline">返回登入</Link>
        <Link to="/terms" className="legal-secondary-link">查看服務條款</Link>
      </div>
    </article>
  )
}
