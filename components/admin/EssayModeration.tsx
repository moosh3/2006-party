"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublishedEssay } from "@/lib/essays";

type AdminEssay = PublishedEssay & { hidden: boolean };

/** Essays publish on submit. The operator can hide one (and restore it); nothing is deleted. */
export default function EssayModeration() {
  const [essays, setEssays] = useState<AdminEssay[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/essays", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load essays.");
      setEssays(data.essays);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load essays.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function setHidden(essay: AdminEssay, hidden: boolean) {
    setBusy(essay.id);
    try {
      const response = await fetch("/api/admin/essays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: essay.id, hidden }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the essay.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the essay.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="game-essays">
      <h2>Essays</h2>
      <p>
        Guests’ essays publish under their screen name as soon as they submit.
        Hide one to remove it from the audience list; Restore puts it back.
        Showing the newest 300, including earlier nights.
      </p>
      {error && <p role="alert">{error}</p>}
      {essays && essays.length === 0 && <p>No essays submitted yet.</p>}
      {essays?.map((essay) => (
        <article key={essay.id}>
          <p className="game-status">
            {essay.screenName} · {new Date(essay.createdAt).toLocaleString()} · {essay.hidden ? "hidden" : "published"}
          </p>
          <h3>{essay.prompt}</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{essay.body}</p>
          <div className="game-admin-actions">
            <button disabled={busy === essay.id} onClick={() => void setHidden(essay, !essay.hidden)}>
              {essay.hidden ? "Restore" : "Hide"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
