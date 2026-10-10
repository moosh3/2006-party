"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GameKind, GameState, leaders } from "@/lib/game-types";
import "@/components/game/game.css";

type AdminState = GameState & {
  shows: { id: string; title: string; status: string }[];
};
const initialCast =
  "mkashe9\nSBconfetti\nx0x_BlueShellVictim_x0x\nneodafunky\nEmmaIsNine\nbbulldogs48";

export default function GameAdmin() {
  const router = useRouter();
  const [data, setData] = useState<AdminState | null>(null);
  const [showId, setShowId] = useState("");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("2006 — tonight’s show");
  const [cast, setCast] = useState(initialCast);
  const [kind, setKind] = useState<GameKind>("trivia");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState("");
  const [correct, setCorrect] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [viewerId, setViewerId] = useState("");
  const [safeName, setSafeName] = useState("");
  const rosterShow = useRef<string>();
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const r = await fetch(`/api/admin/game${showId ? `?show=${showId}` : ""}`, {
      cache: "no-store",
    });
    if (r.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const next = await r.json();
    if (!r.ok) throw new Error(next.error || "Unable to load show");
    if (version === refreshVersion.current) setData(next);
  }, [showId, router]);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        await refresh();
        if (!stop) setConnectionError("");
      } catch (e) {
        if (!stop)
          setConnectionError("Connection interrupted. Retrying automatically; displayed totals may be out of date.");
      }
      if (!stop) timer = setTimeout(tick, 5000);
    }
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (data?.show?.id !== rosterShow.current) {
      rosterShow.current = data?.show?.id;
      setEditingId(null);
      setQuestion("");
      setChoices("");
      setCorrect("0");
      setCast(
        data?.cast?.length
          ? data.cast.map((c) => c.name).join("\n")
          : initialCast,
      );
    }
  }, [data?.show?.id, data?.cast]);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId: data?.show?.id, ...payload }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Action failed");
      if (payload.action === "new_show") setShowId("");
      await refresh();
      setNotice("Saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const show = data?.show;
  const active = show?.status === "active";
  const options = choices
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="game-admin">
      <main>
        <a href="/admin">← Stream controls</a>
        <nav className="game-admin-nav" aria-label="Game desk shortcuts">
          <a href="/game" target="_blank" rel="noreferrer">Audience board ↗</a>
          <a href="#game-editor">Prepare a round</a>
          <a href="#game-rounds">Rounds</a>
          <a href="#game-inbox">Suggestion inbox</a>
          <a href="#game-moderation">Moderation</a>
        </nav>
        <h1>2006 · Show game desk</h1>
        <p>
          Prepare drafts, open each round on cue, and reveal results when you’re
          ready.
        </p>
        {error && (
          <p className="game-error" role="alert">
            {error}
          </p>
        )}
        <p role="status">{notice}</p>
        {connectionError && <p role="status" className="game-error">{connectionError}</p>}
        {!data && <p role="status" className="game-empty">Loading the show desk…</p>}
        {data && (
          <label>
            Show
            <select
              value={show?.id || ""}
              disabled={busy}
              onChange={(e) => setShowId(e.target.value)}
            >
              <option value="">Latest show</option>
              {data.shows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.status}
                </option>
              ))}
            </select>
          </label>
        )}
        {data && !data.shows.some((s) => s.status === "active") && (
          <section>
            <h2>Start a new night</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await act({ action: "new_show", title });
              }}
            >
              <label>
                Show name
                <input
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <button disabled={busy}>Create show</button>
            </form>
            <p>
              Every show gets fresh scores and polls. Past shows stay available
              above.
            </p>
          </section>
        )}
        {show && (
          <>
            <section>
              <h2>{show.title}</h2>
              <p className="game-status">
                {show.status} · final results{" "}
                {show.results_visible ? "visible" : "hidden"} · suggestions{" "}
                {show.suggestions_open ? "open" : "closed"}
              </p>
              <div className="game-admin-actions">
                {active && (
                  <button
                    disabled={busy}
                    onClick={() => void act({ action: "suggestions" })}
                  >
                    {show.suggestions_open ? "Pause" : "Enable"} suggestions
                  </button>
                )}
                {active && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "End this show? All open rounds will close and no more answers will be accepted.",
                        )
                      )
                        void act({ action: "finish" });
                    }}
                  >
                    End show and calculate winners
                  </button>
                )}
                {!active && (
                  <button
                    disabled={busy}
                    onClick={() => void act({ action: "reveal_show" })}
                  >
                    {show.results_visible ? "Hide" : "Reveal"} final results
                  </button>
                )}
              </div>
            </section>
            {active && (
              <div className="game-admin-grid">
                <section>
                  <h2>Cast roster</h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await act({
                        action: "cast",
                        names: cast
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                  >
                    <label>
                      One cast member per line
                      <textarea
                        required
                        value={cast}
                        onChange={(e) => setCast(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={
                        busy ||
                        data!.prompts.some((p) => p.kind === "superlative")
                      }
                    >
                      Save cast
                    </button>
                  </form>
                  <p>
                    The suggested roster uses the site’s AIM names. Save or edit
                    it before creating superlatives; it locks afterward.
                  </p>
                </section>
                <section id="game-editor">
                  <h2>{editingId ? "Edit draft" : "Create a round"}</h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await act({
                          action: editingId ? "edit" : "create",
                          id: editingId,
                          kind,
                          question,
                          options: options.map((label, i) => ({
                            id: String(i),
                            label,
                          })),
                          correctOption: correct,
                        })
                      ) {
                        setEditingId(null);
                        setQuestion("");
                        setChoices("");
                        setCorrect("0");
                      }
                    }}
                  >
                    <label>
                      Round type
                      <select
                        disabled={!!editingId}
                        value={kind}
                        onChange={(e) => setKind(e.target.value as GameKind)}
                      >
                        <option value="trl">TRL video vote</option>
                        <option value="trivia">Trivia question</option>
                        <option value="superlative">Cast superlative</option>
                      </select>
                    </label>
                    <label>
                      Question
                      <input
                        required
                        maxLength={300}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                      />
                    </label>
                    {kind !== "superlative" && (
                      <label>
                        Choices — one per line
                        <textarea
                          required
                          value={choices}
                          onChange={(e) => { setChoices(e.target.value); setCorrect("0"); }}
                        />
                      </label>
                    )}
                    {kind === "trivia" && (
                      <label>
                        Correct answer
                        <select
                          value={correct}
                          onChange={(e) => setCorrect(e.target.value)}
                        >
                          {options.map((o, i) => (
                            <option key={i} value={String(i)}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button disabled={busy || (kind !== "superlative" && options.length < 2) || (kind === "superlative" && !data?.cast?.length)}>{busy ? "Saving…" : "Save private draft"}</button>
                    <p className="game-help">{kind === "superlative" ? "Uses the saved cast roster. Save your cast first." : "Add at least two choices. For trivia, choose the correct answer after editing your choices."} Drafts stay private until you open them.</p>
                    {editingId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setQuestion("");
                          setChoices("");
                          setCorrect("0");
                        }}
                      >
                        Cancel editing
                      </button>
                    )}
                  </form>
                </section>
              </div>
            )}
            <section id="game-rounds">
              <h2>Rounds</h2>
              {data!.prompts.length === 0 && (
                <p>No rounds yet. Prepare trivia and video choices above.</p>
              )}
              {data!.prompts.map((p) => (
                <article key={p.id}>
                  <p className="game-status">
                    {p.kind} · {p.status} · results{" "}
                    {p.results_visible ? "visible" : "hidden"}
                  </p>
                  <h3>{p.question}</h3>
                  <ul>
                    {p.options.map((o) => (
                      <li key={o.id}>
                        {o.label} — {o.count || 0} votes{" "}
                        {p.correct_option === o.id ? "✓ correct answer" : ""}
                      </li>
                    ))}
                  </ul>
                  {active && (
                    <div className="game-admin-actions">
                      {p.kind === "trl" && (
                        <button
                          disabled={busy || p.trl_final}
                          onClick={() =>
                            void act({ action: "trl_final", id: p.id })
                          }
                        >
                          {p.trl_final
                            ? "Final TRL round"
                            : "Use for TRL Winner"}
                        </button>
                      )}
                      {p.status === "draft" && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act({ action: "open", id: p.id })
                            }
                          >
                            Open{" "}
                            {p.kind === "trivia"
                              ? "and trigger popup"
                              : "voting"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setEditingId(p.id);
                              setKind(p.kind);
                              setQuestion(p.question);
                              setChoices(
                                p.options.map((o) => o.label).join("\n"),
                              );
                              setCorrect(p.correct_option || "0");
                              document
                                .getElementById("game-editor")
                                ?.scrollIntoView();
                            }}
                          >
                            Edit draft
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm("Discard this private draft?"))
                                void act({ action: "discard", id: p.id });
                            }}
                          >
                            Discard draft
                          </button>
                        </>
                      )}
                      {p.status === "open" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act({ action: "close", id: p.id })
                          }
                        >
                          Close voting
                        </button>
                      )}
                      {p.status !== "draft" &&
                        (p.kind !== "trivia" || p.status === "closed") && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act({ action: "reveal", id: p.id })
                            }
                          >
                            {p.results_visible ? "Hide" : "Reveal"} results
                          </button>
                        )}
                    </div>
                  )}
                </article>
              ))}
            </section>
            <section id="game-inbox">
              <h2>Private suggestion inbox</h2>
              <p>
                Only approval creates a superlative draft. Opening that draft
                makes it public. Showing the oldest 200 pending suggestions.
              </p>
              {!data!.suggestions?.length && <p>No pending suggestions.</p>}
              {data!.suggestions?.map((s) => (
                <article key={s.id}>
                  <p>From {s.name}</p>
                  <label>
                    Edit before approval
                    <input
                      value={edits[s.id] ?? s.body}
                      maxLength={200}
                      onChange={(e) =>
                        setEdits({ ...edits, [s.id]: e.target.value })
                      }
                    />
                  </label>
                  <div className="game-admin-actions">
                    <button
                      disabled={busy || !active}
                      onClick={() =>
                        void act({
                          action: "approve",
                          id: s.id,
                          question: edits[s.id] ?? s.body,
                        })
                      }
                    >
                      Approve as draft
                    </button>
                    <button
                      disabled={busy || !active}
                      onClick={() => void act({ action: "reject", id: s.id })}
                    >
                      Reject
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Block ${s.name} and exclude their votes?`,
                          )
                        )
                          void act({ action: "block", viewerId: s.viewer_id });
                      }}
                    >
                      Block viewer
                    </button>
                  </div>
                </article>
              ))}
            </section>
            <div className="game-admin-grid">
              <section>
                <h2>SuperFan</h2>
                <p>
                  1 point per correct answer. Scores update on closing a trivia
                  round. Ties share the title.
                </p>
                <p>
                  Leader:{" "}
                  {leaders(data!.scores || [])
                    .map((s) => s.name)
                    .join(" & ") || "No correct answers yet"}
                </p>
                <ol>
                  {data!.scores?.map((s) => (
                    <li key={s.id}>
                      {s.name} — {s.score} correct{" "}
                      <button onClick={() => { setViewerId(s.id); setSafeName(s.name); document.getElementById("game-moderation")?.scrollIntoView(); }}>
                        Moderate
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h2>Most 2006er</h2>
                <p>
                  One point per closed superlative won. Tied category winners
                  each receive one point. Empty polls award none.
                </p>
                <ol>
                  {data!.castScores?.map((s) => (
                    <li key={s.id}>
                      {s.name} — {s.score} wins
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <section id="game-moderation">
              <h2>Viewer moderation</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await act({ action: "rename", viewerId, name: safeName });
                }}
              >
                <label>
                  Viewer ID
                  <input
                    required
                    value={viewerId}
                    onChange={(e) => setViewerId(e.target.value)}
                  />
                </label>
                <label>
                  Replacement display name
                  <input
                    required
                    minLength={2}
                    maxLength={20}
                    value={safeName}
                    onChange={(e) => setSafeName(e.target.value)}
                  />
                </label>
                <div className="game-admin-actions">
                  <button disabled={busy}>Rename viewer</button>
                  <button
                    className="danger"
                    type="button"
                    disabled={busy || !viewerId}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Block this viewer and exclude all of their game votes?",
                        )
                      )
                        void act({ action: "block", viewerId });
                    }}
                  >
                    Block viewer
                  </button>
                  <button
                    type="button"
                    disabled={busy || !viewerId}
                    onClick={() => void act({ action: "unblock", viewerId })}
                  >
                    Restore viewer
                  </button>
                </div>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
