import { useState, useEffect } from 'react';
import { subscribePagePrivacy } from '../lib/pagePrivacyStore';
import { PagePrivacyContext } from '../lib/pagePrivacyContext';
import { useAuth } from '../contexts/AuthContext';

// Signed out there is nothing to hide — the only routes reachable without an
// account are invites, polls and share, none of which can be made private — so
// skip the subscription rather than firing a read the rules will refuse.
const NOTHING_HIDDEN = {};

/* One listener for the whole app.

   The route gate, both nav bars and the toggle button all need this answer, so
   it is fetched once here and shared rather than each opening its own snapshot
   on the same document. */
export function PagePrivacyProvider({ children }) {
  const { user } = useAuth();
  const [fetched, setFetched] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    return subscribePagePrivacy(setFetched);
  }, [user]);

  // Derived rather than assigned in the effect: setting state in an effect body
  // costs a second render pass, and signed-out is a pure function of `user`.
  const value = user ? fetched : NOTHING_HIDDEN;

  return (
    <PagePrivacyContext.Provider value={value}>
      {children}
    </PagePrivacyContext.Provider>
  );
}
