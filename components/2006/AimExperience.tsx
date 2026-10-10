'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chat from '@/components/Chat';
import ErrorBoundary from '@/components/ErrorBoundary';
import PollsTab from '@/components/PollsTab';
import GameBoard, { type GameCueRequest } from '@/components/game/GameBoard';
import VideoPlayer from '@/components/VideoPlayer';
import type { ProgramStream } from '@/lib/program-stream';
import VideoPlaylistShelf from '@/components/VideoPlaylistShelf';
import { ClippyAssistant, ESSAY_PROMPTS, MailApp, TextEditApp, type ClippyMode } from '@/components/2006/MacInteractiveShowcase';
import { ROOM_NAMES } from '@/lib/constants';
import { clearViewerData } from '@/lib/viewer';
import { getSmarterChildReply, type SmarterChildState } from '@/lib/smarter-child';
import ShowBuddyStrip, { type ShowBuddy } from '@/components/2006/ShowBuddyStrip';
import { useCastRun, type CastRunOrigin } from '@/hooks/useCastRun';
import type { CastRunId } from '@/lib/cast-runs';
import AudienceCueBar from '@/components/2006/AudienceCueBar';
import { useAudienceCues } from '@/hooks/useAudienceCues';
import { SHOW_AUDIENCE_CUES } from '@/lib/audience-cue-config';
import { getDeliveryKey } from '@/lib/audience-cue-delivery';
import type { AudienceCue } from '@/lib/audience-cues';
import './experience.css';
import './mobile-show.css';
import './show-personality.css';

export type ExperienceStreamData = ProgramStream;

type Viewer = {
  id: string;
  displayName: string;
};

type ExperienceScreen = 'home' | 'buddies' | 'videos' | 'playlists' | 'graveyard' | 'show';
type ModalState = { type: 'im' | 'info'; buddyIndex: number } | null;

type Buddy = {
  screenName: string;
  status: 'online' | 'away' | 'idle';
  idleMinutes?: number;
  role: string;
  awayMessage?: string;
  profile: string;
  about?: string;
  bot?: boolean;
  background: string;
  foreground: string;
  font: string;
};

const BUDDIES: Buddy[] = [
  {
    screenName: 'mkashe9', status: 'away', idleMinutes: 23,
    role: 'Writer/Performer/Editor/Tech', background: '#3e7391', foreground: '#fff2f5', font: 'Tahoma, sans-serif',
    awayMessage: 'not here, prolly back later', profile: 'friends. music. swim.\n\norlando bloom <3',
    about: "it's like if trl would be like if it were handed over to a bunch of experimental art kids in a basement.",
  },
  {
    screenName: 'SBconfetti', status: 'away', role: 'Writer/Performer/Editor',
    background: '#ff00ff', foreground: '#182600', font: 'Comic Sans MS, cursive',
    awayMessage: "~~ Brb probably doin’ hw or sumthin ~~\n\nlying on the floor. playing my guitar. trying to find the cords for just the way you are.\n\n~~~ peace and love peace and love that’s all i’m thinking of baby peace and love.",
    profile: '',
    about: 'Do you want to watch Teen Girl Squad videos on my iPod video on the bus ride home?',
  },
  {
    screenName: 'x0x_BlueShellVictim_x0x', status: 'away', idleMinutes: 69,
    role: 'Writer/Performer/Editor', background: '#000', foreground: '#5ce9f5', font: 'Tahoma, sans-serif',
    awayMessage: 'What would you do if your son was at home?',
    profile: 'Yo listen up here’s a story about a little guy that lives in a blue world....\n\n“Chocolate rain, makes the best of friends begin to fight” -Tay Zonday\n\n@(o.0)@',
    about: 'It’s a chillax scene where some sketch bustas try to win the internet.',
  },
  {
    screenName: 'neodafunky', status: 'idle', role: 'Writer/Performer/Editor',
    background: '#e8912e', foreground: '#291609', font: 'Arial Narrow, sans-serif',
    awayMessage: 'yo. im not here. you can pretend i am if youre weird', profile: '',
  },
  {
    screenName: 'EmmaIsNine', status: 'away', role: 'Writer/Performer',
    background: '#000', foreground: '#fff', font: 'Comic Sans MS, cursive',
    awayMessage: '[away message coming soon]', profile: '',
  },
  {
    screenName: 'bbulldogs48', status: 'away', idleMinutes: 13, role: 'Tech',
    background: '#000', foreground: '#fff', font: 'Comic Sans MS, cursive',
    awayMessage: '', profile: '',
  },
  {
    screenName: 'SmarterChild', status: 'online', role: 'resident robot', bot: true,
    background: '#dfe8f5', foreground: '#10233f', font: 'Tahoma, sans-serif',
    profile: 'Hi! I’m SmarterChild, your friendly robot pal!\nI know movie times, the weather, and everything about “2006” (the play, not the year... ok, also the year).\nType to me! I love that.',
    about: 'OK, now this is getting personal.',
  },
];

const CAST_ART: CastRunId[] = ['mk', 'jen', 'lip', 'yongwoo', 'emma', 'alec'];
const CAST_NAMES = ['MK', 'Jen', 'Lip', 'Yongwoo', 'Emma', 'Alec'];
const SHOW_BUDDIES: ShowBuddy[] = CAST_ART.map((art, index) => ({ art, name: CAST_NAMES[index], screenName: BUDDIES[index].screenName, index }));

function ShowLinks() {
  return (
    <nav className="show2006-links" aria-label="More from the show">
      <a href="https://www.artisticaccessibility.com/2006/show" target="_blank" rel="noopener noreferrer">Show info ↗</a>
      <a href="https://www.artisticaccessibility.com/2006/vibes" target="_blank" rel="noopener noreferrer">Confessions &amp; vibes ↗</a>
    </nav>
  );
}

const MENU: { id: ExperienceScreen; label: string }[] = [
  { id: 'show', label: 'The Show' },
  { id: 'buddies', label: '2006ers' },
  { id: 'videos', label: 'Videos' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'graveyard', label: 'Graveyard' },
];

const PLAYLISTS = [
  {
    id: 'starter', title: 'the 2006 starter pack', byline: 'a mix by the 2006ers',
    description: 'if you only hear eight songs from that year, hear these.',
    tracks: [
      ['Welcome to the Black Parade', 'My Chemical Romance', 'october. the whole year turns.'],
      ['SexyBack', 'Justin Timberlake', ''],
      ['Crazy', 'Gnarls Barkley', ''],
      ["Hips Don't Lie", 'Shakira', 'inescapable. genuinely inescapable.'],
      ['Steady, As She Goes', 'The Raconteurs', ''],
      ['Over My Head (Cable Car)', 'The Fray', 'for crying in the car.'],
      ['Dani California', 'Red Hot Chili Peppers', ''],
      ['Chasing Cars', 'Snow Patrol', 'track 8 is always the sad one.'],
    ],
  },
  {
    id: 'yours', title: '[your mix here]', byline: 'add yours in the portal',
    description: 'every creator gets to make one. name it, add songs, say why.', tracks: [] as string[][],
  },
];

