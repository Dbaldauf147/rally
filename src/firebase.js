import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  inMemoryPersistence,
  GoogleAuthProvider,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'firebase/firestore';
import { isNativeApp } from './native';

const firebaseConfig = {
  apiKey: "AIzaSyBTTVm567ysbP-dVcTng0QkK373zLW2_cY",
  authDomain: "rally-bd41a.firebaseapp.com",
  projectId: "rally-bd41a",
  storageBucket: "rally-bd41a.firebasestorage.app",
  messagingSenderId: "800826246672",
  appId: "1:800826246672:web:076e4fa3014bd2631eac95",
};

const app = initializeApp(firebaseConfig);

const native = isNativeApp();

// Auth: the iOS WKWebView's IndexedDB can hang, and Firebase Auth persists to
// IndexedDB by default — which makes signInWithEmailAndPassword never resolve.
// Use localStorage-backed persistence in the native shell to avoid that.
export const auth = native
  ? initializeAuth(app, { persistence: [browserLocalPersistence, inMemoryPersistence] })
  : getAuth(app);

// Firestore: in the native WKWebView, the streaming WebChannel transport is
// unreliable (requests hang), and IndexedDB persistence is the same liability
// as above. Force long-polling and an in-memory cache there. On web, keep the
// persistent IndexedDB cache (falling back to memory if unavailable).
let _db;
if (native) {
  _db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
  });
} else {
  try {
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    _db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}
export const db = _db;
export const googleProvider = new GoogleAuthProvider();
