"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GamePrompt, GameState, leaders, type GameKind } from "@/lib/game-types";
import "./game.css";
import "./game-zine.css";

const labels = { trl: "TRL", trivia: "Trivia", superlative: "Superlatives" };
const categoryCopy = {
  trl: { title: "total request live", body: "Pick the video you want on top. The countdown is in your hands." },
  trivia: { title: "pop quiz", body: "Music, movies, and the internet you grew up on. Every correct answer gets you closer to SuperFan." },
  superlative: { title: "yearbook awards", body: "Give the 2006ers their flowers. Vote for the cast member who fits each award." },
};

function Question({
  prompt,
  disabled,
  vote,
}: {
  prompt: GamePrompt;
  disabled: boolean;
  vote: (id: string, option: string) => void;
}) {
  const total = prompt.options.reduce((n, o) => n + (o.count || 0), 0);
  const max = Math.max(0, ...prompt.options.map((o) => o.count || 0));
  const locked = prompt.kind === "trivia" && !!prompt.answer;
  return (
    <article className={`game-question game-question-${prompt.kind}`}>
      <div className="game-eyebrow">
        {labels[prompt.kind]} ·{" "}
        {prompt.status === "open" ? "Open now" : "Closed"}
      </div>
      <h3>{prompt.question}</h3>
      <div className="game-options">
        {prompt.options.map((option) => (
          <button
            type="button"
            key={option.id}
            aria-pressed={prompt.answer === option.id}
            disabled={disabled || prompt.status !== "open" || locked}
            onClick={() => vote(prompt.id, option.id)}
          >
            <span>
              {option.label}
              {prompt.answer === option.id ? " ✓ Your answer" : ""}
              {prompt.correct_option === option.id ? " · Correct answer" : ""}
            </span>
            {option.count !== undefined && (
              <span className="game-count">
                {option.count} vote{option.count === 1 ? "" : "s"}
                {prompt.kind !== "trivia" && max > 0 && option.count === max
                  ? prompt.status === "closed"
                    ? " · Winner"
                    : " · Leading"
                  : ""}
              </span>
            )}
            {option.count !== undefined && total > 0 && (
              <span
                aria-hidden="true"
                className="game-bar"
                style={{ width: `${(100 * option.count) / total}%` }}
              />
            )}
          </button>
        ))}
      </div>
      <p className="game-help">
        {prompt.status === "closed"
          ? locked ? "Your answer is saved. This round is complete." : "This round is complete."
          : locked
          ? "Answer locked. Your score updates when this question closes."
          : prompt.status !== "open"
            ? "Voting has ended."
            : prompt.kind === "trivia"
              ? "One answer. Make it count!"
              : "One vote. You can change it until the host closes voting."}
      </p>
      {prompt.options[0]?.count === undefined && (
        <p className="game-help">
          Results are hidden until the host reveals them.
        </p>
      )}
    </article>
  );
}

export type GameCueRequest = { key: string; promptId: string; kind: GameKind };

