import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as db } from "@/lib/supabase-admin";
import {
  check,
  failure,
  GAME_COOKIE,
  gameViewer,
  hash,
  moderatedText,
  newToken,
  sameOrigin,
  snapshot,
  textInput,
  throttle,
} from "@/lib/game-server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await snapshot(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e, 503);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const body = await req.json();
    let viewer = await gameViewer();
    if (body.action === "join") {
      if (viewer) return NextResponse.json({ viewer });
      const name = moderatedText(body.name, 2, 20);
      // Only the deployment proxy's address is used, never a client ID.
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
      await throttle(`join:${hash(ip)}`, 5);
      const token = newToken();
      const r = await db
        .from("game_viewers")
        .insert({ token_hash: hash(token), name })
        .select("id,name,blocked")
        .single();
      check(r.error);
      viewer = r.data;
      const response = NextResponse.json({ viewer });
      response.cookies.set(GAME_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
      return response;
    }
    if (!viewer || viewer.blocked)
      return NextResponse.json(
        {
          error:
            "Sign on to participate, or contact the host if participation is unavailable.",
        },
        { status: 403 },
      );
    if (body.action === "vote") {
      const r = await db.rpc("game_vote", {
        p: textInput(body.promptId, 36, 36),
        v: viewer.id,
        o: textInput(body.optionId, 1, 60),
      });
      check(r.error);
    } else if (body.action === "suggest") {
      const r = await db.rpc("game_suggest", {
        s: textInput(body.showId, 36, 36),
        v: viewer.id,
        body_text: moderatedText(body.body, 3, 200),
      });
      check(r.error);
    } else throw new Error("Unknown action");
    return NextResponse.json({ success: true });
  } catch (e) {
    return failure(e);
  }
}
