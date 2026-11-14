'use client';
import { useEffect, useRef, useState } from 'react';
import { SceneMusicPlayer, type SceneMusicStatus, type SceneMusicTrack } from '@/lib/scene-music';
import './scene-music.css';

export type SceneMusicMode = 'auto' | 'manual' | 'off';

/** Mounted once per cue, outside the rotating profile/result cards. */
export default function SceneMusic({ track, position, playing, mode }: { track: SceneMusicTrack; position: number; playing: boolean; mode: Exclude<SceneMusicMode, 'off'> }) {
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<SceneMusicPlayer | null>(null);
  const [enabled, setEnabled] = useState(mode === 'auto');
  const [volume, setVolume] = useState<number>(track.volume);
  const [status, setStatus] = useState<SceneMusicStatus>(mode === 'auto' ? 'paused' : 'muted');
  useEffect(() => {
    if (!audio.current) return;
    const controller = new SceneMusicPlayer(audio.current, setStatus);
    player.current = controller;
    return () => { controller.destroy(); player.current = null; };
  }, []);
  useEffect(() => { player.current?.update({ position, playing, enabled, volume }); }, [position, playing, enabled, volume]);
  const retry = status === 'blocked' || status === 'error';
  function toggle() {
    const next = retry || !enabled;
    setEnabled(next);
    player.current?.update({ position, playing, enabled: next, volume }, true);
  }
  return <>
    <audio ref={audio} src={track.src} loop preload="metadata" aria-hidden="true"
      onLoadedMetadata={() => player.current?.update({ position, playing, enabled, volume })}
      onCanPlay={() => player.current?.update({ position, playing, enabled, volume })}
      onError={() => player.current?.fail()} />
    <div className="scene-music-controls" data-status={status} aria-label={`${track.title} background music`}>
      <button type="button" onClick={toggle}>{status === 'error' ? 'Retry music' : retry || !enabled ? 'Play music' : 'Mute music'}</button>
      {enabled && !retry && <input type="range" min="0" max="100" step="1" aria-label="Background music volume" value={Math.round(volume * 100)} onChange={event => setVolume(Number(event.target.value) / 100)} />}
      {retry && <span role="status">{status === 'blocked' ? 'Tap to enable sound' : 'Music unavailable'}</span>}
    </div>
  </>;
}
