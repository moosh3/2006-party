/** Real embedded PostgreSQL, isolated from the live show. Never reads .env. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ESSAY_PROMPTS, essayError, isEssayPromptIndex } from '../lib/essays';

async function main() {
  // Shared text rules used by the API before anything reaches the database.
  assert.equal(essayError('My first MySpace top 8.\nThen LiveJournal.\tFin.'), null, 'Line breaks and tabs are allowed');
  for (const bad of ['short', 'x'.repeat(5001), 'Visit www.example.com now', 'see https://x.test today', 'this is shit honestly', 'bell\u0007char here', 42, null]) {
    assert.notEqual(essayError(bad), null, `${String(bad).slice(0, 20)} is rejected`);
  }
  assert.equal(isEssayPromptIndex(0), true);
  assert.equal(isEssayPromptIndex(ESSAY_PROMPTS.length), false);
  assert.equal(isEssayPromptIndex('1'), false);
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of ['001_schema', '019_lock_down_admin_tables', '021_show_game', '024_audience_doors']) {
      await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    }
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const viewer = async (name: string, blocked = false) =>
      (await q('INSERT INTO game_viewers(token_hash,name,blocked) VALUES($1,$2,$3) RETURNING id', [`t-${name}`, name, blocked]))[0].id;
    const alice = await viewer('Alice');
    const before = await q("SELECT to_jsonb(t) j FROM (SELECT * FROM audience_doors UNION ALL SELECT * FROM audience_doors) t");

    const migration = readFileSync('sql/029_essay_submissions.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await q("SELECT to_jsonb(t) j FROM (SELECT * FROM audience_doors UNION ALL SELECT * FROM audience_doors) t"), before,
      'Installing 029 twice leaves admission unchanged');

    const submit = (v: string, body = 'My 2006 was mostly LimeWire.') =>
      q('SELECT essay_submit($1,$2,$3,$4) AS r', [v, 1, 'Describe the first online space.', body]).then(rows => rows[0].r);
    const doors = (open: boolean) => q(
      'SELECT set_audience_doors($1,(SELECT revision FROM audience_doors WHERE id=1),$2)', [open, 'test']);

    await assert.rejects(submit(alice), /doors are open/, 'Closed doors reject submissions');
    await doors(true);
    const saved = await submit(alice);
    assert.equal(saved.screenName, 'Alice', 'Essays are credited to the screen name');
    assert.equal(saved.body, 'My 2006 was mostly LimeWire.');
    await assert.rejects(submit(alice, 'A second try'), /already submitted/, 'One submission per guest per night');
    await Promise.allSettled([submit(await viewer('Racer')), submit((await q("SELECT id FROM game_viewers WHERE name='Racer'"))[0].id)]);
    assert.equal((await q("SELECT count(*)::int n FROM essay_submissions e JOIN game_viewers v ON v.id=e.viewer_id WHERE v.name='Racer'"))[0].n, 1,
      'Back-to-back submits publish once (single-connection fixture; the advisory lock covers real races)');
    await assert.rejects(submit(await viewer('Blocked', true)), /unavailable/, 'Blocked guests cannot submit');
    await assert.rejects(submit('00000000-0000-4000-8000-000000000000'), /unavailable/);
    await assert.rejects(q('SELECT essay_submit($1,$2,$3,$4)', [alice, 1, 'p', 'x'.repeat(5001)]), /check constraint|already/);

    // Hiding is operator-only, reversible and audited.
    const hidden = (await q('SELECT essay_set_hidden($1,true,$2) AS r', [saved.id, 'test:operator']))[0].r;
    assert.equal(hidden.hidden, true);
    let row = (await q('SELECT * FROM essay_submissions WHERE id=$1', [saved.id]))[0];
    assert.equal(row.hidden_by, 'test:operator');
    await q('SELECT essay_set_hidden($1,false,$2)', [saved.id, 'test:operator']);
    row = (await q('SELECT * FROM essay_submissions WHERE id=$1', [saved.id]))[0];
    assert.equal(row.hidden, false);
    assert.equal(row.hidden_by, null);
    assert.deepEqual((await q("SELECT action_type FROM admin_actions WHERE action_type LIKE 'essay_%' ORDER BY id")).map((r: any) => r.action_type),
      ['essay_hide', 'essay_restore']);
    await assert.rejects(q('SELECT essay_set_hidden($1,true,$2)', ['00000000-0000-4000-8000-000000000000', 'x']), /not found/);

    // A new night (doors closed, then reopened) allows a new submission.
    await doors(false);
    await doors(true);
    await submit(alice, 'Night two essay.');
    assert.equal((await q('SELECT count(*)::int n FROM essay_submissions WHERE viewer_id=$1', [alice]))[0].n, 2);

    for (const sig of ['essay_submit(uuid,integer,text,text)', 'essay_set_hidden(uuid,boolean,text)']) {
      assert.equal((await q(`SELECT has_function_privilege('anon','public.${sig}','EXECUTE') ok`))[0].ok, false);
    }
    assert.equal((await q("SELECT has_table_privilege('anon','public.essay_submissions','SELECT') ok"))[0].ok, false);
    console.log('PASS: essay submissions — doors gate, screen-name credit, one per guest per night, back-to-back submits, blocked guests, length limit, reversible audited hiding, permissions, repeat installation.');
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
