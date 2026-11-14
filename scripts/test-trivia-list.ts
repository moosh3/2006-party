/** Real disposable PostgreSQL; no credentials or live database. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

async function main() {
  const db = new PGlite();
  const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
  const call = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS value`, args))[0].value;
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of ['001_schema', '021_show_game', '032_trivia_nights']) await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    const show = (await q("INSERT INTO game_shows(title) VALUES('Friday') RETURNING id"))[0].id;
    const options = JSON.stringify([{ id: '0', label: 'Correct' }, { id: '1', label: 'Incorrect' }]);
    for (const order of [2, 0, 1]) await q("INSERT INTO game_prompts(show_id,kind,question,options,correct_option,display_order) VALUES($1,'trivia',$2,$3,'0',$4)", [show, `Question ${order}`, options, order]);
    await q("INSERT INTO game_prompts(show_id,kind,question,options,status) VALUES($1,'superlative','Cast award',$2,'open'),($1,'trl','External vote',$2,'draft')", [show, options]);
    const original = await q('SELECT * FROM game_prompts ORDER BY id');
    const migration = readFileSync('sql/033_trivia_list.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await q('SELECT * FROM game_prompts ORDER BY id'), original, 'Migration preserves existing data on both installs');
    const list = (action: string) => call('game_trivia_list($1,$2)', [show, action]);
    const trivia = () => q("SELECT * FROM game_prompts WHERE kind='trivia' AND show_id=$1 ORDER BY display_order", [show]);
    await list('open'); await list('open');
    const opened = await trivia();
    assert.equal(opened.length, 3);
    assert(opened.every(p => p.status === 'open' && !p.results_visible));
    assert.deepEqual(opened.map(p => p.question), ['Question 0', 'Question 1', 'Question 2']);
    const viewer = (await q("INSERT INTO game_viewers(name,token_hash) VALUES('Rehearsal','fixture') RETURNING id"))[0].id;
    // Answer in reverse order while all questions stay open.
    for (const p of opened.toReversed()) await call('game_vote($1,$2,$3)', [p.id, viewer, '0']);
    await assert.rejects(call('game_vote($1,$2,$3)', [opened[0].id, viewer, '1']), /already locked/);
    assert.equal((await call('game_totals($1)', [show])).scores.length, 0);
    await list('close_reveal');
    const finished = await trivia();
    assert(finished.every(p => p.status === 'closed' && p.results_visible));
    assert.equal((await call('game_totals($1)', [show])).scores[0].score, 3);
    await list('close_reveal');
    assert.deepEqual(await trivia(), finished, 'Lost-response retry preserves visible answers and scores');
    await assert.rejects(call('game_vote($1,$2,$3)', [opened[0].id, viewer, '1']), /closed/);
    assert.deepEqual(await q("SELECT * FROM game_prompts WHERE kind<>'trivia' ORDER BY id"), original.filter(p => p.kind !== 'trivia'));
    await assert.rejects(list('invalid'), /Unknown/);
    await call('game_admin($1,$2,$3)', [show, 'finish', '{}']);
    await assert.rejects(list('open'), /ended/);
    const saturday = await call('game_copy_trivia_night($1,$2)', ['Saturday', show]);
    const copied = await q('SELECT * FROM game_prompts WHERE show_id=$1 ORDER BY display_order', [saturday]);
    assert.equal(copied.length, 3); assert(copied.every(p => p.status === 'draft' && !p.results_visible));
    assert.notDeepEqual(copied.map(p => p.question), finished.map(p => p.question));
    // Setup's individual controls can also open more than one question.
    for (const p of copied) await call('game_admin($1,$2,$3)', [saturday, 'open', JSON.stringify({ id: p.id })]);
    assert.equal((await q("SELECT id FROM game_prompts WHERE show_id=$1 AND status='open'", [saturday])).length, 3);
    for (const role of ['anon', 'authenticated']) assert.equal(await call("has_function_privilege($1,'game_trivia_list(uuid,text)','EXECUTE')", [role]), false);
    assert.equal(await call("has_function_privilege('service_role','game_trivia_list(uuid,text)','EXECUTE')"), true);
    console.log('PASS: full-list opening, out-of-order answers, answer locks, atomic close/reveal, score=3, retry, preserved awards, nightly shuffle, permissions, and migration reapply.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
