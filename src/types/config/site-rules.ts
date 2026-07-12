/**
 * Per-site translation / walk rules (ported from read-frog site-rules).
 * Schema is intentionally lenient — invalid selectors are dropped at resolve time.
 */

export interface SiteRule {
  id: string;
  description?: string;
  matches: string | string[];
  excludeMatches?: string[];
  excludeSelectors?: string[];
  'excludeSelectors.add'?: string[];
  'excludeSelectors.remove'?: string[];
  includeSelectors?: string[];
  'includeSelectors.add'?: string[];
  'includeSelectors.remove'?: string[];
  forceBlockSelectors?: string[];
  'forceBlockSelectors.add'?: string[];
  'forceBlockSelectors.remove'?: string[];
  forceInlineSelectors?: string[];
  'forceInlineSelectors.add'?: string[];
  'forceInlineSelectors.remove'?: string[];
  preserveTextSelectors?: string[];
  'preserveTextSelectors.add'?: string[];
  'preserveTextSelectors.remove'?: string[];
  minCharacters?: number;
  minWords?: number;
  injectedCss?: string;
  'injectedCss.add'?: string[];
  enabled?: boolean;
}

export interface SiteRulesConfig {
  userRules: SiteRule[];
  disabledBuiltInRules: string[];
}

export const MAX_SITE_RULES_JSON_LENGTH = 65536;
export const MAX_USER_SITE_RULES = 200;

export const DEFAULT_SITE_RULES_CONFIG: SiteRulesConfig = {
  userRules: [],
  disabledBuiltInRules: [],
};
