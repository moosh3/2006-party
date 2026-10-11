'use client';
import { useSyncExternalStore } from 'react';
import { aimSoundsEnabled, setAimSoundsEnabled, subscribeAimSounds } from '@/lib/aim-sounds';

export default function AimSoundToggle({ className = 'aim-xp-button' }: { className?: string }) {
  const enabled = useSyncExternalStore(subscribeAimSounds, aimSoundsEnabled, () => true);
  return <button type="button" className={className} style={{ minHeight: 44, whiteSpace: 'nowrap' }} aria-pressed={enabled} aria-label={`AIM sounds ${enabled ? 'on' : 'off'}`} onClick={() => setAimSoundsEnabled(!enabled)}>
    Sounds: {enabled ? 'On' : 'Off'}
  </button>;
}
