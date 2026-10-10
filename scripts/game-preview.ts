/** Isolated browser-test fixture. Uses real PostgreSQL via PGlite, with a
 * deliberately small REST adapter for the queries used by the game routes.
 * Never reads .env.local or connects to the live database. Not a production server.
 */
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

async function main() {
  const db = new PGlite();
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(readFileSync("sql/001_schema.sql", "utf8"));
  await db.exec(readFileSync("sql/021_show_game.sql", "utf8"));
  const tables = new Set([
    "game_shows",
    "game_viewers",
    "game_cast",
    "game_prompts",
    "game_votes",
    "game_suggestions",
    "admin_actions",
  ]);
  const rpc: Record<string, string[]> = {
    game_throttle: ["k", "seconds"],
    game_vote: ["p", "v", "o"],
    game_suggest: ["s", "v", "body_text"],
    game_totals: ["s"],
    game_admin: ["s", "action", "payload"],
  };
  const ident = (s: string) => {
    if (!/^[a-z_]+$/.test(s)) throw new Error("Invalid identifier");
    return `"${s}"`;
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1:54329");
      if (req.headers.apikey !== "game-test-service")
        throw new Error("Test service key required");
      const parts = url.pathname.split("/").filter(Boolean);
      const table = parts[2];
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      let data: any;
      if (table === "rpc") {
        const name = parts[3];
        if (!rpc[name]) throw new Error("Unknown function");
        const values = rpc[name].map((k) =>
          typeof body[k] === "object" ? JSON.stringify(body[k]) : body[k],
        );
        data = (
          await db.query<any>(
            `SELECT ${ident(name)}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
            values,
          )
        ).rows[0].result;
      } else {
        if (!tables.has(table)) throw new Error("Unknown table");
        const values: any[] = [];
        const bind = (v: any) => {
          values.push(v);
          return `$${values.length}`;
        };
        let rows: any[];
        if (req.method === "POST") {
          const keys = Object.keys(body);
          rows = (
            await db.query(
              `INSERT INTO ${ident(table)} (${keys.map(ident).join(",")}) VALUES (${keys.map((k) => bind(typeof body[k] === "object" ? JSON.stringify(body[k]) : body[k])).join(",")}) RETURNING *`,
              values,
            )
          ).rows;
        } else if (req.method === "GET" || req.method === "HEAD") {
          const filters: string[] = [];
          for (const [key, value] of url.searchParams) {
            if (["select", "order", "limit", "offset"].includes(key)) continue;
            if (value.startsWith("eq."))
              filters.push(`${ident(key)}=${bind(value.slice(3))}`);
            else if (value.startsWith("in.(") && value.endsWith(")"))
              filters.push(
                `${ident(key)} IN (${value
                  .slice(4, -1)
                  .split(",")
                  .map((v) => bind(v))
                  .join(",")})`,
              );
            else throw new Error("Unsupported fixture filter");
          }
          let sql = `SELECT * FROM ${ident(table)}${filters.length ? " WHERE " + filters.join(" AND ") : ""}`;
          const order = url.searchParams.get("order");
          if (order)
            sql +=
              " ORDER BY " +
              order
                .split(",")
                .map((o) => {
                  const [key, dir] = o.split(".");
                  return `${ident(key)} ${dir === "desc" ? "DESC" : "ASC"}`;
                })
                .join(",");
          const limit = url.searchParams.get("limit");
          if (limit) sql += ` LIMIT ${bind(Number(limit))}`;
          rows = (await db.query(sql, values)).rows;
        } else throw new Error("Unsupported fixture method");
        const select = url.searchParams.get("select");
        if (select && select !== "*") {
          rows = await Promise.all(
            rows.map(async (row) => {
              const result: Record<string, unknown> = {};
              for (const field of select.split(",")) {
                if (field === "game_viewers(name)")
                  result.game_viewers = (
                    await db.query(
                      "SELECT name FROM game_viewers WHERE id=$1",
                      [row.viewer_id],
                    )
                  ).rows[0];
                else result[field] = row[field];
              }
              return result;
            }),
          );
        }
        const single = req.headers.accept?.includes(
          "application/vnd.pgrst.object+json",
        );
        data = single ? rows[0] || null : rows;
        res.setHeader(
          "Content-Range",
          `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
        );
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ message: e instanceof Error ? e.message : String(e) }),
      );
    }
  });
  server.listen(54329, "127.0.0.1");
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", "3106", "-H", "127.0.0.1"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "game-test-anon",
        SUPABASE_SERVICE_ROLE_KEY: "game-test-service",
        SESSION_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PASSWORD_HASH: await bcrypt.hash("local-game-test-only", 10),
      },
    },
  );
  console.log(
    "Isolated game preview: http://127.0.0.1:3106/game · Admin test password: local-game-test-only",
  );
  const stop = () => {
    child.kill();
    server.close();
    void db.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", () => {
    server.close();
    void db.close();
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
