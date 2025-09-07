const functions = require('firebase-functions')
const admin = require('firebase-admin')
const sgMail = require('@sendgrid/mail')

admin.initializeApp()
const db = admin.firestore()

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const MAIL_FROM = process.env.MAIL_FROM
const FUNCTION_SECRET_KEY = process.env.FUNCTION_SECRET_KEY
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY)
}

function dateKeyInTZ(tz, ref = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    return fmt.format(ref) // yyyy-mm-dd
  } catch {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    return fmt.format(ref)
  }
}

function addDaysToKey(key, days) {
  const [y, m, d] = key.split('-').map(n => parseInt(n, 10))
  const dt = new Date(Date.UTC(y, (m - 1), d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const y2 = dt.getUTCFullYear()
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d2 = String(dt.getUTCDate()).padStart(2, '0')
  return `${y2}-${m2}-${d2}`
}

async function hasDiaryForDate(uid, dateKey) {
  const col = db.collection('users').doc(uid).collection('diaries')

  // First try: string equality (matches current frontend implementation)
  try {
    const q1 = await col.where('date', '==', dateKey).limit(1).get()
    if (!q1.empty) {
      const doc = q1.docs.find(d => d.get('isDeleted') !== true)
      if (doc) return true
    }
  } catch (e) {
    // ignore
  }

  // Second try: timestamp range [start, next)
  try {
    const start = admin.firestore.Timestamp.fromDate(new Date(`${dateKey}T00:00:00.000Z`))
    const next = admin.firestore.Timestamp.fromDate(new Date(`${addDaysToKey(dateKey, 1)}T00:00:00.000Z`))
    const q2 = await col.where('date', '>=', start).where('date', '<', next).limit(1).get()
    if (!q2.empty) {
      const doc = q2.docs.find(d => d.get('isDeleted') !== true)
      if (doc) return true
    }
  } catch (e) {
    // ignore
  }

  return false
}

async function sendEmail(to, subject, html) {
  if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set')
  if (!MAIL_FROM) throw new Error('MAIL_FROM not set')
  const msg = {
    to,
    from: MAIL_FROM,
    subject,
    text: '寫個小日記吧',
    html,
  }
  await sgMail.send(msg)
}

exports.sendDailyReminders = functions.region('asia-east1').https.onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST')
      return res.status(405).json({ error: 'Method Not Allowed' })
    }
    const providedKey = (req.query.key || req.query.apiKey || req.headers['x-functions-key'] || '').toString()
    if (!FUNCTION_SECRET_KEY || providedKey !== FUNCTION_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const profSnap = await db.collectionGroup('profile').where('reminderEnabled', '==', true).get()
    let sent = 0
    let skipped = 0
    for (const d of profSnap.docs) {
      const data = d.data() || {}
      const uid = d.ref.parent.parent && d.ref.parent.parent.id
      const email = data.email
      const tz = data.timezone || 'Asia/Taipei'
      if (!uid || !email) { skipped++; continue }

      const todayKey = dateKeyInTZ(tz)
      const hasAny = await hasDiaryForDate(uid, todayKey)
      if (hasAny) { skipped++; continue }

      // Compose message
      const subject = '寫個小日記吧 📝'
      const html = `
        <div style="font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size:16px; color:#111">
          <p>嗨，你今天還沒寫日記喔！花 1 分鐘記下此刻的心情吧～</p>
          <p>
            <a href="${APP_URL}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#d36f72;color:#fff;text-decoration:none">前往「霓的情緒日記」</a>
          </p>
          <p style="color:#666;font-size:13px">若不想再收到提醒，可在 App 內關閉提醒。</p>
        </div>`
      try {
        await sendEmail(email, subject, html)
        sent++
      } catch (e) {
        // If email fails, skip and continue
        console.error('send failed', uid, email, e?.message)
        skipped++
      }
    }

    return res.json({ sent, skipped, total: profSnap.size })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
})

