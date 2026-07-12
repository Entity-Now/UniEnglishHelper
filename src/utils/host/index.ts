/**
 * Host-page helpers (subset of read-frog host utils, adapted for UEH).
 * Full page-translation walker is optional; DOM/filter primitives are useful
 * for site-rules and future content features.
 */

export { waitForElement } from '../dom/wait-for-element';
export {
  getEffectiveSiteRule,
  resolveSiteRule,
  urlMatchesPattern,
  urlMatchesRule,
  BUILT_IN_SITE_RULES,
  type ResolvedSiteRule,
} from '../site-rules';
