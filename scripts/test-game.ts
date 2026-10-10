import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { castScores, leaders, type GamePrompt } from "../lib/game-types";

async function main() {
  const db = new PGlite();
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(readFileSync("sql/001_schema.sql", "utf8"));
  await db.exec(
    "GRANT ALL ON polls,poll_options,poll_votes TO anon,authenticated;",
  );
  await db.exec(readFileSync("sql/021_show_game.sql", "utf8"));
  const q = async (sql: string, params: unknown[] = []) =>
    (await db.query<any>(sql, params)).rows;
  const s = (
    await q("INSERT INTO game_shows(title) VALUES('Test night') RETURNING id")
  )[0].id;
  const admin = (action: string, payload: object = {}) =>
    q("SELECT game_admin($1,$2,$3)", [s, action, JSON.stringify(payload)]);
  const a = (
    await q(
      "INSERT INTO game_viewers(token_hash,name) VALUES('alice','Alice') RETURNING id",
    )
  )[0].id;
  const b = (
    await q(
      "INSERT INTO game_viewers(token_hash,name) VALUES('bob','Bob') RETURNING id",
    )
  )[0].id;
  const create = async (kind: string, question: string, extra = {}) => {
    await admin("create", {
      kind,
      question,
      options: [
        { id: "0", label: "A" },
        { id: "1", label: "B" },
      ],
      ...(kind === "trivia" ? { correctOption: "0" } : {}),
      ...extra,
    });
    return (
      await q("SELECT * FROM game_prompts WHERE question=$1", [question])
    )[0];
  };
  const vote = (id: string, user: string, option: string) =>
    q("SELECT game_vote($1,$2,$3)", [id, user, option]);
  const totals = async () =>
    (await q("SELECT game_totals($1) AS totals", [s]))[0].totals;
  await assert.rejects(
    q("INSERT INTO game_shows(title) VALUES('Another active night')"),
  );
  await assert.rejects(create("superlative", "No cast yet"));
  await admin("cast", {
    names: ["Cast A", "Cast B", "Cast C", "Cast D", "Cast E", "Cast F"],
  });
  const trivia = await create("trivia", "Question one");
  await admin("edit", {
    id: trivia.id,
    kind: "trivia",
    question: "Question one edited",
    options: [
      { id: "0", label: "Correct choice" },
      { id: "1", label: "Other choice" },
    ],
    correctOption: "0",
  });
  assert.equal(
    (await q("SELECT question FROM game_prompts WHERE id=$1", [trivia.id]))[0]
      .question,
    "Question one edited",
  );
  await assert.rejects(vote(trivia.id, a, "0"), /closed/);
  await admin("open", { id: trivia.id });
  await assert.rejects(
    admin("edit", {
      id: trivia.id,
      kind: "trivia",
      question: "Changed after opening",
    }),
    /Only drafts/,
  );
  await assert.rejects(
    admin("discard", { id: trivia.id }),
    /Only private drafts/,
  );
  await assert.rejects(admin("reveal", { id: trivia.id }), /Close trivia/);
  const trivia2 = await create("trivia", "Question two");
  await assert.rejects(admin("open", { id: trivia2.id }), /current trivia/);
  await assert.rejects(vote(trivia.id, a, "invalid"), /Invalid answer/);
  await vote(trivia.id, a, "0");
  await assert.rejects(vote(trivia.id, a, "1"), /already locked/);
  await vote(trivia.id, b, "1");
  assert.equal(
    (await totals()).scores.length,
    0,
    "No scores reveal correctness while question open",
  );
  await admin("close", { id: trivia.id });
  await assert.rejects(vote(trivia.id, b, "0"), /closed/);
  assert.equal((await totals()).scores.find((x: any) => x.id === a).score, 1);
  assert.equal((await totals()).scores.find((x: any) => x.id === b).score, 0);
  await admin("reveal", { id: trivia.id });
  await admin("open", { id: trivia2.id });
  await vote(trivia2.id, b, "0");
  await admin("close", { id: trivia2.id });
  assert.equal(
    leaders((await totals()).scores).length,
    2,
    "SuperFan ties preserved",
  );
  const superlative = await create("superlative", "Best away message");
  assert.equal(
    superlative.options.length,
    6,
    "Cast choices are not capped at five",
  );
  await assert.rejects(
    admin("cast", { names: ["Someone else", "Replacement"] }),
    /locked/,
  );
  await admin("open", { id: superlative.id });
  await assert.rejects(
    vote(superlative.id, a, "made-up-cast"),
    /Invalid answer/,
  );
  await vote(superlative.id, a, superlative.options[0].id);
  await vote(superlative.id, a, superlative.options[1].id);
  await vote(superlative.id, b, superlative.options[0].id);
  assert.equal(
    (
      await q("SELECT count(*)::int AS n FROM game_votes WHERE prompt_id=$1", [
        superlative.id,
      ])
    )[0].n,
    2,
    "Change vote never adds a second vote",
  );
  await admin("close", { id: superlative.id });
  const counted = {
    ...superlative,
    status: "closed",
    options: superlative.options.map((o: any, i: number) => ({
      ...o,
      count: i < 2 ? 1 : 0,
    })),
  } as GamePrompt;
  const cast = superlative.options.map((o: any) => ({
    id: o.id,
    name: o.label,
  }));
  assert.equal(
    leaders(castScores([counted], cast)).length,
    2,
    "Both tied category winners receive a point",
  );
  assert.equal(
    castScores(
      [
        {
          ...counted,
          options: counted.options.map((o) => ({ ...o, count: 0 })),
        },
      ],
      cast,
    )[0].score,
    0,
    "Empty categories award no points",
  );
  await q("SELECT game_suggest($1,$2,$3)", [
    s,
    a,
    "Most likely to download a virus",
  ]);
  await assert.rejects(
    q("SELECT game_suggest($1,$2,$3)", [s, a, "Another idea"]),
    /30 seconds/,
  );
  const suggestion = (await q("SELECT * FROM game_suggestions"))[0];
  assert.equal(suggestion.status, "pending");
  assert.equal(suggestion.prompt_id, null, "Submitting does not publish");
  await admin("approve", {
    id: suggestion.id,
    question: "Most likely to break LimeWire",
  });
  await assert.rejects(
    admin("approve", { id: suggestion.id, question: "Duplicate" }),
    /no longer pending/,
  );
  const approved = (
    await q(
      "SELECT p.* FROM game_prompts p JOIN game_suggestions s ON s.prompt_id=p.id",
    )
  )[0];
  assert.equal(
    approved.status,
    "draft",
    "Approval does not automatically open voting",
  );
  assert.equal(approved.options.length, 6);
  await admin("discard", { id: approved.id });
  assert.equal(
    (await q("SELECT * FROM game_prompts WHERE id=$1", [approved.id])).length,
    0,
  );
  await admin("suggestions");
  await assert.rejects(
    q("SELECT game_suggest($1,$2,$3)", [s, b, "New idea"]),
    /closed/,
  );
  const trl = await create("trl", "Final video");
  await admin("trl_final", { id: trl.id });
  await admin("open", { id: trl.id });
  await vote(trl.id, b, "1");
  await admin("block", { viewerId: b });
  await assert.rejects(vote(trl.id, b, "0"), /unavailable/);
  assert.equal(
    (await totals()).counts.filter((c: any) => c.prompt_id === trl.id).length,
    0,
    "Blocked votes excluded",
  );
  assert.equal(
    (await totals()).scores.length,
    1,
    "Blocked viewers excluded from leaderboard",
  );
  await admin("rename", { viewerId: a, name: "Safe Name" });
  assert.equal((await totals()).scores[0].name, "Safe Name");
  // More than 1,000 votes must not truncate aggregate counts.
  await q(
    "INSERT INTO game_viewers(token_hash,name) SELECT 'bulk-'||n,'Viewer '||n FROM generate_series(1,1101) n",
  );
  await q(
    "INSERT INTO game_votes SELECT $1,id,'0' FROM game_viewers WHERE token_hash LIKE 'bulk-%'",
    [trl.id],
  );
  assert.equal(
    (await totals()).counts.find((c: any) => c.prompt_id === trl.id).count,
    1101,
  );
  await admin("finish");
  await assert.rejects(vote(trl.id, a, "0"), /not accepting/);
  assert.equal(
    (await q("SELECT status FROM game_prompts WHERE id=$1", [trl.id]))[0]
      .status,
    "closed",
  );
  await admin("reveal_show");
  const next = (
    await q("INSERT INTO game_shows(title) VALUES('Next night') RETURNING id")
  )[0].id;
  assert.equal(
    (await q("SELECT game_totals($1) AS t", [next]))[0].t.scores.length,
    0,
    "New night resets score",
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of [
      "game_prompts",
      "game_votes",
      "game_suggestions",
      "game_viewers",
    ])
      await assert.rejects(q(`SELECT * FROM ${table}`), /permission denied/);
    await assert.rejects(
      q("SELECT game_admin($1,$2,$3)", [s, "reveal_show", "{}"]),
      /permission denied/,
    );
    await assert.rejects(
      q("INSERT INTO polls(question,created_by) VALUES('Bypass','attacker')"),
      /row-level security/,
    );
    await db.exec("RESET ROLE");
  }
  await db.close();
  console.log(
    "PASS: SQL migration, private tables, locked answers, changeable votes, scoring/ties, cast enforcement, moderation, >1,000 votes, final results, and per-night isolation.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
