/**
 * Site enable/disable control (adapted from read-frog site-control).
 * Default mode: blacklist — sites listed are disabled.
 */

export interface SiteControlConfig {
  mode: 'blacklist' | 'whitelist';
  blacklistPatterns: string[];
  whitelistPatterns: string[];
}

export const DEFAULT_SITE_CONTROL: SiteControlConfig = {
  mode: 'blacklist',
  blacklistPatterns: [],
  whitelistPatterns: [],
};

/**
 * Match hostname against a pattern.
 * Supports: "example.com", "*.example.com", full URL patterns.
 */
export function matchDomainPattern(url: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (p === hostname) return true;
    if (p.startsWith('*.') && (hostname === p.slice(2) || hostname.endsWith(p.slice(1)))) {
      return true;
    }
    // bare host in pattern list
    if (hostname === p || hostname.endsWith(`.${p}`)) return true;
    // pattern may be full url
    if (p.includes('://')) {
      try {
        return new URL(p).hostname === hostname;
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function isSiteEnabled(url: string, control: SiteControlConfig | null | undefined): boolean {
  if (!control) return true;
  const { mode, blacklistPatterns, whitelistPatterns } = control;
  if (mode === 'blacklist') {
    return !blacklistPatterns.some((pat) => matchDomainPattern(url, pat));
  }
  if (whitelistPatterns.length === 0) return false;
  return whitelistPatterns.some((pat) => matchDomainPattern(url, pat));
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isHostnameInList(url: string, patterns: string[]): boolean {
  return patterns.some((p) => matchDomainPattern(url, p));
}

/** Toggle current hostname in blacklist (disable site). */
export function toggleHostnameInBlacklist(
  control: SiteControlConfig,
  url: string,
  disabled: boolean,
): SiteControlConfig {
  const host = hostnameOf(url);
  if (!host) return control;
  const list = control.blacklistPatterns.filter(
    (p) => !matchDomainPattern(url, p),
  );
  if (disabled) list.push(host);
  return { ...control, mode: 'blacklist', blacklistPatterns: list };
}
