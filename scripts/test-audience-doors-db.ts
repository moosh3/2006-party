import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// In-memory database only. Never load .env.local or connect to the live show.
async function main() {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(readFileSync('sql/001_schema.sql', 'utf8'));
    await db.exec(readFileSync('sql/019_lock_down_admin_tables.sql', 'utf8'));
    const migration = readFileSync('sql/024_audience_doors.sql', 'utf8');
    await db.exec(migration);
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const command = async (open: unknown, revision: unknown, actor: unknown = 'test:operator') => (
      await q('SELECT public.set_audience_doors($1,$2,$3) AS state', [open, revision, actor])
    )[0].state;
    const initial = (await q('SELECT * FROM public.audience_doors'))[0];
    assert.equal(initial.doors_open, false);
    assert.equal(Number(initial.revision), 0);
    assert.equal((await q('SELECT count(*)::int AS n FROM public.audience_doors'))[0].n, 1);
    await assert.rejects(q('INSERT INTO public.audience_doors(id) VALUES(2)'), /check constraint/);
    console.log('PASS: fresh installation starts closed and remains a singleton.');

    await q("INSERT INTO public.current_stream(playback_id,title) VALUES('fixture-source','Fixture show')");
    const streamBefore = (await q('SELECT row_to_json(s) AS state FROM public.current_stream s'))[0].state;
    const opened = await command(true, 0);
    assert.equal(opened.doorsOpen, true);
    assert.equal(opened.revision, 1);
    assert.ok(Number.isFinite(Date.parse(opened.changedAt)));
    assert.equal((await q("SELECT count(*)::int AS n FROM admin_actions WHERE action_type='audience_doors'"))[0].n, 1);
    assert.deepEqual((await q('SELECT row_to_json(s) AS state FROM public.current_stream s'))[0].state, streamBefore);
    const duplicate = await command(true, 1);
    assert.deepEqual(duplicate, opened);
    assert.equal((await q("SELECT count(*)::int AS n FROM admin_actions WHERE action_type='audience_doors'"))[0].n, 1);
    console.log('PASS: opening is explicit, audited and independent of playback; same-state commands are harmless.');

    await assert.rejects(command(false, 0), /AUDIENCE_DOORS_REVISION_CONFLICT/);
    await assert.rejects(command(true, 0), /AUDIENCE_DOORS_REVISION_CONFLICT/);
    const concurrent = await Promise.allSettled([command(false, 1), command(false, 1)]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    const closed = (await q('SELECT * FROM audience_doors'))[0];
    assert.equal(closed.doors_open, false);
    assert.equal(Number(closed.revision), 2);
    assert.equal((await q("SELECT count(*)::int AS n FROM admin_actions WHERE action_type='audience_doors'"))[0].n, 2);
    console.log('PASS: stale and competing admin commands cannot accidentally toggle the gate.');

    await assert.rejects(command(null, 2), /Invalid audience doors command/);
    await assert.rejects(command(true, null), /Invalid audience doors command/);
    await assert.rejects(command(true, -1), /Invalid audience doors command/);
    await assert.rejects(command(true, 9007199254740992), /Invalid audience doors command/);
    await assert.rejects(command(true, 2, ''), /Invalid audience doors command/);
    await assert.rejects(command(true, 2, 'x'.repeat(201)), /Invalid audience doors command/);
    await db.exec(`CREATE FUNCTION reject_doors_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Fixture audit failure'; END; $$;
      CREATE TRIGGER reject_doors_audit BEFORE INSERT ON admin_actions
        FOR EACH ROW EXECUTE FUNCTION reject_doors_audit();`);
    await assert.rejects(command(true, 2), /Fixture audit failure/);
    assert.deepEqual((await q('SELECT * FROM audience_doors'))[0], closed);
    await db.exec('DROP TRIGGER reject_doors_audit ON admin_actions; DROP FUNCTION reject_doors_audit();');
    await db.exec(migration);
    assert.deepEqual((await q('SELECT * FROM audience_doors'))[0], closed);
    console.log('PASS: invalid commands fail safely, audit failures roll back; reapplying preserves admission.');

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(q('SELECT * FROM public.audience_doors'), /permission denied/);
      await assert.rejects(command(true, 2), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await q('SELECT doors_open FROM public.audience_doors'))[0].doors_open, false);
    assert.equal((await command(true, 2)).doorsOpen, true);
    await db.exec('RESET ROLE');
    console.log('PASS: public database roles cannot read or operate the gate; service role can.');

    await q('DELETE FROM public.audience_doors WHERE id=1');
    await assert.rejects(command(false, 3), /Audience doors singleton missing/);
    console.log('PASS: a missing singleton fails closed rather than silently reopening.');
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
