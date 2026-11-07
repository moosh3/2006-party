// Server only: tonight's queue advances (since the doors last opened), newest first.
import { supabaseAdmin } from './supabase-admin';
import { readAudienceDoors } from './audience-doors';

export async function advancesTonight(): Promise<{ details?: unknown }[] | null> {
  const doors = await readAudienceDoors();
  if (!doors.doorsOpen) return null;
  const { data, error } = await supabaseAdmin.from('admin_actions').select('details')
    .eq('action_type', 'queue_advance').gte('created_at', doors.changedAt)
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.code || 'admin_actions');
  return data || [];
}
