import { NextRequest, NextResponse } from "next/server";
import {
  AudienceSignOnError,
  audienceViewer,
  signOnAudience,
} from "@/lib/audience-sign-on";
import { GAME_COOKIE, sameOrigin } from "@/lib/game-server";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  if (error instanceof AudienceSignOnError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: privateHeaders },
    );
  }
  // Do not expose database errors, session hashes, or request contents.
  console.error("Audience sign-on is temporarily unavailable");
  return NextResponse.json(
    { error: "Sign-on is temporarily unavailable. Please try again." },
    { status: 503, headers: privateHeaders },
  );
}

export async function GET() {
  try {
    return NextResponse.json(
      { viewer: await audienceViewer() },
      { headers: privateHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    try {
      sameOrigin(req);
    } catch {
      throw new AudienceSignOnError("Invalid request origin", 403);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AudienceSignOnError("Enter an AIM screen name.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AudienceSignOnError("Enter an AIM screen name.", 400);
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const result = await signOnAudience(
      (body as { name?: unknown }).name,
      ip,
    );
    const response = NextResponse.json(
      { viewer: result.viewer },
      { headers: privateHeaders },
    );
    if (result.token) {
      response.cookies.set(GAME_COOKIE, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
    }
    return response;
  } catch (error) {
    return failure(error);
  }
}
