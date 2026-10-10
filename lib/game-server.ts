import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as db } from "./supabase-admin";
import {
  castScores,
  type GamePrompt,
  type GameScore,
  type GameState,
} from "./game-types";

export const GAME_COOKIE = "2006_game_session";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");

export function textInput(value: unknown, min: number, max: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error(`Use ${min}–${max} characters`);
  return value.trim();
}
export function moderatedText(value: unknown, min: number, max: number) {
  const text = textInput(value, min, max);
  if (
    /\b(fuck\w*|shit\w*|cunt\w*)\b/i.test(text) ||
    /https?:\/\/|www\./i.test(text)
  )
    throw new Error("Please remove profanity or links");
  return text;
}
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  // Next normalizes loopback URLs internally. Compare against the actual Host
  // header so same-origin browser posts also work on 127.0.0.1 and custom hosts.
  if (
    origin &&
    new URL(origin).origin !==
      `${req.nextUrl.protocol}//${req.headers.get("host")}`
  )
    throw new Error("Invalid request origin");
}
export function failure(error: unknown, status = 400) {
  console.error("Game request:", error);
  const message =
    error instanceof Error ? error.message : "Game is temporarily unavailable";
  return NextResponse.json({ error: message }, { status });
}
export function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
export async function gameViewer() {
  const token = cookies().get(GAME_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const r = await db
    .from("game_viewers")
    .select("id,name,blocked")
    .eq("token_hash", hash(token))
    .maybeSingle();
  check(r.error);
  return r.data as { id: string; name: string; blocked: boolean } | null;
}
export async function throttle(key: string, seconds: number) {
  const r = await db.rpc("game_throttle", { k: key, seconds });
  check(r.error);
  if (!r.data) throw new Error("Please wait before trying again");
}

export async function snapshot(
  admin = false,
  requestedShow?: string | null,
): Promise<GameState> {
  const viewer = admin ? null : await gameViewer();
  let query = db.from("game_shows").select("*");
  if (requestedShow && admin) query = query.eq("id", requestedShow);
  const showResult = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  check(showResult.error);
  const show = showResult.data;
  if (!show) return { show: null, viewer, prompts: [], score: 0 };
  const [pr, cr, tr] = await Promise.all([
    db
      .from("game_prompts")
      .select("*")
      .eq("show_id", show.id)
      .order("created_at"),
    db.from("game_cast").select("id,name").eq("show_id", show.id),
    db.rpc("game_totals", { s: show.id }),
  ]);
  [pr, cr, tr].forEach((r) => check(r.error));
  const promptIds = (pr.data || []).map((p) => p.id);
  const vr =
    viewer && promptIds.length
      ? await db
          .from("game_votes")
          .select("prompt_id,option_id")
          .eq("viewer_id", viewer.id)
          .in("prompt_id", promptIds)
      : { data: [], error: null };
  check(vr.error);
  const totals = tr.data as {
    counts: { prompt_id: string; option_id: string; count: number }[];
    scores: GameScore[];
  };
  const counts = new Map(
    totals.counts.map((c) => [`${c.prompt_id}:${c.option_id}`, c.count]),
  );
  const all = (pr.data as GamePrompt[]).map((p) => ({
    ...p,
    options: p.options.map((o) => ({
      ...o,
      count: counts.get(`${p.id}:${o.id}`) || 0,
    })),
  }));
  const revealFinal = show.status === "finished" && show.results_visible;
  const prompts = all
    .filter((p) => admin || p.status !== "draft")
    .map((p) => {
      const { correct_option, ...publicPrompt } = p;
      const visible =
        admin || p.results_visible || (revealFinal && p.status === "closed");
      return {
        ...publicPrompt,
        options: p.options.map(({ count, ...o }) =>
          visible ? { ...o, count } : o,
        ),
        ...(admin || (visible && p.status === "closed")
          ? { correct_option }
          : {}),
        answer: vr.data?.find((v) => v.prompt_id === p.id)?.option_id,
      };
    });
  const state: GameState = {
    show,
    viewer,
    prompts,
    score: totals.scores.find((s) => s.id === viewer?.id)?.score || 0,
    ...(admin || revealFinal
      ? { scores: totals.scores, castScores: castScores(all, cr.data || []) }
      : {}),
  };
  if (admin) {
    state.cast = cr.data || [];
    const r = await db
      .from("game_suggestions")
      .select("id,body,viewer_id,status,game_viewers(name)")
      .eq("show_id", show.id)
      .eq("status", "pending")
      .order("created_at")
      .limit(200);
    check(r.error);
    state.suggestions = (r.data || []).map((x: any) => ({
      ...x,
      name: x.game_viewers?.name || "Viewer",
    }));
  }
  return state;
}
