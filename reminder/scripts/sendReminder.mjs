import 'dotenv/config'
import admin from 'firebase-admin'
import sgMail from '@sendgrid/mail'

const {
  FIREBASE_PROJECT_ID,
  CLIENT_EMAIL,
  PRIVATE_KEY,
  SENDGRID_API_KEY,
  FROM_EMAIL,
} = process.env

const fixedPrivateKey = PRIVATE_KEY?.replace(/\\n/g, '\n')

// Help Admin SDK pick the correct project id in all environments
if (FIREBASE_PROJECT_ID) {
  if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = FIREBASE_PROJECT_ID
  if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = FIREBASE_PROJECT_ID
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: CLIENT_EMAIL,
      privateKey: fixedPrivateKey,
    }),
    projectId: FIREBASE_PROJECT_ID,
  })
}
const db = admin.firestore()

// --- Debug whoami ---
console.log('[whoami] env projectId   =', process.env.FIREBASE_PROJECT_ID)
console.log('[whoami] sa clientEmail  =', (process.env.CLIENT_EMAIL || '').slice(0, 20) + '…')
console.log('[whoami] admin.projectId =', admin.app().options?.projectId || '(none)')

if (!SENDGRID_API_KEY || !FROM_EMAIL) {
  console.error('[reminder] Missing SENDGRID_API_KEY or FROM_EMAIL env')
}
sgMail.setApiKey(SENDGRID_API_KEY)

function startOfDay(d = new Date()) {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function hasDiaryToday(uid) {
  const userRef = db.collection('users').doc(uid)
  const diaries = userRef.collection('diaries')
  // First: string date equality (matches current frontend)
  try {
    const key = todayKey()
    const eq = await diaries.where('date', '==', key).limit(1).get()
    if (!eq.empty) {
      const ok = eq.docs.some(d => d.get('isDeleted') !== true)
      if (ok) return true
    }
  } catch {}
  // Fallback: Timestamp range
  try {
    const start = startOfDay()
    const end = new Date(start); end.setDate(end.getDate() + 1)
    const startTs = admin.firestore.Timestamp.fromDate(start)
    const endTs = admin.firestore.Timestamp.fromDate(end)
    const snap = await diaries.where('date', '>=', startTs).where('date', '<', endTs).limit(1).get()
    if (!snap.empty) {
      const ok = snap.docs.some(d => d.get('isDeleted') !== true)
      if (ok) return true
    }
  } catch {}
  return false
}

async function main() {
  const usersSnap = await db.collection('users').get()
  const todayStart = startOfDay()
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1)

  let sent = 0, skipped = 0

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id

    // Read profile from subcollection 'profile/default'
    const profRef = db.collection('users').doc(uid).collection('profile').doc('default')
    const profSnap = await profRef.get().catch(() => null)
    const email = profSnap?.exists ? profSnap.get('email') : null
    const enabled = profSnap?.exists ? profSnap.get('reminderEnabled') === true : false
    if (!email || !enabled) { skipped++; continue }

    // Skip if already wrote today
    const wrote = await hasDiaryToday(uid)
    if (wrote) { skipped++; continue }

    await sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: '📝 溫柔提醒：今天記錄一下心情嗎？',
      text: '今天還沒寫日記。花 1 分鐘記錄一下今天的心情吧！',
      html: '<p>今天還沒寫日記。<b>花 1 分鐘記錄一下今天的心情吧！</b></p>',
    })
    sent++
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(JSON.stringify({ sent, skipped }))
}

main().catch(err => { console.error(err); process.exit(1) })
