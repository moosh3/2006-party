export type GameKind = "trl" | "trivia" | "superlative";
export type GameOption = { id: string; label: string; count?: number };
export type GamePrompt = {
  id: string;
  show_id: string;
  kind: GameKind;
  question: string;
  options: GameOption[];
  status: "draft" | "open" | "closed";
  results_visible: boolean;
  correct_option?: string;
  answer?: string;
  trl_final?: boolean;
};
export type GameScore = { id: string; name: string; score: number };
export type GameState = {
  show: {
    id: string;
    title: string;
    status: "active" | "finished";
    results_visible: boolean;
    suggestions_open: boolean;
  } | null;
  viewer?: { id: string; name: string; blocked: boolean } | null;
  prompts: GamePrompt[];
  score: number;
  scores?: GameScore[];
  castScores?: GameScore[];
  cast?: { id: string; name: string }[];
  suggestions?: {
    id: string;
    body: string;
    viewer_id: string;
    status: string;
    name: string;
  }[];
};

// A tied category awards one point to each joint winner. Empty categories
// award nothing. Only closed categories count toward Most 2006er.
export function castScores(
  prompts: GamePrompt[],
  cast: { id: string; name: string }[],
): GameScore[] {
  const scores = cast.map((c) => ({ ...c, score: 0 }));
  for (const p of prompts.filter(
    (p) => p.kind === "superlative" && p.status === "closed",
  )) {
    const max = Math.max(0, ...p.options.map((o) => o.count || 0));
    if (!max) continue;
    for (const c of scores)
      if (p.options.some((o) => o.id === c.id && o.count === max)) c.score++;
  }
  return scores.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}

export function leaders(scores: GameScore[]) {
  const max = Math.max(0, ...scores.map((s) => s.score));
  return max ? scores.filter((s) => s.score === max) : [];
}
