import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Read config from Vite env vars
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
}

// Allow running the app without Firebase env configured (shows login page with hint)
const required = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
]

export const firebaseEnabled = required.every(Boolean)

let app
let _auth = null
let _db = null
let _provider = null

if (firebaseEnabled) {
  // Initialize Firebase (guard against duplicate init in HMR)
  if (!globalThis.__firebase_app__) {
    app = initializeApp(firebaseConfig)
    globalThis.__firebase_app__ = app
  } else {
    app = globalThis.__firebase_app__
  }
  _auth = getAuth(app)
  _db = getFirestore(app)
  _provider = new GoogleAuthProvider()
} else {
  // eslint-disable-next-line no-console
  console.warn('[Firebase] env missing. Fill .env.local to enable Auth/Firestore.')
}

export const auth = _auth
export const db = _db
export const provider = _provider

export async function signInWithGoogle() {
  if (!firebaseEnabled || !_auth || !_provider) {
    throw new Error('Firebase 未設定，請先建立 .env.local 並重啟開發伺服器')
  }
  return signInWithPopup(_auth, _provider)
}

export async function logout() {
  if (!firebaseEnabled || !_auth) return
  return signOut(_auth)
}
