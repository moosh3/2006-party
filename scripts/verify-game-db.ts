import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !anon)
    throw new Error("Supabase environment variables are missing");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const publicDb = createClient(url, anon, { auth: { persistSession: false } });
  let failed = false;
  for (const table of [
    "current_stream",
    "messages",
    "polls",
    "poll_options",
    "poll_votes",
    "game_shows",
    "game_viewers",
    "game_cast",
    "game_prompts",
    "game_votes",
    "game_suggestions",
    "game_limits",
  ]) {
    const { error, count } = await db
      .from(table)
      .select("*", { count: "exact" })
      .limit(0);
    console.log(`${table}: ${error ? error.message : `OK (${count} rows)`}`);
    if (error) failed = true;
  }
  for (const table of [
    "game_prompts",
    "game_votes",
    "game_suggestions",
    "game_viewers",
  ]) {
    const { error } = await publicDb.from(table).select("*").limit(0);
    const denied = error?.code === "42501";
    console.log(
      `${table} public access: ${denied ? "blocked" : "not verified"}`,
    );
    if (!denied) failed = true;
  }
  const { error } = await db.rpc("game_totals", {
    s: "00000000-0000-0000-0000-000000000000",
  });
  console.log(`Scoring function: ${error ? error.message : "OK"}`);
  if (error) failed = true;
  if (failed) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
