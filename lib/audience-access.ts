/** Public audience contracts only. Never import a server database client here. */
export type AudienceViewer = { id: string; name: string; blocked: boolean };
export type AudienceDoors = { doorsOpen: boolean; revision: number; changedAt: string };

export function parseAudienceViewer(value: unknown): AudienceViewer | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Unable to confirm your screen name. Please try again.');
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)
    || typeof v.name !== 'string' || v.name.trim().length < 2 || v.name !== v.name.trim() || v.name.length > 20
    || typeof v.blocked !== 'boolean') throw new Error('Unable to confirm your screen name. Please try again.');
  return { id: v.id, name: v.name, blocked: v.blocked };
}

export function parseAudienceDoors(value: unknown): AudienceDoors {
  if (!value || typeof value !== 'object') throw new Error('Unable to check the doors.');
  const v = value as Record<string, unknown>;
  if (typeof v.doorsOpen !== 'boolean' || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0
    || typeof v.changedAt !== 'string' || !Number.isFinite(Date.parse(v.changedAt))) throw new Error('Unable to check the doors.');
  return { doorsOpen: v.doorsOpen, revision: v.revision as number, changedAt: v.changedAt };
}

export function newerAudienceDoors(previous: AudienceDoors | null, next: AudienceDoors): AudienceDoors {
  if (!previous || next.revision > previous.revision) return next;
  return previous;
}
