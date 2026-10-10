// Run against `npm run preview:game` only. No production URL is accepted.
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3106";
async function main() {
  async function request(
    path: string,
    body?: object,
    cookie = "",
    expected = 200,
  ) {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        cookie,
        ...(body ? { Origin: base } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    assert.equal(r.status, expected, JSON.stringify(data));
    return {
      data,
      cookie: r.headers.get("set-cookie")?.split(";")[0] || cookie,
    };
  }
  await request("/api/admin/game", undefined, "", 401);
  await request(
    "/api/game",
    { action: "vote", promptId: "fake", optionId: "0" },
    "",
    403,
  );
  const auth = await request("/api/auth/admin-login", {
    password: "local-game-test-only",
  });
  const adminCookie = auth.cookie;
  let state = (await request("/api/admin/game", undefined, adminCookie)).data;
  if (!state.show) {
    await request(
      "/api/admin/game",
      { action: "new_show", title: "2006 — browser rehearsal" },
      adminCookie,
    );
    state = (await request("/api/admin/game", undefined, adminCookie)).data;
  }
  let showId = state.show.id;
  const admin = (action: string, body: object = {}, expected = 200) =>
    request(
      "/api/admin/game",
      { action, showId, ...body },
      adminCookie,
      expected,
    );
  await admin("cast", {
    names: [
      "mkashe9",
      "SBconfetti",
      "EmmaIsNine",
      "neodafunky",
      "BlueShellVictim",
      "bbulldogs48",
    ],
  });
  const create = async (kind: string, question: string) => {
    await admin("create", {
      kind,
      question,
      options: [
        { label: "Pluto was reclassified" },
        { label: "The first iPod was released" },
      ],
      correctOption: "0",
    });
    return (
      await request("/api/admin/game", undefined, adminCookie)
    ).data.prompts.find((p: any) => p.question === question);
  };
  const trivia = await create("trivia", "Which happened in 2006?");
  let pub = (await request("/api/game")).data;
  assert.equal(pub.prompts.length, 0, "Draft must not be public");
  assert.equal(pub.cast, undefined);
  assert.equal(pub.suggestions, undefined);
  await admin("open", { id: trivia.id });
  pub = (await request("/api/game")).data;
  assert.equal(pub.prompts[0].correct_option, undefined, "Answer key hidden");
  assert.equal(pub.prompts[0].options[0].count, undefined, "Counts hidden");
  const viewer = await request("/api/game", {
    action: "join",
    name: "xXSuperFanXx",
  });
  assert(!JSON.stringify(viewer.data).includes("token_hash"));
  const again = await request(
    "/api/game",
    { action: "join", name: "NewName" },
    viewer.cookie,
  );
  assert.equal(
    again.data.viewer.id,
    viewer.data.viewer.id,
    "Rejoining preserves browser identity",
  );
  await request(
    "/api/game",
    { action: "vote", promptId: trivia.id, optionId: "0", userId: "spoofed" },
    viewer.cookie,
  );
  await request(
    "/api/game",
    { action: "vote", promptId: trivia.id, optionId: "1" },
    viewer.cookie,
    400,
  );
  pub = (await request("/api/game", undefined, viewer.cookie)).data;
  assert.equal(pub.prompts[0].answer, "0");
  assert.equal(pub.score, 0);
  await admin("close", { id: trivia.id });
  pub = (await request("/api/game", undefined, viewer.cookie)).data;
  assert.equal(pub.score, 1);
  assert.equal(pub.prompts[0].correct_option, undefined);
  await admin("reveal", { id: trivia.id });
  assert.equal(
    (await request("/api/game", undefined, viewer.cookie)).data.prompts[0]
      .correct_option,
    "0",
  );
  await request(
    "/api/game",
    { action: "suggest", showId, body: "Best AIM away message" },
    viewer.cookie,
  );
  assert.equal(
    (await request("/api/game", undefined, viewer.cookie)).data.suggestions,
    undefined,
  );
  state = (await request("/api/admin/game", undefined, adminCookie)).data;
  assert.equal(state.suggestions[0].name, "xXSuperFanXx");
  await admin("approve", {
    id: state.suggestions[0].id,
    question: "Best AIM away message",
  });
  state = (await request("/api/admin/game", undefined, adminCookie)).data;
  const award = state.prompts.find((p: any) => p.kind === "superlative");
  assert.equal(award.status, "draft");
  assert.equal(award.options.length, 6);
  await admin("open", { id: award.id });
  await request(
    "/api/game",
    { action: "vote", promptId: award.id, optionId: award.options[0].id },
    viewer.cookie,
  );
  await request(
    "/api/game",
    { action: "vote", promptId: award.id, optionId: award.options[1].id },
    viewer.cookie,
  );
  await admin("reveal", { id: award.id });
  pub = (await request("/api/game", undefined, viewer.cookie)).data;
  const counts = pub.prompts.find((p: any) => p.id === award.id).options;
  assert.equal(
    counts.reduce((n: number, o: any) => n + o.count, 0),
    1,
    "Only one vote after changing choice",
  );
  const trl = await create("trl", "Pick tonight’s final video");
  await admin("trl_final", { id: trl.id });
  await admin("open", { id: trl.id });
  await request(
    "/api/game",
    { action: "vote", promptId: trl.id, optionId: "1" },
    viewer.cookie,
  );
  await admin("finish");
  pub = (await request("/api/game", undefined, viewer.cookie)).data;
  assert.equal(pub.scores, undefined);
  await admin("reveal_show");
  pub = (await request("/api/game", undefined, viewer.cookie)).data;
  assert.equal(pub.scores[0].score, 1);
  assert.equal(pub.castScores[0].score, 1);
  assert.equal(pub.prompts.find((p: any) => p.trl_final).options[1].count, 1);
  await request(
    "/api/game",
    { action: "vote", promptId: trl.id, optionId: "0" },
    viewer.cookie,
    400,
  );
  await request(
    "/api/polls/answer",
    { answer: "publish immediately" },
    viewer.cookie,
    410,
  );
  const cross = await fetch(base + "/api/game", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://unrelated.example",
    },
    body: JSON.stringify({ action: "join", name: "Attacker" }),
  });
  assert.equal(cross.status, 400);
  // Leave a fresh rehearsal show with an open trivia popup for visual checks.
  await request(
    "/api/admin/game",
    { action: "new_show", title: "2006 — browser rehearsal" },
    adminCookie,
  );
  state = (await request("/api/admin/game", undefined, adminCookie)).data;
  showId = state.show.id;
  await admin("cast", {
    names: [
      "mkashe9",
      "SBconfetti",
      "EmmaIsNine",
      "neodafunky",
      "BlueShellVictim",
      "bbulldogs48",
    ],
  });
  const demo = await create("trivia", "Which happened in 2006?");
  await admin("open", { id: demo.id });
  const category = await create(
    "superlative",
    "Most likely to destroy the family computer with LimeWire",
  );
  await admin("open", { id: category.id });
  console.log(
    "PASS: real Next.js routes against isolated PostgreSQL fixture — admin auth, private data, session persistence, spoof resistance, votes, suggestions, final awards, and origin checks.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
