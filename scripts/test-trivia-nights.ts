/** Real PostgreSQL in memory; never reads credentials or the live database. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

async function main() {
  const db = new PGlite();
  const q = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows;
  const scalar = async (sql: string, params: unknown[] = []) => (await q(`SELECT ${sql} AS result`, params))[0].result;
  const prompts = (show: string) => q('SELECT * FROM game_prompts WHERE show_id=$1 ORDER BY display_order,created_at,id', [show]);
  const copy = (title: string | null, show: string) => scalar('game_copy_trivia_night($1,$2)', [title, show]);
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of ['001_schema', '021_show_game']) await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    const friday = (await q("INSERT INTO game_shows(title) VALUES('Friday') RETURNING id"))[0].id;
    const admin = (action: string, payload = {}) => scalar('game_admin($1,$2,$3)', [friday, action, JSON.stringify(payload)]);
    const options = [{ id: 'a', label: 'Correct' }, { id: 'b', label: 'Incorrect' }];
    await admin('create', { kind: 'trivia', question: 'First question', options, correctOption: 'a' });
    await admin('create', { kind: 'trivia', question: 'Second question', options, correctOption: 'b' });
    await admin('create', { kind: 'trl', question: 'Video vote', options });
    await admin('cast', { names: ['MK', 'Alec'] });
    await admin('create', { kind: 'superlative', question: 'Cast award' });
    const original = await q('SELECT * FROM game_prompts ORDER BY created_at,id');
    const viewer = (await q("INSERT INTO game_viewers(token_hash,name) VALUES('test','Guest') RETURNING id"))[0].id;
    const first = original.find(p => p.question === 'First question');
    await admin('open', { id: first.id });
    await scalar('game_vote($1,$2,$3)', [first.id, viewer, 'a']);
    await admin('close', { id: first.id });
    await admin('reveal', { id: first.id });
    const before = await q('SELECT * FROM game_prompts ORDER BY id');
    const votes = await q('SELECT * FROM game_votes');
    const migration = readFileSync('sql/032_trivia_nights.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await q('SELECT * FROM game_prompts ORDER BY id')).map(({ display_order, ...p }) => p), before);
    assert.deepEqual(await q('SELECT * FROM game_votes'), votes);
    await assert.rejects(copy('Saturday', friday), /End the active show/);
    await admin('finish');
    const fridayPrompts = await prompts(friday);
    const fridayTotals = await scalar('game_totals($1)', [friday]);
    assert.equal(fridayTotals.scores[0].score, 1);
    for (const title of [null, '', ' '.repeat(3), 'x'.repeat(101), 'Bad\nname'])
      await assert.rejects(copy(title, friday), /show name/);
    await assert.rejects(copy('Saturday', '00000000-0000-0000-0000-000000000000'), /not found/);
    const saturday = await copy('  Saturday  ', friday);
    const saturdayPrompts = await prompts(saturday);
    assert.equal((await q('SELECT title FROM game_shows WHERE id=$1', [saturday]))[0].title, 'Saturday');
    assert.equal(saturdayPrompts.length, 2);
    assert.deepEqual(saturdayPrompts.map(p => p.question), fridayPrompts.filter(p => p.kind === 'trivia').map(p => p.question).reverse(), 'Two-question shuffle must change order');
    for (const p of saturdayPrompts) {
      const source = fridayPrompts.find(s => s.question === p.question);
      assert.notEqual(p.id, source.id);
      assert.equal(p.kind, 'trivia');
      assert.equal(p.status, 'draft');
      assert.equal(p.results_visible, false);
      assert.equal(p.trl_final, false);
      assert.equal(p.correct_option, source.correct_option);
      assert.deepEqual(p.options, source.options);
    }
    assert.deepEqual(await scalar('game_totals($1)', [saturday]), { counts: [], scores: [] });
    assert.deepEqual(await q('SELECT * FROM game_cast WHERE show_id=$1', [saturday]), []);
    await assert.rejects(copy('Another Saturday', friday), /End the active show/);
    assert.equal((await q('SELECT count(*)::int AS n FROM game_shows'))[0].n, 2);
    const saturdayFirst = saturdayPrompts[0];
    await scalar('game_admin($1,$2,$3)', [saturday, 'open', JSON.stringify({ id: saturdayFirst.id })]);
    await scalar('game_vote($1,$2,$3)', [saturdayFirst.id, viewer, saturdayFirst.correct_option]);
    await scalar('game_admin($1,$2,$3)', [saturday, 'finish', '{}']);
    assert.equal((await scalar('game_totals($1)', [saturday])).scores[0].score, 1, 'Returning guest gets a fresh score');
    const sunday = await copy('Sunday', saturday);
    assert.deepEqual((await prompts(sunday)).map(p => p.question), saturdayPrompts.map(p => p.question).reverse());
    assert.deepEqual(await scalar('game_totals($1)', [sunday]), { counts: [], scores: [] });
    assert.deepEqual(await prompts(friday), fridayPrompts);
    assert.deepEqual(await scalar('game_totals($1)', [friday]), fridayTotals);
    await scalar('game_admin($1,$2,$3)', [sunday, 'finish', '{}']);
    const empty = (await q("INSERT INTO game_shows(title,status) VALUES('Empty','finished') RETURNING id"))[0].id;
    await assert.rejects(copy('Empty copy', empty), /no trivia/);
    assert.equal((await q("SELECT count(*)::int AS n FROM game_shows WHERE title='Empty copy'"))[0].n, 0);
    await q("INSERT INTO game_prompts(show_id,kind,question,options,correct_option) VALUES($1,'trivia','Only question',$2,'a')", [empty, JSON.stringify(options)]);
    const single = await copy('One question', empty);
    assert.equal((await prompts(single)).length, 1);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await scalar("has_function_privilege($1,'game_copy_trivia_night(text,uuid)','EXECUTE')", [role]), false);
    }
    assert.equal(await scalar("has_function_privilege('service_role','game_copy_trivia_night(text,uuid)','EXECUTE')"), true);
    console.log('PASS: Friday–Sunday shuffle, copied answer keys, fresh IDs/votes/scores, unchanged source results, stable ordering, single-question/empty cases, rollback, permissions and migration reapply.');
  } finally { await db.close(); }
}
main().catch(e => { console.error(e); process.exit(1); });
