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

  const toggleSettled = useCallback((expense, key) => {
    const settled = { ...(expense.settled || {}) };
    if (settled[key]) delete settled[key];
    else settled[key] = true;
    return patch(expense.id, { settled, updatedAt: new Date().toISOString() });
  }, [patch]);

  const settleAll = useCallback((expense, keys) => {
    const settled = { ...(expense.settled || {}) };
    for (const k of keys) settled[k] = true;
    return patch(expense.id, { settled, updatedAt: new Date().toISOString() });
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
    assignEvent, setParticipants, setSplit, setPaidBy, toggleSettled, settleAll, archive, remove,
  };
}
