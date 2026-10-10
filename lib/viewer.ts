// Client-side viewer data management
import type { AudienceViewer } from './audience-access';
export interface ViewerData {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  registeredAt: number;
}

const VIEWER_STORAGE_KEY = '2006_party_viewer';
const LEGACY_VIEWER_STORAGE_KEY = 'after_party_viewer';
let memoryViewer: ViewerData | null = null;

export function generateViewerId(): string {
  return `viewer_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function saveViewerData(email: string, displayName: string, avatar: string): ViewerData {
  const viewerData: ViewerData = {
    id: generateViewerId(),
    email,
    displayName,
    avatar,
    registeredAt: Date.now(),
  };

  if (typeof window !== 'undefined') {
    memoryViewer = viewerData;
    try { localStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(viewerData)); } catch { /* Cookie-backed sign-on still works. */ }
  }

  return viewerData;
}

export function getViewerData(): ViewerData | null {
  if (typeof window === 'undefined') return null;
  
  try {
    if (memoryViewer) return memoryViewer;
    const stored = localStorage.getItem(VIEWER_STORAGE_KEY) || localStorage.getItem(LEGACY_VIEWER_STORAGE_KEY);
    if (!stored) return null;
    const v = JSON.parse(stored);
    return v && typeof v.id === 'string' && typeof v.displayName === 'string'
      && v.displayName.length >= 2 && v.displayName.length <= 20 && typeof v.avatar === 'string'
      ? v as ViewerData : null;
  } catch {
    return null;
  }
}

/** The cookie-backed game identity is canonical for the Mac login and AIM. */
export function adoptAudienceViewer(viewer: AudienceViewer): ViewerData {
  const previous = getViewerData();
  const next: ViewerData = {
    id: viewer.id, displayName: viewer.name, avatar: 'aim',
    email: `${viewer.name.toLowerCase().replace(/[^a-z0-9]+/g, '.') || 'viewer'}@2006.local`,
    registeredAt: previous?.registeredAt || Date.now(),
  };
  if (typeof window !== 'undefined') {
    try {
      // Migrate only this person's private essay, without overwriting a newer draft.
      if (previous && previous.id !== next.id && previous.displayName === next.displayName) {
        const oldDraft = localStorage.getItem(`2006_essay_${previous.id}`);
        if (oldDraft && !localStorage.getItem(`2006_essay_${next.id}`)) localStorage.setItem(`2006_essay_${next.id}`, oldDraft);
      }
      localStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(next));
    } catch { /* Private/blocked storage must not prevent signing on. */ }
    memoryViewer = next;
  }
  return next;
}

export function clearViewerData(): void {
  if (typeof window !== 'undefined') {
    memoryViewer = null;
    try {
      localStorage.removeItem(VIEWER_STORAGE_KEY);
      localStorage.removeItem(LEGACY_VIEWER_STORAGE_KEY);
    } catch { /* Event entry rechecks the canonical server identity. */ }
  }
}

export function isViewerRegistered(): boolean {
  return getViewerData() !== null;
}