const GRAVES = [
  ['MySpace Top 8', '2003 – 2009', 'u were always #1'],
  ['Burned CDs', 'sharpie titles', '“summer mix vol. 4”'],
  ['Sidekick Flip', 'click. clack.', 'we heard u in class'],
  ['TRL', '1998 – 2008', 'total. request. live.'],
];

const VIDEO_GROUPS = [
  ['emo hours', "[paste a link and I'll wire it up]", '[another one]'],
  ['the countdown stuff', '[whatever was on TRL that week]'],
  ['weird internet', '[the ones that only make sense if you were there]'],
];

const TOOLBAR: { id: ExperienceScreen; icon: string; label: string }[] = [
  { id: 'home', icon: '🎧', label: 'iPod' },
  { id: 'buddies', icon: '👥', label: '2006ers' },
  { id: 'videos', icon: '🎬', label: 'Videos' },
  { id: 'playlists', icon: '🎵', label: 'Playlists' },
  { id: 'show', icon: '📺', label: 'The Show' },
];

function TransitionClock({ nextTransitionAt }: { nextTransitionAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (!nextTransitionAt) return <span>Manual cue</span>;
  const seconds = Math.max(0, Math.floor((new Date(nextTransitionAt).getTime() - now) / 1000));
  return <span>Next in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}

type MacWindowName = 'safari' | 'aim' | 'mail' | 'textedit';
type MacWindowSize = { width: number; height: number };

const MAC_WINDOW_MIN_SIZE: Record<MacWindowName, MacWindowSize> = {
  safari: { width: 520, height: 360 },
  aim: { width: 300, height: 420 },
  mail: { width: 520, height: 400 },
  textedit: { width: 480, height: 390 },
};

function MacMenuClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  if (!now) return <span aria-hidden="true">&nbsp;</span>;

  return (
    <time dateTime={now.toISOString()}>
      {new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(now)}
    </time>
  );
}

function MacMenuBar({ activeWindow, navigate, expanded, onToggleLayout }: { activeWindow: MacWindowName; navigate: (screen: ExperienceScreen) => void; expanded: boolean; onToggleLayout: () => void }) {
  const appName: Record<MacWindowName, string> = { safari: 'Safari', aim: 'AIM', mail: 'Mail', textedit: 'TextEdit' };

  return (
    <nav className="mac2006-menubar" aria-label="Mac menu bar">
      <button type="button" className="mac2006-apple-menu" aria-label="Return to iPod" onClick={() => navigate('home')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/2006/mac-apple.svg" alt="" />
      </button>
      <strong>{appName[activeWindow]}</strong>
      <span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span>
      <button type="button" className="mac2006-layout-toggle" onClick={onToggleLayout} title="Rearrange the show and chat windows">
        {expanded ? 'Floating windows' : 'Expand windows'}
      </button>
      <span className="mac2006-menubar-time"><MacMenuClock /></span>
    </nav>
  );
}

function useMacWindowDrag(onFocus: () => void, layout: string) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  useEffect(() => { setPosition({ x: 0, y: 0 }); }, [layout]);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const baseLeft = bounds.left - position.x;
    const baseTop = bounds.top - position.y;
    onFocus();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      minX: 8 - baseLeft,
      maxX: window.innerWidth - bounds.width - 8 - baseLeft,
      minY: 26 - baseTop,
      maxY: window.innerHeight - 40 - baseTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));
    setPosition({
      x: clamp(drag.current.originX + event.clientX - drag.current.startX, drag.current.minX, drag.current.maxX),
      y: clamp(drag.current.originY + event.clientY - drag.current.startY, drag.current.minY, drag.current.maxY),
    });
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return { position, onPointerDown, onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag };
}

function useMacWindowResize(onFocus: () => void, minimum: MacWindowSize, layout: string) {
  const [size, setSize] = useState<MacWindowSize | null>(null);
  useEffect(() => { setSize(null); }, [layout]);
  const resize = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);

  const clampSize = (width: number, height: number, bounds: DOMRect) => ({
    width: Math.round(Math.min(Math.max(width, minimum.width), Math.max(minimum.width, window.innerWidth - bounds.left - 8))),
    height: Math.round(Math.min(Math.max(height, minimum.height), Math.max(minimum.height, window.innerHeight - bounds.top - 84))),
  });

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || window.matchMedia('(max-width: 900px)').matches) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus();
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: bounds.width,
      startHeight: bounds.height,
      maxWidth: Math.max(minimum.width, window.innerWidth - bounds.left - 8),
      maxHeight: Math.max(minimum.height, window.innerHeight - bounds.top - 84),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!resize.current || resize.current.pointerId !== event.pointerId) return;
      setSize({
        width: Math.round(Math.min(Math.max(resize.current.startWidth + event.clientX - resize.current.startX, minimum.width), resize.current.maxWidth)),
        height: Math.round(Math.min(Math.max(resize.current.startHeight + event.clientY - resize.current.startY, minimum.height), resize.current.maxHeight)),
      });
    };
    const finishResize = (event: PointerEvent) => {
      if (resize.current?.pointerId === event.pointerId) resize.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, [minimum.height, minimum.width]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    onFocus();
    const step = event.shiftKey ? 32 : 8;
    const widthDelta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    const heightDelta = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    setSize(clampSize(bounds.width + widthDelta, bounds.height + heightDelta, bounds));
  };

  return {
    size,
    handlers: { onPointerDown, onKeyDown },
  };
}

function MacWindow({
  name, title, visible, active, zoomed, onFocus, onClose, onMinimize, onZoom, children, layout = 'floating',
}: {
  name: MacWindowName;
  title: string;
  visible: boolean;
  active: boolean;
  zoomed: boolean;
  layout?: 'expanded' | 'floating';
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onZoom: () => void;
  children: React.ReactNode;
}) {
  const { position, ...dragHandlers } = useMacWindowDrag(onFocus, layout);
  const { size, handlers: resizeHandlers } = useMacWindowResize(onFocus, MAC_WINDOW_MIN_SIZE[name], layout);
  const style = {
    '--mac2006-drag-x': `${position.x}px`,
    '--mac2006-drag-y': `${position.y}px`,
    ...(!zoomed && size ? { width: `${size.width}px`, height: `${size.height}px` } : {}),
  } as React.CSSProperties;

  return (
    <section
      className={`mac2006-window mac2006-window-${name} mac2006-layout-${layout} ${active ? 'active' : ''} ${zoomed ? 'zoomed' : ''} ${visible ? '' : 'hidden'}`}
      style={style}
      aria-label={`${title} window`}
      aria-hidden={!visible}
      onPointerDown={onFocus}
    >
      <div className="mac2006-titlebar" {...dragHandlers}>
        <div className="mac2006-traffic-lights">
          <button type="button" className="close" aria-label={`Close ${title}`} onClick={onClose} />
          <button type="button" className="minimize" aria-label={`Minimize ${title}`} onClick={onMinimize} />
          <button type="button" className="zoom" aria-label={`Zoom ${title}`} onClick={onZoom} />
        </div>
        <strong>{title}</strong>
      </div>
      {children}
      <button
        type="button"
        className="mac2006-resize-handle"
        aria-label={`Resize ${title}`}
        title="Drag to resize. Arrow keys also work."
        {...resizeHandlers}
      />
    </section>
  );
}

