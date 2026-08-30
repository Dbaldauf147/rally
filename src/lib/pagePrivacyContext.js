import { createContext, useContext } from 'react';

/* The shared "which pages are hidden" value.
 *
 * Split from the provider component so this file exports no components — which
 * keeps fast refresh working for both, and lets the nav bars import the hook
 * without pulling a component in behind it.
 *
 * null  = not known yet (still loading). Callers must not treat this as "nothing
 *         hidden", or a private page flashes into view on every load.
 * {}    = known, and nothing is hidden.
 */
export const PagePrivacyContext = createContext(null);

export function usePagePrivacy() {
  return useContext(PagePrivacyContext);
}
