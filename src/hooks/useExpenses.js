import { useState, useEffect, useCallback } from 'react';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

// Stable identity so a signed-out render doesn't hand consumers a new array
// every time.
const EMPTY = [];

/* Charges that need splitting, pushed in from Wealth Architect.

   Nothing here creates an expense — they only arrive through
   /api/split-expenses. What this hook offers is everything you do to one
   afterwards: put it on an event, choose who is in on it, set the shares, and
   tick people off as they pay you back. */
export function useExpenses() {
  const { user } = useAuth();
  const [state, setState] = useState({ expenses: EMPTY, loading: true, error: null });

  useEffect(() => {
    // Signed out isn't a state to write — it's derived below. Setting it here
    // would mean a synchronous setState in the effect body and a wasted render
    // on every sign-out.
    if (!user) return undefined;
    // Newest charge first. Ordering in the query rather than in JS keeps the
    // list stable while someone is editing a row further down.
    const q = query(collection(db, 'expenses'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setState({
        expenses: snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.archived),
        loading: false,
        error: null,
      });
    }, (err) => {
      setState({ expenses: EMPTY, loading: false, error: err.message });
    });
    return () => unsub();
  }, [user]);

  const expenses = user ? state.expenses : EMPTY;
  const loading = user ? state.loading : false;
  const error = user ? state.error : null;

  const patch = useCallback((id, fields) => updateDoc(doc(db, 'expenses', id), fields), []);

  const assignEvent = useCallback((expense, eventId, memberKeys) => patch(expense.id, {
    eventId: eventId || null,
    // Moving an expense to a different event carries its old shares nowhere
    // useful — the people are different — so participants reset to everyone on
    // the new event and the split goes back to even.
    participants: eventId ? [...new Set([expense.paidBy, ...(memberKeys || [])].filter(Boolean))] : [expense.paidBy].filter(Boolean),
    splitMode: 'even',
    shares: {},
    settled: {},
    updatedAt: new Date().toISOString(),
  }), [patch]);

  const setParticipants = useCallback((expense, keys) => patch(expense.id, {
    participants: [...new Set(keys.filter(Boolean))],
    updatedAt: new Date().toISOString(),
  }), [patch]);

  const setSplit = useCallback((expense, { splitMode, shares }) => patch(expense.id, {
    splitMode,
    shares: shares || {},
    updatedAt: new Date().toISOString(),
  }), [patch]);

  const setPaidBy = useCallback((expense, key) => patch(expense.id, {
    paidBy: key,
    participants: [...new Set([key, ...(expense.participants || [])])],
    updatedAt: new Date().toISOString(),
  }), [patch]);

  /* Log a payment against one person's share.

     The whole array is rewritten rather than arrayUnion'd: two payments of the
     same amount on the same day are identical objects to Firestore, and
     arrayUnion would silently collapse them into one — losing a real payment.

     Recording a payment also clears that person's legacy `settled` flag, so
     the two ways of saying "they paid" can never disagree. */
  const addPayment = useCallback((expense, key, amount, note) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) return Promise.resolve();
    const settled = { ...(expense.settled || {}) };
    delete settled[key];
    return patch(expense.id, {
      payments: [...(expense.payments || []), {
        id: crypto.randomUUID(),
        key,
        amount: value,
        at: new Date().toISOString(),
        note: (note || '').slice(0, 200),
      }],
      settled,
      updatedAt: new Date().toISOString(),
    });
  }, [patch]);

  const removePayment = useCallback((expense, paymentId) => patch(expense.id, {
    payments: (expense.payments || []).filter(p => p.id !== paymentId),
    updatedAt: new Date().toISOString(),
  }), [patch]);

  /* Settle several people at once, each for exactly what they still owe. One
     write, so "everyone paid" can't half-apply. */
  const payRemaining = useCallback((expense, owed) => {
    const entries = Object.entries(owed).filter(([, left]) => Number(left) > 0);
    if (!entries.length) return Promise.resolve();
    const at = new Date().toISOString();
    const settled = { ...(expense.settled || {}) };
    for (const [key] of entries) delete settled[key];
    return patch(expense.id, {
      payments: [
        ...(expense.payments || []),
        ...entries.map(([key, left]) => ({
          id: crypto.randomUUID(), key, amount: Number(left), at, note: '',
        })),
      ],
      settled,
      updatedAt: at,
    });
  }, [patch]);

  // Archive rather than delete: the charge still exists in the bank feed, and
  // a hard delete would let the next push from Wealth Architect recreate it as
  // if it were new.
  const archive = useCallback((expense) => patch(expense.id, {
    archived: true, updatedAt: new Date().toISOString(),
  }), [patch]);

  const remove = useCallback((expense) => deleteDoc(doc(db, 'expenses', expense.id)), []);

  return {
    expenses, loading, error,
    assignEvent, setParticipants, setSplit, setPaidBy,
    addPayment, removePayment, payRemaining, archive, remove,
  };
}
