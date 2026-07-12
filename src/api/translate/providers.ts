import type { FreeMtProvider, FreeMtProviderId } from './types';
import { googleFreeProvider } from './google';
import { microsoftFreeProvider } from './microsoft';
import { myMemoryFreeProvider } from './mymemory';

export const FREE_MT_PROVIDERS: Record<
  Exclude<FreeMtProviderId, 'auto'>,
  FreeMtProvider
> = {
  google: googleFreeProvider,
  microsoft: microsoftFreeProvider,
  mymemory: myMemoryFreeProvider,
};

/** Default failover order for `auto` */
export const FREE_MT_AUTO_ORDER: Array<Exclude<FreeMtProviderId, 'auto'>> = [
  'microsoft',
  'google',
  'mymemory',
];

export function listFreeMtProviders(): FreeMtProvider[] {
  return Object.values(FREE_MT_PROVIDERS);
}

export function resolveProviderOrder(
  preferred: FreeMtProviderId | undefined,
): Array<Exclude<FreeMtProviderId, 'auto'>> {
  if (!preferred || preferred === 'auto') {
    return [...FREE_MT_AUTO_ORDER];
  }
  // try preferred first, then the rest
  return [
    preferred,
    ...FREE_MT_AUTO_ORDER.filter((id) => id !== preferred),
  ];
}

export function allFreeMtOrigins(): string[] {
  const set = new Set<string>();
  for (const p of listFreeMtProviders()) {
    for (const o of p.origins) set.add(o);
  }
  return [...set];
}
