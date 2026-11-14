'use client';
import SceneFrame from '@/components/SceneFrame';

/** Local demo of the audience Rules of the Game scene, as it opens during the cue. */
export default function RulesPreviewPage() {
  return <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
    <SceneFrame sceneId="rules-of-the-game" interactive playbackSessionId="preview" playbackState="playing"
      playbackPositionSeconds={0} snapshotReceivedAt={0} musicMode="off" actions={{ openBuddy: () => {}, open: () => {} }} />
  </main>;
}
