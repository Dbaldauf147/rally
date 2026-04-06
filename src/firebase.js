import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBTTVm567ysbP-dVcTng0QkK373zLW2_cY",
  authDomain: "rally-bd41a.firebaseapp.com",
  projectId: "rally-bd41a",
  storageBucket: "rally-bd41a.firebasestorage.app",
  messagingSenderId: "800826246672",
  appId: "1:800826246672:web:076e4fa3014bd2631eac95",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export const googleProvider = new GoogleAuthProvider();
