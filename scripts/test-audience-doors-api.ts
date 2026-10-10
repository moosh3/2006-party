/** Real route checks against the isolated playout rehearsal only.
 * Fixed loopback URLs, no dotenv, configurable hosts or production writes.
 * Run serially with other fixture suites, before browser checks.
 */
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';

const BASE = 'http://127.0.0.1:3116';
const FIXTURE = 'http://127.0.0.1:54339';
const KEY = 'playout-fixture-service';
const TEST_IP = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
type Doors = { doorsOpen: boolean; revision: number; changedAt: string };

async function main() {
  async function fixture(path: string, body?: object) {
    const response = await fetch(FIXTURE + path, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  const sql = (statement: string, args: unknown[] = []) => fixture('/__fixture/query', { sql: statement, args });
  async function request(path: string, options: {
    cookie?: string; body?: unknown; raw?: string; expected?: number; headers?: Record<string, string>;
  } = {}) {
    const response = await fetch(BASE + path, {
      method: options.body !== undefined || options.raw !== undefined ? 'POST' : 'GET',
      redirect: 'error',
      headers: {
        cookie: options.cookie || '', Origin: BASE, 'Content-Type': 'application/json',
        'x-forwarded-for': TEST_IP, ...options.headers,
      },
      ...(options.raw !== undefined ? { body: options.raw }
        : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, options.expected || 200, `${path}: ${JSON.stringify(data)}`);
    assert.match(response.headers.get('cache-control') || '', /no-store/, `${path} must not be cached`);
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    // Vercel consumes its private CDN header in deployment; this local fixture exposes it.
    assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
    return data;
  }
  function validDoors(value: Doors) {
    assert.deepEqual(Object.keys(value).sort(), ['changedAt', 'doorsOpen', 'revision']);
    assert.equal(typeof value.doorsOpen, 'boolean');
    assert.ok(Number.isSafeInteger(value.revision) && value.revision >= 0);
    assert.ok(Number.isFinite(Date.parse(value.changedAt)));
  }
  const health = await fixture('/__fixture/health');
  assert.equal(health.available, true, 'Start the isolated fixture with the database available.');
  const initial: Doors = await request('/api/audience/doors');
  validDoors(initial);
  await request('/api/admin/audience-doors', { expected: 401 });
  await request('/api/admin/audience-doors', { body: { doorsOpen: true, expectedRevision: initial.revision }, expected: 401 });
  await request('/api/admin/audience-doors', { cookie: 'admin_session=forged', expected: 401 });
  console.log('PASS: public status has only the admission contract; admin controls require a signed session; all responses are uncached.');

  const auth = await fetch(BASE + '/api/auth/admin-login', {
    method: 'POST', redirect: 'error',
    headers: { Origin: BASE, 'Content-Type': 'application/json', 'x-forwarded-for': TEST_IP },
    body: JSON.stringify({ password: 'local-playout-test-only' }),
  });
  assert.equal(auth.status, 200, await auth.text());
  const cookie = auth.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie.startsWith('admin_session='));
  const admin = (doorsOpen: boolean, expectedRevision: number, expected = 200) =>
    request('/api/admin/audience-doors', { cookie, body: { doorsOpen, expectedRevision }, expected });
  const auditCount = async () => Number((await sql("SELECT count(*)::int AS n FROM admin_actions WHERE action_type='audience_doors'"))[0].n);
  const unrelatedState = () => sql(`SELECT
    (SELECT row_to_json(s) FROM current_stream s WHERE id=1) AS stream,
    (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]'::jsonb) FROM video_queue q) AS queue,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb) FROM game_prompts p) AS prompts,
    (SELECT count(*)::int FROM game_votes) AS game_votes,
    (SELECT count(*)::int FROM poll_votes) AS legacy_votes`);
  const untouched = await unrelatedState();
  let current: Doors = await request('/api/admin/audience-doors', { cookie });
  validDoors(current);
  const originalDoorsOpen = current.doorsOpen;
  if (current.doorsOpen) current = await admin(false, current.revision);
  const auditBefore = await auditCount();
  let restoreSingleton: Record<string, unknown> | null = null;
  let renamed = false;
  try {
    for (const body of [null, [], {}, { doorsOpen: 'true', expectedRevision: current.revision },
      { doorsOpen: true, expectedRevision: String(current.revision) },
      { doorsOpen: true, expectedRevision: -1 }, { doorsOpen: true, expectedRevision: 0.5 },
      { doorsOpen: true, expectedRevision: 9007199254740992 },
      { doorsOpen: true, expectedRevision: current.revision, toggle: true }]) {
      await request('/api/admin/audience-doors', { cookie, body, expected: 400 });
    }
    await request('/api/admin/audience-doors', { cookie, raw: '{', expected: 400 });
    const rejectedOrigins: Record<string, string>[] = [{ Origin: 'https://unrelated.example' }, { Origin: 'null' },
      { Origin: '://not-an-origin' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }];
    for (const headers of rejectedOrigins) {
      await request('/api/admin/audience-doors', {
        cookie, body: { doorsOpen: true, expectedRevision: current.revision }, headers, expected: 403,
      });
    }
    assert.equal(await auditCount(), auditBefore);
    assert.equal((await request('/api/audience/doors')).doorsOpen, false);
    console.log('PASS: malformed, wrong-type and cross-origin commands fail without changing or auditing admission.');

    const beforeOpen = current;
    current = await admin(true, current.revision);
    validDoors(current);
    assert.equal(current.doorsOpen, true);
    assert.equal(current.revision, beforeOpen.revision + 1);
    assert.equal(await auditCount(), auditBefore + 1);
    const publicOpen: Doors = await request('/api/audience/doors');
    assert.equal(publicOpen.doorsOpen, true);
    assert.equal(publicOpen.revision, current.revision);
    assert.deepEqual(await admin(true, current.revision), current, 'Explicit same-state operation must be a no-op.');
    await admin(false, beforeOpen.revision, 409);
    const competing = await Promise.all(Array.from({ length: 2 }, async () => {
      const response = await fetch(BASE + '/api/admin/audience-doors', {
        method: 'POST', redirect: 'error',
        headers: { cookie, Origin: BASE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ doorsOpen: false, expectedRevision: current.revision }),
      });
      const data = await response.json();
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      return { status: response.status, data };
    }));
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    current = competing.find(result => result.status === 200)!.data;
    assert.equal(current.doorsOpen, false);
    assert.equal(current.revision, beforeOpen.revision + 2);
    assert.equal(await auditCount(), auditBefore + 2);
    assert.deepEqual(await unrelatedState(), untouched, 'Doors must not alter program, queue, prompts or votes.');
    console.log('PASS: explicit Open/Close and same-state retry work; stale/concurrent admins cannot double-toggle; playback, queue and votes stay untouched.');

    try {
      await fixture('/__fixture/database', { available: false });
      const unavailable = await request('/api/audience/doors', { expected: 503 });
      assert.equal(unavailable.doorsOpen, undefined, 'An outage must not invent open admission.');
      await request('/api/admin/audience-doors', { cookie, expected: 503 });
      await admin(true, current.revision, 503);
    } finally {
      await fixture('/__fixture/database', { available: true });
    }
    assert.equal((await request('/api/audience/doors')).revision, current.revision);
    restoreSingleton = (await sql('SELECT * FROM audience_doors WHERE id=1'))[0];
    await sql('DELETE FROM audience_doors WHERE id=1');
    await request('/api/audience/doors', { expected: 503 });
    await admin(true, current.revision, 503);
    await sql('INSERT INTO audience_doors(id,doors_open,revision,changed_at) VALUES($1,$2,$3,$4)',
      [restoreSingleton!.id, restoreSingleton!.doors_open, restoreSingleton!.revision, restoreSingleton!.changed_at]);
    restoreSingleton = null;
    await sql('ALTER TABLE audience_doors RENAME TO audience_doors_fixture_missing');
    renamed = true;
    await request('/api/audience/doors', { expected: 503 });
    await request('/api/admin/audience-doors', { cookie, expected: 503 });
    await sql('ALTER TABLE audience_doors_fixture_missing RENAME TO audience_doors');
    renamed = false;
    validDoors(await request('/api/audience/doors'));
    console.log('PASS: database outages, missing singleton and missing schema return safe uncached 503s; recovery keeps the last real state.');
  } finally {
    await fixture('/__fixture/database', { available: true });
    if (renamed) await sql('ALTER TABLE audience_doors_fixture_missing RENAME TO audience_doors');
    if (restoreSingleton) await sql('INSERT INTO audience_doors(id,doors_open,revision,changed_at) VALUES($1,$2,$3,$4)',
      [restoreSingleton.id, restoreSingleton.doors_open, restoreSingleton.revision, restoreSingleton.changed_at]);
    const latest: Doors = await request('/api/admin/audience-doors', { cookie });
    if (latest.doorsOpen !== originalDoorsOpen) await admin(originalDoorsOpen, latest.revision);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
