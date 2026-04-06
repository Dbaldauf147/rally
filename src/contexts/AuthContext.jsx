import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Never stay loading forever
    const timeout = setTimeout(() => setLoading(false), 3000);
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      clearTimeout(timeout);
      setUser(firebaseUser || null);
      setLoading(false);
      // Sync user doc in background (don't block page load)
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        setDoc(userRef, {
          displayName: firebaseUser.displayName || '',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL || '',
          lastLogin: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }
    });
    return unsub;
  }, []);

  async function signInWithGoogle() {
    return signInWithPopup(auth, googleProvider);
  }

  async function signInWithEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function signUpWithEmail(email, password, displayName) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    return cred;
  }

  async function logOut() {
    return signOut(auth);
  }

  const value = { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, logOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
