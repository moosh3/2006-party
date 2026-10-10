/**
 * Isolated playout/browser rehearsal: a real Next server + real PostgreSQL
 * in memory. Never imports dotenv, .env.local, or production credentials.
 * The tiny PostgREST adapter is ONLY a local test fixture, not a backend.
 *
 * Run: node --import tsx scripts/playout-preview.ts
 * Test: node --import tsx scripts/test-playout-api.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

const DATABASE_PORT = 54339;
const NEXT_PORT = 3116;
const FIXTURE_KEY = 'playout-fixture-service';
const SAMPLE_ID = 'EcHgOK9coz5K4rjSwOkoE7Y7O01201YMIC200RI6lNxnhs';
// Official https://www.mux.com/docs/guides/mux-player-web example. Measured by
// summing its public HLS #EXTINF values, not by guessing or shortening the clip.
const SAMPLE_DURATION = 249.86667;
const audienceCueRehearsal = process.argv.includes('--audience-cues');
const migrations = [
  '001_schema', '002_realtime_triggers', '003_enable_realtime', '004_synchronized_playback', '005_event_poster_mode',
  '006_video_queue', '007_poll_votes_user_name', '008_auto_advance_lock',
  '009_queue_transaction_functions', '010_playback_elapsed_time', '011_hold_screen',
  '012_stream_resume_improvements', '013_fix_sync_restarts',
  '014_showtime_playout_and_queue', '015_youtube_playlist_sources',
  '016_open_answer_polls', '017_video_playlist_shelf', '018_message_reactions',
  '019_lock_down_admin_tables', '020_2006_initial_state', '021_show_game',
  '022_playout_hardening', '024_audience_doors', '025_youtube_video_queue',
];
const tables = new Set([
  'current_stream', 'mux_items', 'video_queue', 'admin_actions', 'messages', 'chat_throttle',
  'polls', 'poll_options', 'poll_votes', 'message_reactions',
  'game_shows', 'game_viewers', 'game_cast', 'game_prompts', 'game_votes', 'game_suggestions', 'audience_doors',
]);
const rpcArguments: Record<string, string[]> = {
  get_playout_snapshot: [],
  playback_command: ['command_action', 'command_position', 'command_id', 'admin_user_id', 'expected_session_id'],
  set_manual_stream: ['new_playback_id', 'new_title', 'new_kind', 'new_source_type', 'new_youtube_playlist_id', 'new_source_url', 'admin_user_id', 'command_id'],
  toggle_hold: ['action', 'mux_item_id', 'admin_user_id', 'command_id'],
  advance_queue_command: ['admin_user_id', 'command_id', 'expected_session_id'],
  set_auto_advance: ['enabled', 'admin_user_id', 'command_id'],
  set_playout_mode: ['mode', 'admin_user_id', 'command_id'],
  delete_mux_item: ['item_id', 'admin_user_id'],
  enqueue_video: ['mux_item_id', 'admin_user_id'],
  reorder_queue: ['items', 'admin_user_id'],
  delete_from_queue: ['queue_item_id', 'admin_user_id'],
  game_throttle: ['k', 'seconds'], game_totals: ['s'],
  set_audience_doors: ['requested_doors_open', 'expected_revision', 'admin_user_id'],
};
const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid fixture identifier');
  return `"${value}"`;
};
const valueForSql = (value: unknown) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
function splitFields(select: string) {
  const result: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < select.length; i++) {
    if (select[i] === '(') depth++;
    if (select[i] === ')') depth--;
    if (select[i] === ',' && depth === 0) { result.push(select.slice(start, i)); start = i + 1; }
  }
  result.push(select.slice(start));
  return result;
}

async function main() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  // Supabase's external broadcast transport is not part of embedded PostgreSQL.
  // Supply its API-shaped no-op only; queue/timeline functions remain real SQL.
  await db.exec(`CREATE SCHEMA realtime; CREATE TABLE realtime.messages(id uuid);
    CREATE FUNCTION realtime.broadcast_changes(text,text,text,text,text,anyelement,anyelement)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;`);
  for (const name of migrations) await db.exec(readFileSync(`sql/${name}.sql`, 'utf8'));
  for (const [playback, duration, kind] of [
    ['a', 10, 'vod'], ['b', 20, 'vod'], ['c', 30, 'vod'], ['hold', 7, 'vod'],
    ['unknown', null, 'vod'], ['live', null, 'live'], [SAMPLE_ID, SAMPLE_DURATION, 'vod'],
  ]) {
    await db.query('INSERT INTO mux_items(playback_id,label,kind,duration_seconds,source_type) VALUES($1,$1,$2,$3,\'mux\')',
      [playback, kind, duration]);
  }
  await db.query(`UPDATE current_stream SET playback_id=$1,title='Isolated Mux sync rehearsal',
    kind='vod',source_type='mux',playout_mode='manual',playback_state='playing',
    playback_position=0,playback_updated_at=clock_timestamp()-interval '40 seconds',
    hold_screen_enabled=false,auto_advance_enabled=false,last_playback_command='set_video',
    last_command_id=$2 WHERE id=1`, [SAMPLE_ID, randomUUID()]);

  if (audienceCueRehearsal) {
    // Local-only clock control and sample poll, never read live credentials.
    await db.query(`UPDATE current_stream SET playback_position=41,playback_state='paused',
      playback_updated_at=clock_timestamp() WHERE id=1`);
    const showId = 'c0000000-0000-4000-8000-000000000001';
    const cast = [{ id: 'c0000000-0000-4000-8000-000000000003', label: 'Rehearsal cast A' },
      { id: 'c0000000-0000-4000-8000-000000000004', label: 'Rehearsal cast B' }];
    await db.query('INSERT INTO game_shows(id,title) VALUES($1,$2)', [showId, 'Isolated cue rehearsal']);
    for (const member of cast) await db.query('INSERT INTO game_cast(id,show_id,name) VALUES($1,$2,$3)', [member.id, showId, member.label]);
    await db.query(`INSERT INTO game_prompts(id,show_id,kind,question,options,status)
      VALUES($1,$2,'superlative','Best AIM away message (rehearsal only)',$3,'open')`,
    ['c0000000-0000-4000-8000-000000000002', showId, JSON.stringify(cast)]);
  }

  let databaseAvailable = true;
  const project = async (rows: Record<string, any>[], select: string | null) => {
    if (!select || select === '*') return rows;
    return Promise.all(rows.map(async (row) => {
      const result: Record<string, any> = {};
      for (const field of splitFields(select)) {
        const relation = /^(?:(\w+):)?(\w+)\((.*)\)$/.exec(field);
        if (relation) {
          const [, alias, name, fields] = relation;
          if (name === 'mux_items') {
            const foreignId = row.mux_item_id || row.hold_screen_mux_item_id;
            const item = (await db.query<Record<string, any>>('SELECT * FROM mux_items WHERE id=$1', [foreignId || null])).rows;
            result[alias || name] = (await project(item, fields))[0] || null;
          } else if (name === 'game_viewers') {
            const viewer = (await db.query<Record<string, any>>('SELECT * FROM game_viewers WHERE id=$1', [row.viewer_id])).rows;
            result[alias || name] = (await project(viewer, fields))[0] || null;
          } else throw new Error('Unsupported fixture relation');
        } else if (field === '*') Object.assign(result, row);
        else result[field] = row[field];
      }
      return result;
    }));
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${DATABASE_PORT}`);
      if (request.headers.apikey !== FIXTURE_KEY) {
        response.statusCode = 401;
        response.end(JSON.stringify({ code: 'FIXTURE_AUTH', message: 'Local test service key required' }));
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/__fixture/database') {
        if (typeof body.available !== 'boolean') throw new Error('available boolean required');
        databaseAvailable = body.available;
        response.end(JSON.stringify({ available: databaseAvailable })); return;
      }
      if (url.pathname === '/__fixture/query') {
        // Deliberately only in this loopback, key-protected isolated fixture.
        const result = await db.query(String(body.sql), body.args || []);
        response.end(JSON.stringify(result.rows)); return;
      }
      if (url.pathname === '/__fixture/health') {
        response.end(JSON.stringify({ available: databaseAvailable, sampleId: SAMPLE_ID, sampleDuration: SAMPLE_DURATION })); return;
      }
      if (!databaseAvailable) {
        response.statusCode = 503;
        response.end(JSON.stringify({ code: 'TEST_UNAVAILABLE', message: 'Isolated database outage' })); return;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'rest' || parts[1] !== 'v1') throw new Error('Unsupported fixture path');
      const table = parts[2];
      let data: unknown;
      if (table === 'rpc') {
        const name = parts[3];
        const allowed = rpcArguments[name];
        if (!allowed) throw new Error('Unsupported fixture RPC');
        if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('Unknown RPC argument');
        const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
        const args = keys.map((key) => valueForSql(body[key]));
        data = (await db.query<{ result: unknown }>(
          `SELECT ${identifier(name)}(${keys.map((key, i) => `${identifier(key)} => $${i + 1}`).join(',')}) AS result`, args,
        )).rows[0].result;
      } else {
        if (!tables.has(table)) throw new Error('Unsupported fixture table');
        const values: unknown[] = [];
        const bind = (value: unknown) => { values.push(valueForSql(value)); return `$${values.length}`; };
        const filters: string[] = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
          const column = identifier(key);
          if (value.startsWith('eq.')) filters.push(`${column} = ${bind(value.slice(3))}`);
          else if (value === 'is.null') filters.push(`${column} IS NULL`);
          else if (value === 'not.is.null') filters.push(`${column} IS NOT NULL`);
          else if (value.startsWith('in.(') && value.endsWith(')')) filters.push(`${column} IN (${value.slice(4, -1).split(',').map(bind).join(',')})`);
          else {
            const [op, ...rest] = value.split('.');
            const sqlOp = { neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op as 'neq'];
            if (!sqlOp) throw new Error('Unsupported fixture filter');
            filters.push(`${column} ${sqlOp} ${bind(rest.join('.'))}`);
          }
        }
        const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
        let rows: Record<string, any>[];
        let total: number;
        if (request.method === 'POST') {
          const entries = Array.isArray(body) ? body : [body];
          rows = [];
          for (const entry of entries) {
            const keys = Object.keys(entry);
            const rowValues = keys.map((key) => valueForSql(entry[key]));
            const inserted = await db.query<Record<string, any>>(
              `INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, rowValues);
            rows.push(...inserted.rows);
          }
          total = rows.length;
        } else if (request.method === 'PATCH') {
          const assignments = Object.keys(body).map((key) => `${identifier(key)}=${bind(body[key])}`);
          rows = (await db.query<Record<string, any>>(`UPDATE ${identifier(table)} SET ${assignments.join(',')}${where} RETURNING *`, values)).rows;
          total = rows.length;
        } else if (request.method === 'DELETE') {
          rows = (await db.query<Record<string, any>>(`DELETE FROM ${identifier(table)}${where} RETURNING *`, values)).rows;
          total = rows.length;
        } else if (request.method === 'GET' || request.method === 'HEAD') {
          total = Number((await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${identifier(table)}${where}`, values)).rows[0].total);
          let sql = `SELECT * FROM ${identifier(table)}${where}`;
          const order = url.searchParams.get('order');
          if (order) sql += ' ORDER BY ' + order.split(',').map((part) => {
            const [column, direction] = part.split('.');
            return `${identifier(column)} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
          }).join(',');
          const limit = url.searchParams.get('limit'), offset = url.searchParams.get('offset');
          if (limit) sql += ` LIMIT ${bind(Number(limit))}`;
          if (offset) sql += ` OFFSET ${bind(Number(offset))}`;
          rows = (await db.query<Record<string, any>>(sql, values)).rows;
        } else throw new Error('Unsupported fixture method');
        rows = await project(rows, url.searchParams.get('select'));
        response.setHeader('Content-Range', `0-${Math.max(0, rows.length - 1)}/${total}`);
        const single = request.headers.accept?.includes('application/vnd.pgrst.object+json');
        if (single && rows.length !== 1) {
          response.statusCode = 406;
          response.end(JSON.stringify({ code: 'PGRST116', message: 'Expected exactly one fixture row', details: `${rows.length} rows` })); return;
        }
        data = single ? rows[0] : rows;
        if (request.method === 'HEAD') { response.end(); return; }
      }
      response.end(JSON.stringify(data));
    } catch (error) {
      const failure = error as Error & { code?: string; detail?: string };
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ code: failure.code || 'FIXTURE_ERROR', message: failure.message, details: failure.detail }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(DATABASE_PORT, '127.0.0.1', resolve); });
  // NODE_ENV=test makes Next explicitly skip .env.local. Only allowlist basic
  // runtime settings; no live credentials or shell-exported provider tokens.
  const runtimeEnv: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL']) {
    if (process.env[key]) runtimeEnv[key] = process.env[key]!;
  }
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(NEXT_PORT), '-H', '127.0.0.1'], {
    stdio: 'inherit',
    env: {
      ...runtimeEnv, NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_DEV_MODE: 'false',
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${DATABASE_PORT}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'playout-fixture-anon', SUPABASE_SERVICE_ROLE_KEY: FIXTURE_KEY,
      SESSION_SECRET: randomBytes(32).toString('hex'), ADMIN_PASSWORD_HASH: await bcrypt.hash('local-playout-test-only', 10),
      MUX_TOKEN_ID: '', MUX_TOKEN_SECRET: '', MUX_SIGNING_KEY_ID: '', MUX_SIGNING_KEY_PRIVATE: '',
      YOUTUBE_API_KEY: '', NEXT_PUBLIC_EVENT_DATE: '', SHOWTIME_START_AT: '',
      NEXT_PUBLIC_AUDIENCE_CUE_REHEARSAL: audienceCueRehearsal ? '1' : '',
    },
  });
  console.log(`Isolated playout preview: http://127.0.0.1:${NEXT_PORT}/stage · Local admin password: local-playout-test-only`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true; child.kill(); server.close(); void db.close();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.once('exit', stop);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
