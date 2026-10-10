/** Real route regression against `npm run preview:playout` only. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

// Intentionally fixed loopback targets. No environment variable or command-line
// argument can point this mutation-based rehearsal at a production database.
const base = "http://127.0.0.1:3116";
const fixture = "http://127.0.0.1:54339";
const fixtureKey = "playout-fixture-service";
const ip = "198.51.100.41";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function fixtureRequest(path: string, body?: object) {
  const response = await fetch(fixture + path, {
    method: body ? "POST" : "GET",
    headers: { apikey: fixtureKey, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, 200, "Isolated fixture must be available");
  return response.json();
}

async function query(sql: string, args: unknown[] = []) {
  return fixtureRequest("/__fixture/query", { sql, args });
}

async function request(
  options: {
    body?: unknown;
    raw?: string;
    cookie?: string;
    origin?: string;
    expected?: number;
    path?: string;
    ip?: string;
  } = {},
) {
  const post = options.body !== undefined || options.raw !== undefined;
  const response = await fetch(base + (options.path || "/api/audience/sign-on"), {
    method: post ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(post ? { Origin: options.origin ?? base } : {}),
      Cookie: options.cookie || "",
      "X-Forwarded-For": options.ip || ip,
    },
    ...(post
      ? { body: options.raw ?? JSON.stringify(options.body) }
      : {}),
  });
  const data = await response.json();
  assert.equal(response.status, options.expected ?? 200, JSON.stringify(data));
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.match(response.headers.get("cache-control") || "", /private/);
  return { response, data };
}

async function main() {
  const health = await fixtureRequest("/__fixture/health");
  assert.equal(health.available, true);
  let viewerId: string | null = null;
  const showId = randomUUID();
  const promptId = randomUUID();
  let seededShow = false;
  try {
    const signedOut = await request();
    assert.deepEqual(signedOut.data, { viewer: null });
    assert.equal(signedOut.response.headers.get("set-cookie"), null);
    assert.deepEqual(
      (await request({ cookie: "2006_game_session=malformed" })).data,
      { viewer: null },
    );

    for (const name of [null, [], {}, 1, "A", "A".repeat(21), "a\nb", "www.example.test", "fuck"]) {
      const invalid = await request({ body: { name }, expected: 400 });
      assert.equal(typeof invalid.data.error, "string");
      assert.equal(invalid.response.headers.get("set-cookie"), null);
    }
    for (const body of [null, [], "not an object"]) {
      await request({ body, expected: 400 });
    }
    await request({ raw: "{broken", expected: 400 });
    for (const origin of ["https://unrelated.example", "not-a-url"]) {
      const rejected = await request({ body: { name: "UnrelatedFan" }, origin, expected: 403 });
      assert.deepEqual(rejected.data, { error: "Invalid request origin" });
      assert.equal(rejected.response.headers.get("set-cookie"), null);
    }
    await request({ path: "/api/chat/send", body: { userId: "spoofed", userName: "Imposter", body: "No cookie" }, expected: 403 });
    await request({ path: "/api/chat/reactions", body: { messageId: 1, userId: "spoofed", userName: "Imposter", reaction: "love" }, expected: 403 });

    const created = await request({ body: { name: "  xXFixtureFanXx  ", id: "spoofed" } });
    assert.deepEqual(Object.keys(created.data), ["viewer"]);
    assert.deepEqual(Object.keys(created.data.viewer).sort(), ["blocked", "id", "name"]);
    assert.equal(created.data.viewer.name, "xXFixtureFanXx");
    assert.equal(created.data.viewer.blocked, false);
    assert.match(created.data.viewer.id, /^[a-f0-9-]{36}$/);
    assert.notEqual(created.data.viewer.id, "spoofed");
    viewerId = created.data.viewer.id;

    const setCookie = created.response.headers.get("set-cookie") || "";
    assert.match(setCookie, /^2006_game_session=[a-f0-9]{64};/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /Max-Age=604800/i);
    const cookie = setCookie.split(";")[0];
    const token = cookie.split("=")[1];
    assert(!JSON.stringify(created.data).includes(token));
    assert(!JSON.stringify(created.data).includes(sha256(token)));
    // Check immediately, before unrelated routes compile or network checks
    // consume the throttle's five-second window in a cold local server.
    const throttled = await request({ body: { name: "NoFreshIdentity" }, expected: 429 });
    assert.equal(throttled.response.headers.get("set-cookie"), null);
    assert.equal(throttled.data.error, "Please wait before trying again");
    const stored = await query("SELECT token_hash,name FROM game_viewers WHERE id=$1", [viewerId]);
    assert.deepEqual(stored, [{ token_hash: sha256(token), name: "xXFixtureFanXx" }]);
    assert.deepEqual((await request({ cookie })).data, created.data);
    assert.equal((await request({ cookie })).response.headers.get("set-cookie"), null);

    const chat = await request({
      path: "/api/chat/send", cookie, expected: 201,
      body: { room: "event", userId: "spoofed", userName: "Imposter", body: "Sign-on integration test only" },
    });
    assert.deepEqual(await query("SELECT user_id,user_name,body FROM messages WHERE id=$1", [chat.data.id]),
      [{ user_id: viewerId, user_name: "xXFixtureFanXx", body: "Sign-on integration test only" }],
      "Chat must ignore the submitted identity and use the canonical cookie");
    assert.deepEqual(chat.data.message, {
      id: chat.data.id, room: 'event', user_id: viewerId, user_name: 'xXFixtureFanXx',
      body: 'Sign-on integration test only', kind: 'user', created_at: chat.data.createdAt,
      reactions: [], viewerReaction: null,
    }, 'Accepted messages must be safe to render immediately without realtime');
    assert(!JSON.stringify(chat.data).includes(token));
    assert(!JSON.stringify(chat.data).includes(sha256(token)));
    await request({ path: "/api/chat/send", cookie,
      body: { room: "event", userId: "another spoof", userName: "Imposter", body: "Throttle still applies" }, expected: 429 });
    await request({ path: "/api/chat/send", cookie,
      body: { body: "Cross-origin chat" }, origin: "https://unrelated.example", expected: 403 });

    const reactionBody = { messageId: chat.data.id, userId: "spoofed", userName: "Imposter", reaction: "love" };
    const reaction = await request({ path: "/api/chat/reactions", cookie, body: reactionBody });
    assert.equal(reaction.data.viewerReaction, "love");
    assert.deepEqual(reaction.data.reactions, [{ reaction: "love", count: 1, viewerReacted: true }]);
    assert.deepEqual(await query("SELECT user_id,user_name,reaction FROM message_reactions WHERE message_id=$1", [chat.data.id]),
      [{ user_id: viewerId, user_name: "xXFixtureFanXx", reaction: "love" }],
      "Reactions must ignore submitted identity labels");
    const removed = await request({ path: "/api/chat/reactions", cookie, body: { ...reactionBody, userId: "different spoof" } });
    assert.equal(removed.data.viewerReaction, null);
    assert.deepEqual(removed.data.reactions, [], "The existing same-reaction toggle must still remove the viewer's reaction");
    await request({ path: "/api/chat/reactions", cookie, body: reactionBody });
    await request({ path: "/api/chat/reactions", cookie, body: reactionBody, origin: "https://unrelated.example", expected: 403 });

    // Seed only test-owned, historic show records. Re-sign-on must not discard
    // an existing correct answer or reset its score.
    await query("INSERT INTO game_shows(id,title,status,created_at) VALUES($1,'Sign-on test only','finished','2006-01-01')", [showId]);
    seededShow = true;
    await query(`INSERT INTO game_prompts(id,show_id,kind,question,options,correct_option,status)
      VALUES($1,$2,'trivia','Test only',$3,'0','closed')`,
    [promptId, showId, JSON.stringify([{ id: "0", label: "Correct" }, { id: "1", label: "Other" }])]);
    await query("INSERT INTO game_votes(prompt_id,viewer_id,option_id) VALUES($1,$2,'0')", [promptId, viewerId]);
    for (const name of ["DifferentName", "fuck", null]) {
      const returning = await request({ body: { name }, cookie });
      assert.deepEqual(returning.data, created.data, "Canonical identity must be reused");
      assert.equal(returning.response.headers.get("set-cookie"), null);
    }
    const [totals] = await query("SELECT game_totals($1) AS totals", [showId]);
    assert.equal(totals.totals.scores[0].id, viewerId);
    assert.equal(totals.totals.scores[0].score, 1);
    assert.deepEqual(await query("SELECT option_id FROM game_votes WHERE prompt_id=$1 AND viewer_id=$2", [promptId, viewerId]), [{ option_id: "0" }]);

    // Moderation is retained even when a replacement name is submitted.
    await query("UPDATE game_viewers SET blocked=true WHERE id=$1", [viewerId]);
    const blocked = await request({ cookie });
    assert.equal(blocked.data.viewer.id, viewerId);
    assert.equal(blocked.data.viewer.blocked, true);
    const refused = await request({ body: { name: "BlockedReplacement" }, cookie, expected: 403 });
    assert.equal(refused.response.headers.get("set-cookie"), null);
    assert.equal((await query("SELECT count(*)::int AS total FROM game_viewers WHERE name='BlockedReplacement'"))[0].total, 0);
    await request({ path: "/api/chat/send", cookie, body: { userId: "unblocked-spoof", userName: "NewName", body: "Blocked replacement" }, expected: 403 });
    assert.equal((await query("SELECT count(*)::int AS total FROM messages WHERE user_id=$1", [viewerId]))[0].total, 1,
      "A blocked or spoofed chat request must not add a message");
    await request({ path: "/api/chat/reactions", cookie, body: { ...reactionBody, reaction: "like" }, expected: 403 });
    assert.deepEqual(await query("SELECT reaction FROM message_reactions WHERE message_id=$1 AND user_id=$2", [chat.data.id, viewerId]),
      [{ reaction: "love" }], "Blocked viewers must not replace or remove an existing reaction");

    // Lookup and insert failures must fail closed, not create a second session.
    await fixtureRequest("/__fixture/database", { available: false });
    try {
      for (const options of [{ cookie }, { body: { name: "OutageNewViewer" }, cookie }, { body: { name: "OutageNewViewer" }, ip: "198.51.100.43" }]) {
        const unavailable = await request({ ...options, expected: 503 });
        assert.deepEqual(unavailable.data, { error: "Sign-on is temporarily unavailable. Please try again." });
        assert.equal(unavailable.response.headers.get("set-cookie"), null);
      }
      const unavailableChat = await request({ path: "/api/chat/send", cookie,
        body: { body: "Outage chat" }, expected: 503 });
      assert.deepEqual(unavailableChat.data, { error: "Chat is temporarily unavailable. Please try again." });
      const unavailableReaction = await request({ path: "/api/chat/reactions", cookie, body: reactionBody, expected: 503 });
      assert.deepEqual(unavailableReaction.data, { error: "Reactions are temporarily unavailable. Please try again." });
    } finally {
      await fixtureRequest("/__fixture/database", { available: true });
    }
    assert.equal((await query("SELECT count(*)::int AS total FROM game_viewers WHERE name='OutageNewViewer'"))[0].total, 0);
    assert.equal((await request({ cookie })).data.viewer.blocked, true);
    console.log("PASS: real audience sign-on + chat routes — moderated names, canonical cookie identity, score/vote preservation, chat/reaction spoof resistance, reaction toggling, private responses, blocked sessions, origin checks, shared throttle, and fail-closed outages.");
  } finally {
    await fixtureRequest("/__fixture/database", { available: true });
    if (viewerId) {
      await query("DELETE FROM message_reactions WHERE user_id=$1", [viewerId]);
      await query("DELETE FROM messages WHERE user_id=$1", [viewerId]);
      await query("DELETE FROM chat_throttle WHERE user_id=$1", [viewerId]);
      await query("DELETE FROM game_votes WHERE viewer_id=$1", [viewerId]);
      await query("DELETE FROM game_viewers WHERE id=$1", [viewerId]);
    }
    if (seededShow) {
      await query("DELETE FROM game_prompts WHERE show_id=$1", [showId]);
      await query("DELETE FROM game_shows WHERE id=$1", [showId]);
    }
    await query("DELETE FROM game_limits WHERE key=$1", [`join:${sha256(ip)}`]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