function MacDock({
  activeWindow, safariOpen, aimOpen, mailOpen, textEditOpen, openWindow, showClippy, navigate,
}: {
  activeWindow: MacWindowName;
  safariOpen: boolean;
  aimOpen: boolean;
  mailOpen: boolean;
  textEditOpen: boolean;
  openWindow: (name: MacWindowName) => void;
  showClippy: () => void;
  navigate: (screen: ExperienceScreen) => void;
}) {
  return (
    <nav className="mac2006-dock" aria-label="Dock">
      <button type="button" className={activeWindow === 'safari' && safariOpen ? 'active' : ''} onClick={() => openWindow('safari')}>
        <span className="mac2006-app-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/icons/safari.png" width="48" height="48" alt="" draggable={false} />
        </span><small>Safari</small>
      </button>
      <button type="button" className={activeWindow === 'aim' && aimOpen ? 'active' : ''} onClick={() => openWindow('aim')}>
        <span className="mac2006-app-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/icons/aim.png" width="48" height="48" alt="" draggable={false} />
        </span><small>AIM</small>
      </button>
      <button type="button" className={activeWindow === 'mail' && mailOpen ? 'active' : ''} onClick={() => openWindow('mail')}>
        <span className="mac2006-app-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/icons/mail.png" width="48" height="48" alt="" draggable={false} />
        </span><small>Mail</small>
        <span className="mac2006-dock-badge" aria-label="1 unread message">1</span>
      </button>
      <button type="button" className={activeWindow === 'textedit' && textEditOpen ? 'active' : ''} onClick={() => openWindow('textedit')}>
        <span className="mac2006-app-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/icons/textedit.png" width="48" height="48" alt="" draggable={false} />
        </span><small>TextEdit</small>
      </button>
      <button type="button" onClick={showClippy}>
        <span className="mac2006-app-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/clippy.png" width="48" height="48" alt="" draggable={false} />
        </span><small>Clippy</small>
      </button>
      <span className="mac2006-dock-divider" aria-hidden="true" />
      <button type="button" onClick={() => navigate('home')} aria-label="iPhone — open music player">
        <span className="mac2006-app-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/icons/iphone.png" width="48" height="48" alt="" draggable={false} />
        </span><small>iPhone · Music</small>
      </button>
    </nav>
  );
}

function DesktopFooter() {
  return (
    <a className="xp2006-aac" href="https://www.artisticaccessibility.com" target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/2006/aac.png" alt="Artistic Accessibility Collective" />
    </a>
  );
}

