import { supabaseAdmin } from './supabase-admin';

export interface AudienceDoorsState {
  doorsOpen: boolean;
  revision: number;
  changedAt: string;
}

export const AUDIENCE_DOORS_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

export class AudienceDoorsError extends Error {
  constructor(message: string, public readonly status: number = 503) {
    super(message);
    this.name = 'AudienceDoorsError';
  }
}

function unavailable(code?: string): never {
  // Do not return database messages or credentials to audience browsers.
  console.error('Audience doors unavailable:', { code: code || 'invalid_snapshot' });
  throw new AudienceDoorsError('Audience doors are temporarily unavailable. Please try again.');
}

function parseState(value: unknown): AudienceDoorsState {
  if (!value || typeof value !== 'object') return unavailable();
  const state = value as Record<string, unknown>;
  if (typeof state.doorsOpen !== 'boolean' || typeof state.revision !== 'number'
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || typeof state.changedAt !== 'string' || !Number.isFinite(Date.parse(state.changedAt))) {
    return unavailable();
  }
  return { doorsOpen: state.doorsOpen, revision: state.revision, changedAt: state.changedAt };
}

export async function readAudienceDoors(): Promise<AudienceDoorsState> {
  const { data, error } = await supabaseAdmin.from('audience_doors')
    .select('doors_open,revision,changed_at').eq('id', 1).single();
  if (error) return unavailable(error.code);
  return parseState(data && {
    doorsOpen: data.doors_open, revision: data.revision, changedAt: data.changed_at,
  });
}

export async function setAudienceDoors(
  doorsOpen: boolean, expectedRevision: number, adminUserId: string,
): Promise<AudienceDoorsState> {
  const { data, error } = await supabaseAdmin.rpc('set_audience_doors', {
    requested_doors_open: doorsOpen,
    expected_revision: expectedRevision,
    admin_user_id: adminUserId,
  });
  if (error?.code === 'P0001' && error.message === 'AUDIENCE_DOORS_REVISION_CONFLICT') {
    throw new AudienceDoorsError('Doors changed in another admin window. Refresh and try again.', 409);
  }
  if (error) return unavailable(error.code);
  return parseState(data);
}
