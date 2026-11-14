import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { supabaseAdmin as db } from "@/lib/supabase-admin";
import { invitationActionType, isShowInvitationKind } from '@/lib/show-invitations';
import {
  check,
  failure,
  sameOrigin,
  snapshot,
  textInput,
} from "@/lib/game-server";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if ((await getAdminSession())?.role !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const shows = await db
      .from("game_shows")
      .select("id,title,status")
      .order("created_at", { ascending: false })
      .limit(100);
    check(shows.error);
    return NextResponse.json(
      {
        ...(await snapshot(true, req.nextUrl.searchParams.get("show"))),
        shows: shows.data,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e, 503);
  }
}
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session || session.role !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    sameOrigin(req);
    const b = await req.json();
    let createdShowId: string | undefined;
    if (b.action === "new_show") {
      const title = textInput(b.title, 1, 100);
      if (b.triviaSourceShowId) {
        const source = textInput(b.triviaSourceShowId, 36, 36);
        const r = await db.rpc("game_copy_trivia_night", { night_title: title, source_show: source });
        if (r.error?.code === "PGRST202")
          throw new Error("Trivia reuse needs database update 032. Ask the operator to install it before copying a night.");
        check(r.error);
        createdShowId = r.data;
      } else {
        const r = await db.from("game_shows").insert({ title }).select("id").single();
        check(r.error);
        createdShowId = r.data!.id;
      }
    } else if (b.action === 'trivia_open' || b.action === 'trivia_close_reveal') {
      const showId = textInput(b.showId, 36, 36);
      const result = await db.rpc('game_trivia_list', {
        s: showId, action: b.action === 'trivia_open' ? 'open' : 'close_reveal',
      });
      check(result.error);
    } else if (b.action === 'audience_invitation') {
      const showId = textInput(b.showId, 36, 36);
      if (b.invitation !== 'clear' && !isShowInvitationKind(b.invitation))
        throw new Error('Choose a show invitation or clear it.');
      const current = await db.from('game_shows').select('id,status').eq('id', showId).maybeSingle();
      check(current.error);
      if (current.data?.status !== 'active') throw new Error('Choose the active show before sending an invitation.');
      const saved = await db.from('admin_actions').insert({ action_type: invitationActionType(showId),
        admin_user: session.userId, details: { kind: b.invitation } });
      check(saved.error);
      return NextResponse.json({ success: true });
    } else {
      textInput(b.showId, 36, 36);
      if (["create", "approve", "edit"].includes(b.action))
        b.question = textInput(b.question, 1, 300);
      if (b.action === "rename") b.name = textInput(b.name, 2, 20);
      if (b.action === "cast") {
        if (
          !Array.isArray(b.names) ||
          b.names.length < 2 ||
          b.names.length > 30
        )
          throw new Error("Enter 2–30 cast members");
        b.names = b.names.map((n: unknown) => textInput(n, 1, 60));
        if (
          new Set(b.names.map((n: string) => n.toLowerCase())).size !==
          b.names.length
        )
          throw new Error("Cast names must be unique");
      }
      if (["create", "edit"].includes(b.action) && b.kind !== "superlative") {
        if (
          !["trivia", "trl"].includes(b.kind) ||
          !Array.isArray(b.options) ||
          b.options.length < 2 ||
          b.options.length > 30
        )
          throw new Error("Enter 2–30 choices");
        b.options = b.options.map((o: any, i: number) => ({
          id: String(i),
          label: textInput(o.label, 1, 100),
        }));
        if (
          b.kind === "trivia" &&
          !b.options.some((o: any) => o.id === b.correctOption)
        )
          throw new Error("Select the correct answer");
      }
      const r = await db.rpc("game_admin", {
        s: b.showId,
        action: b.action,
        payload: b,
      });
      check(r.error);
    }
    await db
      .from("admin_actions")
      .insert({
        action_type: `game_${b.action}`,
        admin_user: session.userId,
        details: { show_id: createdShowId || b.showId, ...(b.triviaSourceShowId ? { trivia_source_show_id: b.triviaSourceShowId } : {}) },
      });
    return NextResponse.json({ success: true, ...(createdShowId ? { showId: createdShowId } : {}) });
  } catch (e) {
    return failure(e);
  }
}
