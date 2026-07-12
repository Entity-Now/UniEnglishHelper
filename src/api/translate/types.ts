/** Free machine-translation providers (unofficial / freemium public APIs). */
export type FreeMtProviderId =
  | 'google'
  | 'microsoft'
  | 'mymemory'
  | 'auto';

export interface FreeMtRequest {
  text: string;
  src: string;
  dst: string;
}

export interface FreeMtResult {
  text: string;
  provider: Exclude<FreeMtProviderId, 'auto'>;
}

export interface FreeMtProvider {
  id: Exclude<FreeMtProviderId, 'auto'>;
  label: string;
  /** Host patterns that may need optional permissions */
  origins: string[];
  translate(req: FreeMtRequest): Promise<string>;
}

export const FREE_MT_PROVIDER_IDS: FreeMtProviderId[] = [
  'auto',
  'google',
  'microsoft',
  'mymemory',
];
