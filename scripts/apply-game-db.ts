import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Supabase environment variables are missing");
  const host = new URL(url).hostname;
  if (!/^[a-z0-9]+\.supabase\.co$/.test(host))
    throw new Error("Expected a hosted Supabase project URL");
  const ref = host.split(".")[0];
  const db = createClient(url, key, { auth: { persistSession: false } });
  const existing = await db.from("game_shows").select("id").limit(0);
  if (!existing.error)
    throw new Error(
      "Game tables already exist. Use npm run db:game:verify; do not reapply this migration.",
    );
  if (!["PGRST205", "42P01"].includes(existing.error.code))
    throw new Error(existing.error.message);
  // The CLI obtains credentials from its own login; never copy them into chat.
  execFileSync(
    "npx",
    [
      "--yes",
      "supabase",
      "db",
      "query",
      "--linked",
      "--project-ref",
      ref,
      "--file",
      "sql/021_show_game.sql",
    ],
    { stdio: "inherit" },
  );
  console.log("Game migration applied. Run npm run db:game:verify next.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
