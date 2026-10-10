// Server only: the opaque session token must never be returned as viewer data.
import { supabaseAdmin as db } from "./supabase-admin";
import {
  check,
  gameViewer,
  hash,
  moderatedText,
  newToken,
  throttle,
} from "./game-server";

export type AudienceSignOnViewer = {
  id: string;
  name: string;
  blocked: boolean;
};

export class AudienceSignOnError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AudienceSignOnError";
  }
}

function publicViewer(viewer: AudienceSignOnViewer): AudienceSignOnViewer {
  // Explicit allowlist, even if the backing query gains private fields later.
  return { id: viewer.id, name: viewer.name, blocked: viewer.blocked };
}

export async function audienceViewer(): Promise<AudienceSignOnViewer | null> {
  const viewer = await gameViewer();
  return viewer ? publicViewer(viewer) : null;
}

export async function signOnAudience(
  requestedName: unknown,
  ip: string,
): Promise<{ viewer: AudienceSignOnViewer; token?: string }> {
  // Check the cookie before creating anything. A returning viewer keeps their
  // canonical name, scores, votes, and moderation state, even if a different
  // screen name was submitted. A failed lookup must not create a new identity.
  const existing = await audienceViewer();
  if (existing?.blocked) {
    throw new AudienceSignOnError(
      "Participation is unavailable. Please contact the host.",
      403,
    );
  }
  if (existing) return { viewer: existing };

  let name: string;
  try {
    name = moderatedText(requestedName, 2, 20);
  } catch (error) {
    throw new AudienceSignOnError(
      error instanceof Error ? error.message : "Enter an AIM screen name.",
      400,
    );
  }

  // Share the existing game join throttle, so changing endpoints cannot bypass
  // it. The address comes from the deployment proxy, not a submitted viewer ID.
  try {
    await throttle(`join:${hash(ip)}`, 5);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Please wait before trying again"
    ) {
      throw new AudienceSignOnError(error.message, 429);
    }
    throw error;
  }

  // Sign-on deliberately does not depend on the show or its door state. The
  // viewer can choose their name and wait before the host opens the desktop.
  const token = newToken();
  const result = await db
    .from("game_viewers")
    .insert({ token_hash: hash(token), name })
    .select("id,name,blocked")
    .single();
  check(result.error);
  if (
    !result.data ||
    typeof result.data.id !== "string" ||
    typeof result.data.name !== "string" ||
    typeof result.data.blocked !== "boolean"
  ) {
    throw new Error("Sign-on identity was not returned");
  }
  return { viewer: publicViewer(result.data), token };
}
