"use client";
import { useRouter } from "next/navigation";
import GameBoard from "@/components/game/GameBoard";
import MacAudienceGate from "@/components/2006/MacAudienceGate";
import { useAudienceIdentity } from "@/hooks/useAudienceIdentity";
import { useAudienceDoors } from "@/hooks/useAudienceDoors";

export default function GamePage() {
  const router = useRouter();
  const { viewer, error: identityError, retry } = useAudienceIdentity();
  const { doors, error: doorsError, refresh } = useAudienceDoors(Boolean(viewer));
  const backToLogin = () => router.replace('/login');
  if (!viewer || !doors) return <MacAudienceGate mode="connecting" connectionError={identityError || doorsError}
    onRetry={viewer ? () => void refresh() : retry} onSignOff={backToLogin} />;
  if (!doors.doorsOpen) return <MacAudienceGate mode="waiting" screenName={viewer.displayName} connectionError={doorsError}
    onRetry={() => void refresh()} onSignOff={backToLogin} />;
  return (
    <main className="game-standalone">
      <a href="/event" onClick={() => { try { sessionStorage.setItem("2006_party_initial_screen", "show"); } catch { /* Show is the default. */ } }}>← Back to the show</a>
      <GameBoard screenName={viewer.displayName} />
    </main>
  );
}