export default function GameBoard({ screenName, onOpenTrivia, autoTriviaPopup = true, cueRequest }: {
  screenName: string;
  onOpenTrivia?: () => void;
  autoTriviaPopup?: boolean;
  cueRequest?: GameCueRequest | null;
}) {
  const boardId = useId();
  const [state, setState] = useState<GameState | null>(null);
  const [tab, setTab] = useState<"trl" | "trivia" | "superlative">("trl");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [notice, setNotice] = useState("");
  const [joinName, setJoinName] = useState(screenName);
  const [popup, setPopup] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const appliedCue = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const r = await fetch("/api/game", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Unable to load the game");
    if (version === requestVersion.current) setState(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
        if (!cancelled) setConnectionError("");
      } catch {
        if (!cancelled)
          setConnectionError("Game connection interrupted. Retrying…");
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!autoTriviaPopup) {
      setPopup(null);
      return;
    }
    const active = state?.prompts.find(
      (p) => p.kind === "trivia" && p.status === "open" && !p.answer,
    );
    if (active && state?.viewer && !seen.current.has(active.id)) {
      seen.current.add(active.id);
      onOpenTrivia?.();
      setPopup(active.id);
    }
  }, [state, onOpenTrivia, autoTriviaPopup]);

  useEffect(() => {
    if (!cueRequest || appliedCue.current === cueRequest.key) return;
    const prompt = state?.prompts.find(p => p.id === cueRequest.promptId
      && p.kind === cueRequest.kind && p.status === "open");
    if (!prompt || state?.show?.status !== "active") return;
    appliedCue.current = cueRequest.key;
    // A shared cue selects the existing board, never opens a modal, steals
    // focus, changes a vote, or adds another polling/scoring component.
    setTab(prompt.kind);
  }, [cueRequest, state]);

  const popupPrompt = state?.prompts.find(
    (p) => p.id === popup && p.status === "open" && !p.answer,
  );
  useEffect(() => {
    if (popupPrompt && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (!popupPrompt) dialog.current?.close();
  }, [popupPrompt]);

  async function act(body: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Please try again");
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const vote = async (promptId: string, optionId: string) => {
    if (await act({ action: "vote", promptId, optionId })) {
      setNotice(state?.prompts.find(p => p.id === promptId)?.kind === "trivia"
        ? "Answer saved! Your score updates when the host closes the question."
        : "Vote saved! You can change it while voting is open.");
    }
  };
  if (!state?.show)
    return (
      <section className="game-board" role="status" aria-busy={!state && !connectionError}>
        <p>
          {connectionError ||
            error ||
            (state
              ? "Between the videos: trivia and cast awards will appear here when the host starts the game."
              : "Connecting to the game…")}
        </p>
      </section>
    );
  const canVote =
    !!state.viewer && !state.viewer.blocked && state.show.status === "active";
  return (
    <section className="game-board" aria-label="2006 show game">
      <header className="game-heading">
        <div className="game-heading-identity">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="game-wordmark" src="/2006/wordmark.png" alt="" width="112" height="48" />
          <div>
            <span className="game-eyebrow">after school, online</span>
            <h2>{state.show.title}</h2>
          </div>
        </div>
        {state.viewer && (
          <div className="game-score">
            <strong>{state.score}</strong>
            <span>correct · {state.viewer.name}</span>
          </div>
        )}
      </header>
      {!state.viewer && state.show.status === "active" && (
        <form
          className="game-join"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "join", name: joinName });
          }}
        >
          <label>
            Game screen name
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              minLength={2}
              maxLength={20}
              required
            />
          </label>
          <button disabled={busy}>{busy ? "Joining…" : "Join the game"}</button>
          <p className="game-help">
            No password needed. Keep this browser to keep your score.
          </p>
        </form>
      )}
      {state.viewer?.blocked && (
        <p role="status">
          Your participation is paused. Please contact the host.
        </p>
      )}
      <div role="status" className="game-notice">
        {notice}
      </div>
      {error && (
        <p role="alert" className="game-error">
          {error}
        </p>
      )}
      {connectionError && (
        <p role="status" className="game-error">
          {connectionError}
        </p>
      )}
      {state.show.status === "finished" && (
        <div className="game-finals">
          <h3>That’s a wrap!</h3>
          {state.scores ? (
            <>
              <p>
                <strong>SuperFan:</strong>{" "}
                {leaders(state.scores)
                  .map((s) => `${s.name} (${s.score})`)
                  .join(" & ") || "No correct answers tonight"}
              </p>
              <p>
                <strong>Most 2006er:</strong>{" "}
                {leaders(state.castScores || [])
                  .map((s) => `${s.name} (${s.score} wins)`)
                  .join(" & ") || "No superlative winners tonight"}
              </p>
              {!state.prompts.some(
                (p) => p.trl_final && p.status === "closed",
              ) && (
                <p>
                  <strong>TRL Winner:</strong> No final video vote was
                  designated.
                </p>
              )}
              {state.prompts
                .filter((p) => p.trl_final && p.status === "closed")
                .map((p) => {
                  const max = Math.max(
                    0,
                    ...p.options.map((o) => o.count || 0),
                  );
                  return (
                    <p key={p.id}>
                      <strong>TRL Winner:</strong>{" "}
                      {max
                        ? p.options
                            .filter((o) => o.count === max)
                            .map((o) => o.label)
                            .join(" & ")
                        : "No votes"}
                    </p>
                  );
                })}
            </>
          ) : (
            <p>The host will reveal the winners shortly.</p>
          )}
        </div>
      )}
      <div className="game-tabs" role="tablist" aria-label="Game categories">
        {(["trl", "trivia", "superlative"] as const).map((k) => (
          <button
            type="button"
            key={k}
            role="tab"
            id={`${boardId}-tab-${k}`}
            aria-controls={`${boardId}-panel`}
            aria-selected={tab === k}
            tabIndex={tab === k ? 0 : -1}
            onKeyDown={(event) => {
              const keys = ["trl", "trivia", "superlative"] as const;
              const index = keys.indexOf(k);
              const next = event.key === "ArrowRight" ? (index + 1) % 3
                : event.key === "ArrowLeft" ? (index + 2) % 3
                : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(keys[next]);
              setNotice("");
              document.getElementById(`${boardId}-tab-${keys[next]}`)?.focus();
            }}
            onClick={() => { setTab(k); setNotice(""); }}
          >
            {labels[k]}
            {state.prompts.some(p => p.kind === k && p.status === "open") && <span className="game-open-dot" aria-label=" (open now)" />}
          </button>
        ))}
      </div>
      <div id={`${boardId}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${boardId}-tab-${tab}`}>
        <div className={`game-category-intro game-category-intro-${tab}`}>
          <h3>{categoryCopy[tab].title}</h3>
          <p>{categoryCopy[tab].body}</p>
        </div>
        {!state.viewer && state.show.status === "active" && <p className="game-help">Join above to vote and keep your trivia score.</p>}
        {state.prompts.filter((p) => p.kind === tab).length === 0 && (
          <p className="game-empty">
            {tab === "trl"
              ? "The next video vote is coming up."
              : tab === "trivia"
                ? "Keep watching. The next trivia question will pop up here."
                : "Cast awards will appear here when voting opens."}
          </p>
        )}
        {state.prompts
          .filter((p) => p.kind === tab)
          .sort(
            (a, b) => Number(b.status === "open") - Number(a.status === "open")
              || Number(b.id === cueRequest?.promptId) - Number(a.id === cueRequest?.promptId),
          )
          .map((p) => (
            <Question
              key={p.id}
              prompt={p}
              disabled={busy || !canVote}
              vote={vote}
            />
          ))}
        {tab === "superlative" && state.show.suggestions_open && canVote && (
          <form
            className="game-suggest"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act({
                  action: "suggest",
                  showId: state.show!.id,
                  body: suggestion,
                })
              ) {
                setSuggestion("");
                setNotice(
                  "Sent to the host! Your suggestion stays private unless approved.",
                );
              }
            }}
          >
            <h3>Write the next yearbook award</h3>
            <label>
              Suggest a superlative
              <textarea
                minLength={3}
                maxLength={200}
                required
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                placeholder="Most likely to destroy the family computer with LimeWire…"
              />
            </label>
            <p className="game-help">
              The host reviews every suggestion. Cast members are the only
              voting choices.
            </p>
            <button disabled={busy}>{busy ? "Sending…" : "Send to the host"}</button>
          </form>
        )}
      </div>
      <dialog
        ref={dialog}
        className="game-popup"
        onCancel={() => setPopup(null)}
        aria-labelledby={`${boardId}-popup-title`}
      >
        <div className="game-popup-title">
          <strong id={`${boardId}-popup-title`}>You’ve got trivia!</strong>
          <button
            type="button"
            aria-label="Dismiss trivia popup"
            onClick={() => {
              setPopup(null);
              dialog.current?.close();
            }}
          >
            ×
          </button>
        </div>
        {popupPrompt && (
          <Question
            prompt={popupPrompt}
            disabled={busy || !canVote}
            vote={vote}
          />
        )}
        {error && (
          <p role="alert" className="game-error">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setTab("trivia");
            setPopup(null);
            dialog.current?.close();
          }}
        >
          Keep watching · answer in Trivia
        </button>
      </dialog>
    </section>
  );
}
