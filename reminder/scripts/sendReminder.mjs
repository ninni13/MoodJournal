import 'dotenv/config'
import admin from 'firebase-admin'
import sgMail from '@sendgrid/mail'
import fs from 'node:fs'
import path from 'node:path'

const {
  FIREBASE_PROJECT_ID,
  CLIENT_EMAIL,
  PRIVATE_KEY,
  SENDGRID_API_KEY,
  FROM_EMAIL,
  FROM_NAME,
  APP_URL,
} = process.env

const WEB_URL = (APP_URL || 'http://localhost:5173').trim()
const SENDER = { email: FROM_EMAIL, name: FROM_NAME || 'Mood Journal' }

// Attempt to load serviceAccount.json from repo (prefer file over env)
let serviceAccount = null
try {
  const candidates = [
    path.resolve(process.cwd(), 'serviceAccount.json'),
    path.resolve(process.cwd(), '..', 'serviceAccount.json'),
    path.resolve(process.cwd(), '../../serviceAccount.json'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      serviceAccount = JSON.parse(raw)
      break
    }
  }
} catch {}

const fixedPrivateKey = PRIVATE_KEY?.replace(/\\n/g, '\n')
const effectiveProjectId = serviceAccount?.project_id || FIREBASE_PROJECT_ID
if (effectiveProjectId) {
  if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = effectiveProjectId
  if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = effectiveProjectId
}

if (!admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: effectiveProjectId,
    })
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: CLIENT_EMAIL,
        privateKey: fixedPrivateKey,
      }),
      projectId: FIREBASE_PROJECT_ID,
    })
  }
}
const db = admin.firestore()

// Debug whoami
console.log('[whoami] init source     =', serviceAccount ? 'serviceAccount.json' : 'env credentials')
console.log('[whoami] env projectId   =', process.env.FIREBASE_PROJECT_ID)
console.log('[whoami] sa clientEmail  =', (serviceAccount?.client_email || process.env.CLIENT_EMAIL || '').slice(0, 20) + '…')
console.log('[whoami] admin.projectId =', admin.app().options?.projectId || '(none)')
console.log('[whoami] WEB_URL         =', WEB_URL)

if (!SENDGRID_API_KEY || !FROM_EMAIL) {
  console.error('[reminder] Missing SENDGRID_API_KEY or FROM_EMAIL env')
}
sgMail.setApiKey(SENDGRID_API_KEY)

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfDay(d = new Date()) {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

async function hasDiaryToday(uid) {
  const userRef = db.collection('users').doc(uid)
  const diaries = userRef.collection('diaries')
  try {
    const key = todayKey()
    const eq = await diaries.where('date', '==', key).limit(1).get()
    if (!eq.empty) {
      const ok = eq.docs.some(d => d.get('isDeleted') !== true)
      if (ok) return true
    }
  } catch {}
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
  // Use collectionGroup so parent user doc is not required to exist
  const profSnap = await db.collectionGroup('profile').get()
  console.log('[debug] profiles found =', profSnap.size)

  let sent = 0, skipped = 0
  let reasons = { noEmail: 0, disabled: 0, wrote: 0 }

  for (const d of profSnap.docs) {
    const uid = d.ref.parent.parent?.id
    if (!uid) { skipped++; continue }
    const email = d.get('email')
    const enabled = d.get('reminderEnabled') === true
    if (!email) { skipped++; reasons.noEmail++; continue }
    if (!enabled) { skipped++; reasons.disabled++; continue }

    const wrote = await hasDiaryToday(uid)
    if (wrote) { skipped++; reasons.wrote++; continue }

    await sgMail.send({
      to: email,
      from: SENDER,
      subject: '來自 Mood Journal 的提醒：今天記錄一下心情嗎？',
      text: `今天還沒寫日記。花 1 分鐘記錄一下今天的心情吧！\n前往寫日記：${WEB_URL}`,
      html: `<p>今天還沒寫日記。<b>花 1 分鐘記錄一下今天的心情吧！</b></p>
             <p><a href="${WEB_URL}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#d36f72;color:#fff;text-decoration:none">前往寫日記</a></p>
             <p style=\"font-size:12px;color:#666\">若按鈕無法開啟，請複製貼上網址：<br>${WEB_URL}</p>`,
    })
    sent++
    await new Promise(r => setTimeout(r, 200))
  }
  console.log(JSON.stringify({ sent, skipped, reasons }))
}

main().catch(err => { console.error(err); process.exit(1) })
