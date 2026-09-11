import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

// Web API keys are not secrets; they identify the project, they do not authorise
// anything. Access is controlled by firestore.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyB39hgA2EXQfh4On3Sbi47chIwo3kwAGlo',
  authDomain: 'crowdcontroldiwali.firebaseapp.com',
  projectId: 'crowdcontroldiwali',
  storageBucket: 'crowdcontroldiwali.firebasestorage.app',
  messagingSenderId: '415131672506',
  appId: '1:415131672506:web:e1981ff82cb94c0d208783',
}

// No measurementId, no getAnalytics. This app collects no usage data.
export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)

// Offline persistence is the whole product. Every tap is written to IndexedDB
// first and synced by Firestore whenever the connection comes back. We do not
// hand-roll a sync layer.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})
