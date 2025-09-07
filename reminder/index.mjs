import { DateTime } from 'luxon'
import admin from 'firebase-admin'
import sgMail from '@sendgrid/mail'

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  SENDGRID_API_KEY,
  FROM_EMAIL,
  TZ: DEFAULT_TZ = 'Asia/Taipei',
  APP_URL = 'http://localhost:5173',
} = process.env

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('Missing Firebase service account envs')
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
})
const db = admin.firestore()

if (!SENDGRID_API_KEY || !FROM_EMAIL) {
  console.error('Missing SendGrid envs')
}
sgMail.setApiKey(SENDGRID_API_KEY)

function dayKeyInTZ(tz = DEFAULT_TZ) {
  return DateTime.now().setZone(tz).toFormat('yyyy-LL-dd')
}

function tzRange(tz = DEFAULT_TZ) {
  const start = DateTime.now().setZone(tz).startOf('day')
  const end = start.plus({ days: 1 })
  return { start: start.toJSDate(), end: end.toJSDate() }
}

async function getProfiles() {
  // Prefer collectionGroup('profile') so parent document存在與否不影響
  const snap = await db.collectionGroup('profile').get()
  return snap.docs.map(d => ({ ref: d.ref, data: d.data(), uid: d.ref.parent.parent?.id }))
}

async function hasDiaryToday(uid, tz) {
  const diaries = db.collection('users').doc(uid).collection('diaries')
  const dateKey = dayKeyInTZ(tz)
  // Try string equality first
  try {
    const s = await diaries.where('date', '==', dateKey).limit(1).get()
    if (!s.empty) {
      const ok = s.docs.some(doc => doc.get('isDeleted') !== true)
      if (ok) return true
    }
  } catch {}
  // Fallback to Timestamp range
  try {
    const { start, end } = tzRange(tz)
    const startTs = admin.firestore.Timestamp.fromDate(start)
    const endTs = admin.firestore.Timestamp.fromDate(end)
    const q = await diaries.where('date', '>=', startTs).where('date', '<', endTs).limit(1).get()
    if (!q.empty) {
      const ok = q.docs.some(doc => doc.get('isDeleted') !== true)
      if (ok) return true
    }
  } catch {}
  return false
}

function shouldSendNow(tz, timeStr, windowMinutes = 15) {
  try {
    const now = DateTime.now().setZone(tz)
    let t = timeStr && typeof timeStr === 'string' ? timeStr : '21:00'
    if (!/^\d{2}:\d{2}$/.test(t)) t = '21:00'
    const [hh, mm] = t.split(':').map(n => parseInt(n, 10))
    const scheduled = now.set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
    const diff = now.diff(scheduled, 'minutes').minutes
    // send if 0 <= diff < window, i.e., within window after scheduled time
    return diff >= 0 && diff < windowMinutes
  } catch {
    return false
  }
}

async function sendReminder(toEmail) {
  const msg = {
    to: toEmail,
    from: FROM_EMAIL,
    subject: '📝 小提醒：今天寫一則情緒日記嗎？',
    text: '嗨！今天還沒有日記紀錄。花 1 分鐘寫下當下的感受，讓自己看見情緒的脈絡 :)',
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
        <p>嗨！今天還沒有日記紀錄。</p>
        <p>花 1 分鐘寫下當下的感受，讓自己看見情緒的脈絡 :)</p>
        <p><a href="${APP_URL}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#d36f72;color:#fff;text-decoration:none">前往寫日記</a></p>
      </div>
    `,
  }
  await sgMail.send(msg)
}

async function main() {
  const profs = await getProfiles()
  let sent = 0
  let skipped = 0

  for (const p of profs) {
    const { uid, data } = p
    if (!uid) { skipped++; continue }
    const email = data?.email
    const enabled = data?.reminderEnabled === true || data?.reminderOptIn === true
    if (!email || !enabled) { skipped++; continue }
    const tz = data?.timezone || DEFAULT_TZ
    const timeStr = data?.reminderTime || '21:00'
    const lastSentKey = data?.lastReminderSentDate

    // Check if it's the right time window in user's timezone
    if (!shouldSendNow(tz, timeStr)) { skipped++; continue }

    const has = await hasDiaryToday(uid, tz)
    if (has) { skipped++; continue }

    try {
      // Avoid duplicate within the same day
      const todayKey = DateTime.now().setZone(tz).toFormat('yyyy-LL-dd')
      if (lastSentKey === todayKey) { skipped++; continue }
      await sendReminder(email)
      sent++
      // Write back last sent markers
      await p.ref.set({ lastReminderSentDate: todayKey, lastReminderSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      await new Promise(r => setTimeout(r, 250))
    } catch (e) {
      console.error('send fail', uid, email, e?.message)
      skipped++
    }
  }

  console.log(JSON.stringify({ sent, skipped, total: profs.length }))
}

main().catch(e => { console.error(e); process.exit(1) })