function Toolbar({ screen, navigate }: { screen: ExperienceScreen; navigate: (screen: ExperienceScreen) => void }) {
  return (
    <nav className="xp2006-toolbar" aria-label="Sections">
      {TOOLBAR.map((item) => (
        <button key={item.id} type="button" className="xp2006-tool" aria-current={screen === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
          <span aria-hidden="true">{item.icon}</span>{item.label}
        </button>
      ))}
    </nav>
  );
}

function ExperienceWindow({
  title, screen, navigate, status, chat = false, live = false, children,
}: {
  title: string;
  screen: ExperienceScreen;
  navigate: (screen: ExperienceScreen) => void;
  status: string;
  chat?: boolean;
  live?: boolean;
  children: React.ReactNode;
}) {
  const menu = chat
    ? [['File', 'home'], ['People', 'buddies'], ['View', 'playlists'], ['Help', 'videos']] as const
    : [['My AIM', 'home'], ['People', 'buddies'], ['Help', 'show']] as const;

  return (
    <>
      <section className={`xp2006-window xp2006-window-${screen}`}>
        <div className="xp2006-titlebar">
          <span className="xp2006-running-man" aria-hidden="true" />
          <span className="xp2006-title">{title}</span>
          <span className="xp2006-window-buttons">
            <span aria-hidden="true">_</span><span aria-hidden="true">□</span>
            <button type="button" aria-label="close" onClick={() => navigate('home')}>×</button>
          </span>
        </div>
        <div className="xp2006-menubar">
          {menu.map(([label, destination]) => (
            <button key={label} type="button" onClick={() => navigate(destination)}>{label}</button>
          ))}
        </div>
        <div className="xp2006-window-content">{children}</div>
        <Toolbar screen={screen} navigate={navigate} />
        <div className="xp2006-statusline"><span>{status}</span><span>{live ? '● LIVE' : '0% ⚠'}</span></div>
      </section>
      <DesktopFooter />
    </>
  );
}

function IpodHome({
  screenName, selection, setSelection, navigate, signOff,
}: {
  screenName: string;
  selection: number;
  setSelection: (selection: number) => void;
  navigate: (screen: ExperienceScreen) => void;
  signOff: () => void;
}) {
  return (
    <>
      <div className="xp2006-ipod">
        <div className="xp2006-pod-screen">
          <div className="xp2006-pod-bar"><span>iPod</span><span className="xp2006-battery" /></div>
          <ul className="xp2006-pod-menu">
            {MENU.map((item, index) => {
              const enabled = item.id === 'show';
              return (
                <li key={item.id} className={`${enabled && selection === index ? 'on' : ''} ${enabled ? '' : 'disabled'}`}>
                  <button
                    type="button"
                    disabled={!enabled}
                    onPointerEnter={enabled ? () => setSelection(index) : undefined}
                    onFocus={enabled ? () => setSelection(index) : undefined}
                    onClick={enabled ? () => navigate(item.id) : undefined}
                  >
                    {item.label}<span>›</span>
                  </button>
                </li>
              );
            })}
            <li className="disabled"><button type="button" disabled onClick={signOff}>Sign Off<span>›</span></button></li>
          </ul>
          <div className="xp2006-pod-note">signed on as <strong>{screenName}</strong></div>
        </div>
        <div className="xp2006-wheel">
          <button type="button" className="menu" onClick={() => setSelection(0)}>MENU</button>
          <button type="button" className="prev" aria-label="previous menu item" disabled>|◀◀</button>
          <button type="button" className="next" aria-label="next menu item" disabled>▶▶|</button>
          <button type="button" className="play" aria-label="open videos" disabled>▶ ❚❚</button>
          <button type="button" className="center" aria-label="select The Show" onClick={() => navigate('show')} />
        </div>
      </div>
      <div className="xp2006-pod-caption">SHOW MODE · ONLINE NOW</div>
      <DesktopFooter />
    </>
  );
}

function BuddyModal({ buddy, screenName, type, close, showInfo }: {
  buddy: Buddy;
  screenName: string;
  type: 'im' | 'info';
  close: () => void;
  showInfo: () => void;
}) {
  const [entry, setEntry] = useState('');
  const [messages, setMessages] = useState<{ from: string; body: string }[]>([]);
  const [typing, setTyping] = useState(false);
  const [smarterState, setSmarterState] = useState<SmarterChildState>({ sulking: false });
  const [showSmileys, setShowSmileys] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  const replyTimer = useRef<number | null>(null);
  closeRef.current = close;

  useEffect(() => () => { if (replyTimer.current !== null) window.clearTimeout(replyTimer.current); }, []);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []);
    (buddy.bot && type === 'im' ? dialog?.querySelector<HTMLElement>('textarea') : focusable()[0])?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); previousFocus?.focus(); };
  }, [buddy.bot, type]);

  const send = () => {
    const value = entry.trim();
    if (!value || !buddy.bot || typing) return;
    setMessages((previous) => [...previous, { from: screenName, body: value }]);
    setEntry('');
    setTyping(true);
    replyTimer.current = window.setTimeout(() => {
      const reply = getSmarterChildReply(value, smarterState);
      setSmarterState(reply.state);
      setMessages((previous) => [...previous, { from: 'SmarterChild', body: reply.message }]);
      setTyping(false);
    }, 450 + Math.min(750, value.length * 24));
  };

  return (
    <div className="xp2006-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="xp2006-window xp2006-popwin" role="dialog" aria-modal="true" aria-label={type === 'info' ? `Buddy Info: ${buddy.screenName}` : `IM with ${buddy.screenName}`}>
        <div className="xp2006-titlebar">
          <span className={`xp2006-presence ${buddy.status}`} aria-hidden="true" />
          <span className="xp2006-title">{type === 'info' ? 'Buddy Info' : 'IM with'}: {buddy.screenName}</span>
          <span className="xp2006-window-buttons"><button type="button" aria-label="close" onClick={close}>×</button></span>
        </div>

        {type === 'info' ? (
          <>
            <div className="xp2006-info-body">
              <div><strong>Screen Name:</strong><span>{buddy.screenName}</span></div>
              <div><strong>Role in 2006:</strong><span>{buddy.role}</span></div>
              <div><strong>Warning Level:</strong><span>0%</span></div>
              <div><strong>Member Since:</strong><span>{buddy.bot ? '2001 (the elder)' : '2006 (obviously)'}</span></div>
              <div><strong>Status:</strong><span>{buddy.status}{buddy.idleMinutes ? ` — idle ${buddy.idleMinutes} min` : ''}</span></div>
              {buddy.about && <div className="show2006-buddy-about"><strong>On the show:</strong><p>{buddy.about}</p></div>}
              {buddy.awayMessage && (
                <div className="xp2006-profile-card" style={{ background: buddy.background, color: buddy.foreground, fontFamily: buddy.font }}>
                  <small>AWAY MESSAGE</small>{buddy.awayMessage}
                </div>
              )}
              <div className="xp2006-profile-card" style={{ background: buddy.background, color: buddy.foreground, fontFamily: buddy.font }}>
                <small>PROFILE</small>{buddy.profile || 'No profile posted yet.'}
              </div>
            </div>
            <div className="xp2006-im-actions"><button type="button" className="xp2006-button" onClick={close}>Close</button></div>
          </>
        ) : (
          <>
            <div className="xp2006-im-log">
              {buddy.bot ? (
                <p><strong className="them">SmarterChild:</strong> Hi! I&apos;m <b>SmarterChild</b>! Welcome to “2006”!<br />Ask me anything about the year 2006. Or type <b>joke</b>. Your call.</p>
              ) : buddy.awayMessage ? (
                <><p className="auto">Auto response from <b>{buddy.screenName}</b>:</p><div className="xp2006-away-card" style={{ background: buddy.background, color: buddy.foreground, fontFamily: buddy.font }}>{buddy.awayMessage}</div></>
              ) : <p className="auto">{buddy.screenName} is online.</p>}
              {messages.map((message, index) => (
                <p key={`${message.from}-${index}`}><strong className={message.from === 'SmarterChild' ? 'them' : 'me'}>{message.from}:</strong> {message.body}</p>
              ))}
            </div>
            <div className="xp2006-im-tools">
              <span aria-hidden="true"><b>A</b> <i>A</i> <u>A</u></span>
              <button type="button" aria-label="smileys" onClick={() => setShowSmileys((value) => !value)}>☺</button>
            </div>
            {showSmileys && <div className="xp2006-smileys">{[':-)', ':-D', ';-)', ':-P', ':-(', "8-)", '<3'].map((face) => <button key={face} type="button" onClick={() => setEntry((value) => `${value}${value ? ' ' : ''}${face}`)}>{face}</button>)}</div>}
            <textarea
              className="xp2006-im-entry"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
              disabled={!buddy.bot}
              aria-label={buddy.bot ? 'Message SmarterChild' : 'Cast away message'}
              placeholder={buddy.bot ? 'ask me about 2006...' : 'This is their away message. Join the live audience chat to hang out.'}
              rows={2}
            />
            <div className="xp2006-im-actions">
              <span>{typing ? 'SmarterChild is typing...' : ''}</span>
              <button type="button" className="xp2006-button" onClick={showInfo}>Info</button>
              <button type="button" className="xp2006-button primary" disabled={!buddy.bot || !entry.trim() || typing} onClick={send}>Send</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function AimExperience({
  viewer, streamData, streamError, tokenRefreshError, refreshStream, onSignOff,
}: {
  viewer: Viewer;
  streamData: ExperienceStreamData | null;
  streamError: string | null;
  tokenRefreshError: string | null;
  refreshStream: () => void;
  onSignOff: () => void;
}) {
  const [screen, setScreen] = useState<ExperienceScreen>('show');
  const [podSelection, setPodSelection] = useState(0);
  const [selectedBuddy, setSelectedBuddy] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [groups, setGroups] = useState({ cast: true, bots: true, offline: true });
  const [statusMessage, setStatusMessage] = useState('tap a buddy twice for their profile');
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  const [activeMacWindow, setActiveMacWindow] = useState<MacWindowName>('safari');
  const [expandedLayout, setExpandedLayout] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<'watch' | 'game' | 'chat' | 'extras'>('watch');
  const [castAnimationsPaused, setCastAnimationsPaused] = useState(false);
  const toggleCastAnimations = () => {
    showInteraction.current = true;
    setClippyVisible(false);
    setCastAnimationsPaused(value => !value);
  };
  const revealMobileTrivia = useCallback(() => setMobilePanel('game'), []);
  const selectMobilePanel = (panel: typeof mobilePanel) => {
    setMobilePanel(panel);
    setClippyVisible(false);
    showInteraction.current = true;
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  };
  const showGameRef = useRef<HTMLDivElement>(null);
  const showInteraction = useRef(false);
  const showVideoRef = useRef<HTMLDivElement>(null);
  const reconnectVideoRef = useRef<(() => void) | null>(null);
  const registerVideoReconnect = useCallback((reconnect: (() => void) | null) => {
    reconnectVideoRef.current = reconnect;
  }, []);
  const reconnectStream = useCallback(() => {
    // Preserve the original tap's media permission; do not wait for fetch.
    try {
      reconnectVideoRef.current?.();
    } catch (reason) {
      // A failed provider must not prevent obtaining the latest cue/token.
      console.warn('Local video recovery failed; refreshing the feed:', reason);
    }
    refreshStream();
  }, [refreshStream]);
  const scrollToShowSection = (section: 'game' | 'video') => {
    showInteraction.current = true;
    setActiveMacWindow('safari');
    setClippyVisible(false);
    const target = section === 'game' ? showGameRef.current : showVideoRef.current;
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  };
  const [macWindows, setMacWindows] = useState<Record<MacWindowName, boolean>>({ safari: true, aim: true, mail: false, textedit: false });
  const [zoomedMacWindow, setZoomedMacWindow] = useState<MacWindowName | null>(null);
  const [clippyVisible, setClippyVisible] = useState(false);
  const [clippyMode, setClippyMode] = useState<ClippyMode>('mail');
  const [essayPrompt, setEssayPrompt] = useState(0);
  const [essayDraft, setEssayDraft] = useState('');
  const [essaySaved, setEssaySaved] = useState(false);
  const [essaySaveError, setEssaySaveError] = useState<string | null>(null);
  const cueRequestSequence = useRef(0);
  const [requestedGameCue, setRequestedGameCue] = useState<(GameCueRequest & { cueId: string; occurrenceId: string }) | null>(null);
  const inviteAudienceTask = useCallback((cue: AudienceCue) => {
    if (cue.action.type === 'essay' && !macWindows.textedit) {
      setClippyMode('mail');
      // Phones receive the inline invitation, not a floating helper.
      if (!window.matchMedia('(max-width: 900px)').matches) setClippyVisible(true);
    }
  }, [macWindows.textedit]);
  const audienceCues = useAudienceCues({ stream: streamData, viewerId: viewer.id,
    config: SHOW_AUDIENCE_CUES, enabled: screen === 'show' && macWindows.safari, offline: Boolean(streamError), onEnter: inviteAudienceTask });
  const gameCueRequest = requestedGameCue && requestedGameCue.occurrenceId === audienceCues.occurrenceId
    && audienceCues.activeCues.some(cue => cue.id === requestedGameCue.cueId) ? requestedGameCue : null;
  const invitedCue = audienceCues.visibleCues.find(cue => cue.action.type !== 'commercial') ?? null;
  const commercialLayout = audienceCues.activeCues.some(cue => cue.action.type === 'commercial');
  const castRun = useCastRun({ paused: castAnimationsPaused, visible: screen === 'show', mobilePanel, safariVisible: macWindows.safari });
  const runShowBuddy = (art: CastRunId, origin: CastRunOrigin) => {
    const started = castRun.startRun(art, origin);
    if (started) {
      showInteraction.current = true;
      setClippyVisible(false);
    }
    return started;
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`2006_essay_${viewer.id}`);
      if (!saved) return;
      const draft = JSON.parse(saved);
      if (typeof draft.text !== 'string' || !Number.isInteger(draft.prompt) || draft.prompt < 0 || draft.prompt >= ESSAY_PROMPTS.length) return;
      setEssayDraft(draft.text);
      setEssayPrompt(draft.prompt);
      setEssaySaved(true);
    } catch { /* A blocked or invalid browser store must not prevent watching. */ }
  }, [viewer.id]);

  useEffect(() => {
    try {
      const requested = sessionStorage.getItem('2006_party_initial_screen') as ExperienceScreen | null;
      if (requested && ['home', 'buddies', 'videos', 'playlists', 'graveyard', 'show'].includes(requested)) setScreen(requested);
    } catch { /* Cookie-backed sign-on works even when browser storage is blocked. */ }
  }, []);

  useEffect(() => {
    const titles: Record<ExperienceScreen, string> = {
      home: 'iPod menu', buddies: 'Buddy list, the cast of 2006', videos: 'Videos', playlists: 'Playlists', graveyard: 'The Graveyard', show: 'The Show',
    };
    document.title = `${titles[screen]} · 2006`;
  }, [screen]);

  useEffect(() => {
    if (screen !== 'show' || audienceCues.armed) return;

    // Offer the essay reminder without covering the show or an in-progress vote.
    const clippyTimer = window.setTimeout(() => {
      if (showInteraction.current) return;
      if (window.matchMedia('(max-width: 900px)').matches) return;
      setClippyMode('mail');
      setClippyVisible(true);
    }, 1_200);

    return () => {
      window.clearTimeout(clippyTimer);
    };
  }, [screen, audienceCues.armed]);

  const navigate = (destination: ExperienceScreen) => {
    try { sessionStorage.setItem('2006_party_initial_screen', destination); } catch { /* Navigation remains in memory. */ }
    setScreen(destination);
    setSelectedBuddy(null);
    setModal(null);
  };

  const signOff = () => {
    clearViewerData();
    onSignOff();
  };

  const cast = useMemo(() => BUDDIES.map((buddy, index) => ({ buddy, index })).filter(({ buddy }) => !buddy.bot), []);
  const bots = useMemo(() => BUDDIES.map((buddy, index) => ({ buddy, index })).filter(({ buddy }) => buddy.bot), []);

  const clickBuddy = (index: number) => {
    const buddy = BUDDIES[index];
    if (selectedBuddy === index) {
      setModal({ type: 'im', buddyIndex: index });
      setStatusMessage(buddy.bot ? 'SmarterChild is a robot. tap again to chat!' : `tap again to open ${buddy.screenName}`);
      return;
    }
    setSelectedBuddy(index);
    setStatusMessage(buddy.bot ? 'SmarterChild is a robot. tap again to chat!' : `tap again to open ${buddy.screenName}`);
  };

  const openMacWindow = (name: MacWindowName) => {
    setMacWindows((windows) => ({ ...windows, [name]: true }));
    setActiveMacWindow(name);
    if (window.matchMedia('(max-width: 900px)').matches) {
      setMobilePanel(name === 'aim' ? 'chat' : name === 'safari' ? 'watch' : 'extras');
      requestAnimationFrame(() => document.querySelector(`.mac2006-window-${name}`)?.scrollIntoView({ block: 'start' }));
    }
  };

  const hideMacWindow = (name: MacWindowName) => {
    setMacWindows((windows) => ({ ...windows, [name]: false }));
    setZoomedMacWindow((zoomed) => zoomed === name ? null : zoomed);
    setActiveMacWindow(name === 'safari' ? 'aim' : 'safari');
  };

  const toggleMacZoom = (name: MacWindowName) => {
    setActiveMacWindow(name);
    setZoomedMacWindow((zoomed) => zoomed === name ? null : name);
  };

  const openMail = () => {
    openMacWindow('mail');
    setClippyVisible(false);
  };

  const openEssay = () => {
    openMacWindow('textedit');
    setClippyMode('essay');
    setClippyVisible(true);
  };

  const openAudienceTask = (cue: AudienceCue) => {
    if (cue.action.type === 'essay') {
      const index = cue.action.promptIndex;
      // A timed invitation must never replace an existing essay/draft.
      if (!essayDraft && index !== undefined && index < ESSAY_PROMPTS.length) setEssayPrompt(index);
      openEssay();
    } else if (cue.action.type === 'poll' || cue.action.type === 'awards') {
      if (cue.action.type === 'poll' && audienceCues.occurrenceId) {
        setRequestedGameCue({ key: JSON.stringify([getDeliveryKey(SHOW_AUDIENCE_CUES.showId, audienceCues.occurrenceId, cue), ++cueRequestSequence.current]),
          cueId: cue.id, occurrenceId: audienceCues.occurrenceId, promptId: cue.action.promptId, kind: cue.action.kind });
      }
      if (window.matchMedia('(max-width: 900px)').matches) selectMobilePanel('game');
      else scrollToShowSection('game');
    }
  };

  const saveEssay = () => {
    try {
      localStorage.setItem(`2006_essay_${viewer.id}`, JSON.stringify({ text: essayDraft, prompt: essayPrompt }));
      setEssaySaveError(null);
      setEssaySaved(true);
      setClippyMode('saved');
      setClippyVisible(true);
    } catch {
      setEssaySaved(false);
      setEssaySaveError('Your browser could not save this draft. Copy your writing somewhere safe before leaving.');
    }
  };

  const openShowBuddy = (index: number) => {
    castRun.finishRun();
    showInteraction.current = true;
    setClippyVisible(false);
    setModal({ type: BUDDIES[index].bot ? 'im' : 'info', buddyIndex: index });
  };

  const buddyStripProps = {
    buddies: SHOW_BUDDIES, run: castRun.run, canRun: castRun.canRun, reducedMotion: castRun.reducedMotion,
    onRun: runShowBuddy, onLoad: castRun.loadRun, onFinish: castRun.finishRun,
    onOpen: openShowBuddy, paused: castAnimationsPaused, onToggleMotion: toggleCastAnimations,
  };

  return (
    <div className={`aim-desktop xp2006-desktop ${screen === 'show' ? 'mac2006-desktop' : ''}`}>
      <a className="sr-only" href="#xp2006-main">Skip to the window</a>
      <main id="xp2006-main" data-mobile-panel={mobilePanel} className={screen === 'show' ? 'mac2006-shell' : 'xp2006-frame'}>
        <h1 className="sr-only">2006</h1>

        {screen === 'home' && (
          <IpodHome screenName={viewer.displayName} selection={podSelection} setSelection={setPodSelection} navigate={navigate} signOff={signOff} />
        )}

        {screen === 'buddies' && (
          <ExperienceWindow title={`${viewer.displayName}'s Buddy List`} screen={screen} navigate={navigate} status={statusMessage}>
            <div className="xp2006-buddy-head"><span className="xp2006-running-man big" aria-hidden="true" /><div><strong>{viewer.displayName}</strong><span>✉ You have no new e-mail</span></div></div>
            <div className="xp2006-pane xp2006-buddy-pane">
              <button type="button" className="xp2006-group" onClick={() => setGroups((value) => ({ ...value, cast: !value.cast }))}><span>{groups.cast ? '▼' : '▶'}</span>2006er <em>({cast.length}/{cast.length})</em></button>
              {groups.cast && cast.map(({ buddy, index }) => (
                <button key={buddy.screenName} type="button" className={`xp2006-buddy ${buddy.status} ${selectedBuddy === index ? 'selected' : ''}`} onClick={() => clickBuddy(index)}>
                  <span className={`xp2006-presence ${buddy.status}`} aria-hidden="true" /><span>{buddy.screenName}</span>{buddy.idleMinutes ? <em>{buddy.idleMinutes} min</em> : null}
                </button>
              ))}
              <button type="button" className="xp2006-group" onClick={() => setGroups((value) => ({ ...value, bots: !value.bots }))}><span>{groups.bots ? '▼' : '▶'}</span>Bots <em>({bots.length}/{bots.length})</em></button>
              {groups.bots && bots.map(({ buddy, index }) => (
                <button key={buddy.screenName} type="button" className={`xp2006-buddy ${selectedBuddy === index ? 'selected' : ''}`} onClick={() => clickBuddy(index)}>
                  <span className="xp2006-presence online" aria-hidden="true" /><span>{buddy.screenName}</span>
                </button>
              ))}
              <button type="button" className="xp2006-group muted" onClick={() => setGroups((value) => ({ ...value, offline: !value.offline }))}><span>{groups.offline ? '▼' : '▶'}</span>Offline <em>(0/6)</em></button>
            </div>
          </ExperienceWindow>
        )}

        {screen === 'videos' && (
          <ExperienceWindow title="Videos" screen={screen} navigate={navigate} status="4 videos">
            <div className="xp2006-blog">
              <h2>videos</h2><p>a running list. no order to it. click one and it opens in its own little window, the way a video was supposed to.</p>
              {VIDEO_GROUPS.map(([title, ...items], groupIndex) => (
                <section key={title} style={{ '--neon': ['#39ff14', '#ff00ff', '#00f0ff'][groupIndex] } as React.CSSProperties}>
                  <h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
                </section>
              ))}
              <ErrorBoundary fallback={null}><VideoPlaylistShelf /></ErrorBoundary>
              <hr /><p><a className="xp2006-submit" href="mailto:hello@artisticaccessibility.com?subject=2006%20video%20submission">📼 SUBMIT UR VIDEO</a></p>
              <small>last updated: whenever · best viewed in 800x600</small>
            </div>
          </ExperienceWindow>
        )}

        {screen === 'playlists' && (
          <ExperienceWindow title="Playlists" screen={screen} navigate={navigate} status={`${PLAYLISTS.length} playlists`}>
            <div className="xp2006-pane xp2006-playlists">
              <div className="xp2006-pane-intro"><h2>Playlists</h2><p>mixes made by the people in the show. tap one to see what&apos;s on it.</p></div>
              {PLAYLISTS.map((playlist) => {
                const isOpen = openPlaylist === playlist.id;
                return (
                  <div key={playlist.id}>
                    <button type="button" className={`xp2006-playlist-row ${isOpen ? 'open' : ''}`} aria-expanded={isOpen} onClick={() => setOpenPlaylist(isOpen ? null : playlist.id)}>
                      <span className="art">{isOpen ? '▾' : '♪'}</span><span className="meta"><strong>{playlist.title}</strong><small>{playlist.byline}{playlist.tracks.length ? ` · ${playlist.tracks.length} songs` : ''}</small></span><span>›</span>
                    </button>
                    {isOpen && <div className="xp2006-playlist-open"><p>{playlist.description}</p>{playlist.tracks.length ? <ol>{playlist.tracks.map(([title, artist, note]) => <li key={title}><strong>{title}</strong><span>{artist}</span>{note && <em>{note}</em>}</li>)}</ol> : <p>no songs on this one yet.</p>}</div>}
                  </div>
                );
              })}
            </div>
          </ExperienceWindow>
        )}

        {screen === 'graveyard' && (
          <ExperienceWindow title="R.I.P. 2006" screen={screen} navigate={navigate} status={`${GRAVES.length} dearly departed`}>
            <div className="xp2006-pane xp2006-graveyard"><div className="xp2006-pane-intro"><h2>The Graveyard</h2><p>things we lost since 2006. leave flowers. 🥀</p></div><div className="xp2006-stones">{GRAVES.map(([name, dates, epitaph]) => <div key={name}><strong>{name}</strong><i>{dates}<br />{epitaph}</i></div>)}</div></div>
          </ExperienceWindow>
        )}

        {screen === 'show' && (
          <>
            <header className="mobile2006-header">
              <div className="mobile2006-heading">
                <button type="button" onClick={() => navigate('home')} aria-label="Back to iPod menu">‹ iPod</button>
                <strong>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/2006/wordmark.png" alt="2006" width={76} height={29} /><span>THE SHOW. LIVE.</span>
                </strong>
                <button type="button" onClick={reconnectStream} aria-label="Reconnect video">Reconnect</button>
              </div>
              <nav aria-label="Mobile show sections">
                {([
                  ['watch', 'Watch'], ['game', 'Vote & Trivia'], ['chat', 'Chat'], ['extras', 'Extras'],
                ] as const).map(([panel, label]) => (
                  <button key={panel} type="button" aria-pressed={mobilePanel === panel} onClick={() => selectMobilePanel(panel)}>{label}</button>
                ))}
              </nav>
            </header>
            <MacMenuBar activeWindow={activeMacWindow} navigate={navigate} expanded={expandedLayout} onToggleLayout={() => {
              setExpandedLayout(value => !value);
              setZoomedMacWindow(null);
            }} />
            {tokenRefreshError && <div className="mac2006-warning" role="status">{tokenRefreshError}</div>}

            <MacWindow
              name="safari"
              layout={expandedLayout ? 'expanded' : 'floating'}
              title={`${streamData?.title || '2006'} — Safari`}
              visible={macWindows.safari}
              active={activeMacWindow === 'safari'}
              zoomed={zoomedMacWindow === 'safari'}
              onFocus={() => setActiveMacWindow('safari')}
              onClose={() => hideMacWindow('safari')}
              onMinimize={() => hideMacWindow('safari')}
              onZoom={() => toggleMacZoom('safari')}
            >
              <div className="mac2006-safari-toolbar">
                <div className="mac2006-browser-actions">
                  <button type="button" onClick={() => navigate('home')}>Back</button>
                  <button type="button" disabled>Forward</button>
                  <button type="button" onClick={reconnectStream}>Reload</button>
                  <button type="button" onClick={() => navigate('home')}>Home</button>
                </div>
                <label className="mac2006-address"><span className="sr-only">Address</span><input readOnly value="https://2006-party.vercel.app/event" /></label>
              </div>
              <nav className="mac2006-bookmarks" aria-label="Safari bookmarks bar">
                <button type="button" onClick={() => navigate('home')}>iPod</button>
                <button type="button" onClick={() => scrollToShowSection('video')}>Watch Show</button>
                <button type="button" onClick={() => scrollToShowSection('game')}>Vote &amp; Trivia</button>
                <button type="button" onClick={() => openShowBuddy(0)}>2006ers</button>
                <button type="button" onClick={() => openShowBuddy(6)}>SmarterChild</button>
                <button type="button" onClick={openMail}>Essay due!</button>
              </nav>

              <div className="mac2006-safari-page" data-audience-layout={commercialLayout ? 'commercial' : 'program'}>
                <div className="show2006-desktop-buddies"><ShowBuddyStrip origin="desktop" {...buddyStripProps} /></div>
                <div className="mac2006-video" ref={showVideoRef} tabIndex={-1}>
                  {streamData ? (
                    <ErrorBoundary fallback={<div className="mac2006-video-error">The video player stopped. Reload to reconnect.</div>}>
                      <VideoPlayer
                        key={streamData.playbackSessionId}
                        playbackSessionId={streamData.playbackSessionId} playbackRevision={streamData.playbackRevision}
                        serverNow={streamData.serverNow} playbackPositionSeconds={streamData.playbackPositionSeconds}
                        playbackDurationSeconds={streamData.playbackDurationSeconds} snapshotReceivedAt={streamData.snapshotReceivedAt}
                        snapshotRoundTripMs={streamData.snapshotRoundTripMs} onStreamRefresh={refreshStream}
                        onReconnectReady={registerVideoReconnect}
                        playbackId={streamData.playbackId} token={streamData.token} title={streamData.title} kind={streamData.kind}
                        sourceType={streamData.sourceType} youtubePlaylistId={streamData.youtubePlaylistId} sourceUrl={streamData.sourceUrl}
                        isHoldScreen={streamData.isHoldScreen} playoutMode={streamData.playoutMode} playbackState={streamData.playbackState}
                        playbackPosition={streamData.playbackPosition} playbackUpdatedAt={streamData.playbackUpdatedAt} playbackElapsedMs={streamData.playbackElapsedMs}
                        activeSlotId={streamData.activeSlotId} captionUrl={streamData.captionUrl} captionLabel={streamData.captionLabel}
                        captionLanguage={streamData.captionLanguage} onPlaybackError={refreshStream}
                      />
                    </ErrorBoundary>
                  ) : (
                    <div className="mac2006-video-error">
                      <p>{streamError || 'Connecting to the program feed…'}</p>
                      {streamError && <button type="button" className="mac2006-aqua-button" onClick={refreshStream}>Try again</button>}
                    </div>
                  )}
                </div>

                <div className="mac2006-now-playing">
                  <strong>Now playing:</strong>
                  <span>{streamData?.title || 'connecting…'}</span>
                  <TransitionClock nextTransitionAt={streamData?.nextTransitionAt} />
                </div>

                <AudienceCueBar cue={invitedCue} onAction={openAudienceTask}
                  onDismiss={() => {
                    if (!invitedCue) return;
                    audienceCues.dismissCue(invitedCue);
                    if (invitedCue.action.type === 'essay') setClippyVisible(false);
                  }} />

                <div className="mac2006-tabs">
                  <button type="button" onClick={() => scrollToShowSection('game')}>Vote, Trivia &amp; Superlatives</button>
                </div>
                <div className="mac2006-extra-panel" ref={showGameRef} tabIndex={-1} role="region" aria-label="Show game">
                  <ErrorBoundary fallback={<p>The show game is temporarily unavailable.</p>}><GameBoard screenName={viewer.displayName}
                    onOpenTrivia={revealMobileTrivia} autoTriviaPopup={!audienceCues.armed} cueRequest={gameCueRequest} /></ErrorBoundary>
                  <ErrorBoundary fallback={<p>Voting is temporarily unavailable.</p>}><PollsTab userId={viewer.id} room={ROOM_NAMES.DEFAULT} hideWhenEmpty /></ErrorBoundary>
                  <ShowLinks />
                </div>
              </div>
            </MacWindow>

            <section className="mobile2006-watch" aria-label="Watching the show">
              <span className="game-eyebrow">Signed on as {viewer.displayName}</span>
              <h2>The year. The show. You’re in.</h2>
              <p>A play performed like an episode of TRL. You pick the countdown. Between videos: a pop quiz, yearbook awards, and an AIM chat full of 2006ers.</p>
              <div>
                <button type="button" onClick={() => selectMobilePanel('game')}>Vote &amp; Trivia</button>
                <button type="button" onClick={() => selectMobilePanel('chat')}>Open AIM chat</button>
              </div>
              <ShowBuddyStrip origin="watch" {...buddyStripProps} />
              <ShowLinks />
            </section>
            <section className="mobile2006-extras" aria-label="Show extras">
              <h2>A little more 2006</h2>
              <p>Check an away message. Ask SmarterChild a question. Pretend your essay isn’t due.</p>
              <ShowBuddyStrip origin="extras" {...buddyStripProps} />
              <div>
                <button type="button" onClick={() => openShowBuddy(6)}>IM SmarterChild</button>
                <button type="button" onClick={openMail}>Check Mail</button>
                <button type="button" onClick={() => openMacWindow('textedit')}>Open essay</button>
              </div>
              <ShowLinks />
            </section>

            <MacWindow
              name="aim"
              layout={expandedLayout ? 'expanded' : 'floating'}
              title={`AIM — ${viewer.displayName}`}
              visible={macWindows.aim}
              active={activeMacWindow === 'aim'}
              zoomed={zoomedMacWindow === 'aim'}
              onFocus={() => setActiveMacWindow('aim')}
              onClose={() => hideMacWindow('aim')}
              onMinimize={() => hideMacWindow('aim')}
              onZoom={() => toggleMacZoom('aim')}
            >
              <div className="mac2006-aim-menu"><span>AIM</span><span>File</span><span>Edit</span><button type="button" onClick={() => openShowBuddy(0)}>Buddy Info</button><button type="button" onClick={() => openShowBuddy(6)}>SmarterChild</button></div>
              <div className="mac2006-aim-body">
                <ErrorBoundary fallback={<div className="mac2006-chat-error">Chat is temporarily unavailable.</div>}>
                  <Chat room={ROOM_NAMES.DEFAULT} userId={viewer.id} screenName={viewer.displayName} embedded />
                </ErrorBoundary>
              </div>
            </MacWindow>

            <MacWindow
              name="mail"
              title="Essay due! — Mail"
              visible={macWindows.mail}
              active={activeMacWindow === 'mail'}
              zoomed={zoomedMacWindow === 'mail'}
              onFocus={() => setActiveMacWindow('mail')}
              onClose={() => hideMacWindow('mail')}
              onMinimize={() => hideMacWindow('mail')}
              onZoom={() => toggleMacZoom('mail')}
            >
              <MailApp onStartEssay={openEssay} />
            </MacWindow>

            <MacWindow
              name="textedit"
              title="2006 Essay — TextEdit"
              visible={macWindows.textedit}
              active={activeMacWindow === 'textedit'}
              zoomed={zoomedMacWindow === 'textedit'}
              onFocus={() => setActiveMacWindow('textedit')}
              onClose={() => hideMacWindow('textedit')}
              onMinimize={() => hideMacWindow('textedit')}
              onZoom={() => toggleMacZoom('textedit')}
            >
              <TextEditApp
                promptIndex={essayPrompt}
                setPromptIndex={(index) => { setEssayPrompt(index); setEssaySaved(false); setEssaySaveError(null); }}
                draft={essayDraft}
                setDraft={(draft) => { setEssayDraft(draft); setEssaySaved(false); setEssaySaveError(null); }}
                saved={essaySaved}
                saveError={essaySaveError}
                onSave={saveEssay}
              />
            </MacWindow>

            {clippyVisible && (
              <ClippyAssistant
                mode={clippyMode}
                onOpenMail={openMail}
                onOpenEssay={() => { openMacWindow('textedit'); setClippyVisible(false); }}
                onDismiss={() => setClippyVisible(false)}
              />
            )}

            <MacDock
              activeWindow={activeMacWindow}
              safariOpen={macWindows.safari}
              aimOpen={macWindows.aim}
              mailOpen={macWindows.mail}
              textEditOpen={macWindows.textedit}
              openWindow={openMacWindow}
              showClippy={() => setClippyVisible(true)}
              navigate={navigate}
            />
          </>
        )}
      </main>

      {modal && (
        <BuddyModal
          key={`${modal.buddyIndex}-${modal.type}`}
          buddy={BUDDIES[modal.buddyIndex]}
          screenName={viewer.displayName}
          type={modal.type}
          close={() => setModal(null)}
          showInfo={() => setModal({ ...modal, type: 'info' })}
        />
      )}
    </div>
  );
}
