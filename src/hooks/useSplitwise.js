import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { matchGroupMembers, buildExpense } from '../lib/splitwise';

/* The Splitwise connection, and the one way to push a charge across.
 *
 * Both surfaces need this: a trip's Expenses tab, where every charge belongs to
 * the same trip, and the Trip Expenses page, where they belong to different
 * ones or to none. They had better agree about what gets sent — the shares are
 * money, and two copies of this drifting apart would be two different answers
 * to "what does Amy owe".
 *
 * The key is personal and lives on the server, so everything goes through
 * /api/splitwise. Nothing is ever read back: Rally decides the split, Splitwise
 * is where the people who live in Splitwise see it.
 */
export function useSplitwise() {
  const { user } = useAuth() || {};
  const [state, setState] = useState({
    loading: true, configured: false, groups: [], me: null, error: '',
  });

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/splitwise', {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) {
          setState({ loading: false, configured: false, groups: [], me: null, error: data.error || `Failed (${res.status})` });
        } else {
          setState({ loading: false, configured: !!data.configured, groups: data.groups || [], me: data.me || null, error: '' });
        }
      } catch (err) {
        // No route at all, or offline. Not worth shouting about — the section
        // simply doesn't appear.
        if (live) setState({ loading: false, configured: false, groups: [], me: null, error: err.message });
      }
    })();
    return () => { live = false; };
  }, [user]);

  /* Send one charge, with the shares exactly as Rally has them.
   *
   * `people` is who Rally thinks is on the trip, `shares` its key → dollars
   * map. Anyone with a share who isn't in the Splitwise group is named rather
   * than quietly dropped: dropping them would make the shares stop adding up to
   * the cost, and Splitwise would refuse it with an arithmetic complaint that
   * says nothing about the real problem.
   */
  const send = useCallback(async ({ group, people, expense, shares, actions, nameFor }) => {
    if (!group) throw new Error('Pick a Splitwise group first.');
    if (!user) throw new Error('Sign in first.');
    // You are the account the key belongs to, so you match by that rather than
    // by email — an organiser's own member row rarely carries one.
    const { matched } = matchGroupMembers(people, group.members,
      state.me?.id != null && user.uid ? { key: user.uid, splitwiseId: state.me.id } : null);

    const missing = Object.entries(shares || {})
      .filter(([key, value]) => Number(value) > 0 && !matched.has(key))
      .map(([key]) => (nameFor ? nameFor(key) : key));
    if (missing.length) {
      throw new Error(`No Splitwise match for ${missing.join(', ')} — they need the same email on both sides.`);
    }

    const body = buildExpense({
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
      groupId: group.id,
      shares,
      payerKey: expense.paidBy,
      matched,
    });
    const res = await fetch('/api/splitwise', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ expense: body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error(data.error || `Splitwise refused it (${res.status})`);
    await actions.markSplitwise(expense, { id: data.id, groupId: group.id });
    return `Sent to ${group.name}`;
  }, [user, state.me]);

  return { ...state, send };
}
