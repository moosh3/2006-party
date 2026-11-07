// Server only: essay reads and writes through the service role.
import { supabaseAdmin as db } from './supabase-admin';
import { readAudienceDoors } from './audience-doors';
import type { PublishedEssay } from './essays';

type Row = { id: string; screen_name: string; prompt: string; body: string; created_at: string; hidden?: boolean };
export const toEssay = (row: Row): PublishedEssay => ({
  id: row.id, screenName: row.screen_name, prompt: row.prompt, body: row.body, createdAt: row.created_at,
});

/** Tonight = since the doors last opened. Closed doors publish nothing. */
export async function tonight() {
  const doors = await readAudienceDoors();
  return doors.doorsOpen ? doors.changedAt : null;
}

export async function publishedEssays(): Promise<PublishedEssay[]> {
  const since = await tonight();
  if (!since) return [];
  const { data, error } = await db.from('essay_submissions').select('id,screen_name,prompt,body,created_at')
    .eq('hidden', false).gte('created_at', since).order('created_at', { ascending: true }).limit(300);
  if (error) throw new Error(error.code || 'essay_submissions');
  return (data || []).map(toEssay);
}

export const missingEssayTable = (code?: string) => code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205';
