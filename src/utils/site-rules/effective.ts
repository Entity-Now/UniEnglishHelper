import type { ResolvedSiteRule } from './resolve';
import type { SiteRulesConfig } from '@/types/config/site-rules';
import { BUILT_IN_SITE_RULES } from './built-in';
import { resolveSiteRule } from './resolve';

interface SiteRulesHolder {
  siteRules?: SiteRulesConfig;
}

const cache = new WeakMap<object, { url: string; rule: ResolvedSiteRule }>();

/**
 * Resolve the effective site rule for `url` under a config that may carry
 * `siteRules`. Memoized on config object identity.
 */
export function getEffectiveSiteRule(
  config: SiteRulesHolder,
  url: string,
): ResolvedSiteRule {
  const cached = cache.get(config as object);
  if (cached?.url === url) return cached.rule;

  const rule = resolveSiteRule(
    url,
    BUILT_IN_SITE_RULES,
    config.siteRules?.userRules ?? [],
    config.siteRules?.disabledBuiltInRules ?? [],
  );
  cache.set(config as object, { url, rule });
  return rule;
}
