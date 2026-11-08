'use client';

import { useEffect, useRef, useState } from 'react';
import { LIVE_CLIPPY_LINES, TYPING_PAUSE_MS, countWords, shouldSpeak, type TypingState } from '@/lib/clippy-typing';
import { ESSAY_PROMPTS, essayError, type PublishedEssay } from '@/lib/essays';
import ClippyAnimation from './ClippyAnimation';

export type ClippyMode = 'mail' | 'essay' | 'saved';

const CLIPPY_DIALOGUE = {
  mail: {
    heading: 'STUDY BREAK!',
    lines: [
      'Your 2006 reflection is due before the show ends. Pick a prompt and add a few lines.',
      'Remember your away message? Your essay can be a little longer than that.',
      'A song, a screen name, a wildly optimistic life plan. Pick a prompt and tell us about 2006.',
    ],
  },
  essay: {
    heading: 'It looks like you’re writing an essay.',
    lines: [
      'Pick a prompt and start with one memory. Save your draft when you want to keep it.',
      'No need for a five-paragraph masterpiece. A few lines about your 2006 will do.',
      'I bring the paperclip energy. You bring the memories. Remember to save your draft.',
    ],
  },
  saved: {
    heading: 'Homework crisis averted.',
    lines: [
      'Your draft is saved in this browser. I knew you had it in you.',
      'Saved in this browser. Your English teacher would be so proud.',
      'One small save for you. One giant relief for your paperclip. Your draft is stored in this browser.',
    ],
  },
} satisfies Record<ClippyMode, { heading: string; lines: string[] }>;

type TypingLine = { text: string; key: number };

/** Copy changes when the guest asks, or (in the essay helper) when typing
 * pauses. Neither moves focus or touches their writing. */
function ClippyDialogue({ mode, typingLine = null }: { mode: ClippyMode; typingLine?: TypingLine | null }) {
  const [line, setLine] = useState(0);
  const [dismissedTyping, setDismissedTyping] = useState<number | null>(null);
  const content = CLIPPY_DIALOGUE[mode];
  const showTyping = typingLine && typingLine.key !== dismissedTyping;
  return <>
    <div className="show2006-clippy-copy" role="status" aria-atomic="true">
      <strong>{content.heading}</strong>
      <p>{showTyping ? typingLine.text : content.lines[line % content.lines.length]}</p>
    </div>
    <button type="button" className="show2006-clippy-another" onClick={() => {
      if (showTyping) setDismissedTyping(typingLine.key);
      setLine(value => (value + 1) % content.lines.length);
    }}>What else, Clippy?</button>
  </>;
}

/** Live Clippy's catchphrases while the guest writes, paced by shouldSpeak. */
function useTypingLines(draft: string, enabled: boolean): TypingLine | null {
  const [typingLine, setTypingLine] = useState<TypingLine | null>(null);
  const state = useRef<TypingState>({ lastSpokeAt: null, wordsAtLastLine: countWords(draft) });
  const next = useRef(0);
  const firstDraft = useRef(true);
  useEffect(() => {
    // A restored draft is not typing; only react to changes after opening.
    if (firstDraft.current) { firstDraft.current = false; return; }
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      const words = countWords(draft);
      const now = Date.now();
      if (!shouldSpeak(state.current, now, words)) return;
      const pool = LIVE_CLIPPY_LINES.length ? LIVE_CLIPPY_LINES : CLIPPY_DIALOGUE.essay.lines;
      state.current = { lastSpokeAt: now, wordsAtLastLine: words };
      setTypingLine({ text: pool[next.current % pool.length], key: now });
      next.current += 1;
    }, TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, enabled]);
  return typingLine;
}

const BALLOON_AUTO_CLOSE_MS = 12_000;

/** Clippy floating over the TextEdit page like Office's assistant: a small
 * character in the corner with a speech balloon. Click to poke him and open
 * the balloon; drag to move him anywhere in the window; typing lines pop the
 * balloon open and it tucks itself away again. Never moves focus. */
function EssayClippy({ mode, typingLine, paused, active, onHide }: {
  mode: ClippyMode; typingLine: TypingLine | null; paused: boolean; active: boolean; onHide: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const balloon = useRef<HTMLDivElement>(null);
  // Phones start with the balloon closed so it never sits over the writing.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 900px)').matches);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [userPaused, setUserPaused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const drag = useRef<{ pointer: number; startX: number; startY: number; from: { x: number; y: number }; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const autoClose = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  // The greeting and each typing line open the balloon, then it tucks away
  // unless the guest is using it.
  useEffect(() => {
    if (typingLine) setOpen(true);
    if (autoClose.current) window.clearTimeout(autoClose.current);
    autoClose.current = window.setTimeout(() => {
      if (!balloon.current?.matches(':hover, :focus-within')) setOpen(false);
    }, BALLOON_AUTO_CLOSE_MS);
  }, [typingLine]);
  useEffect(() => () => { if (autoClose.current) window.clearTimeout(autoClose.current); }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, from: offset, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const dx = event.clientX - d.startX, dy = event.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
    // Keep him inside the TextEdit window.
    const box = host.current, frame = box?.closest('.mac2006-textedit-app');
    if (!box || !frame) return;
    const f = frame.getBoundingClientRect(), b = box.getBoundingClientRect();
    // `b` is where he is drawn now (at `offset`), so the window edges bound the offset.
    const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
    setOffset({
      x: clamp(d.from.x + dx, offset.x + f.left - b.left, offset.x + f.right - b.right),
      y: clamp(d.from.y + dy, offset.y + f.top - b.top, offset.y + f.bottom - b.bottom),
    });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (drag.current?.moved) justDragged.current = true;
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };

  return (
    <div ref={host} className="essay-clippy" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
      {open && (
        <div ref={balloon} className="essay-clippy-balloon" role="region" aria-label="Clippy">
          <ClippyDialogue mode={mode} typingLine={typingLine} />
          <div className="essay-clippy-actions">
            {!reduced && !paused && <button type="button" aria-pressed={userPaused} onClick={() => setUserPaused(value => !value)}>{userPaused ? 'Resume Clippy' : 'Pause Clippy'}</button>}
            <button type="button" onClick={onHide}>Hide Clippy</button>
          </div>
          <button type="button" className="essay-clippy-close" aria-label="Close Clippy’s balloon" onClick={() => setOpen(false)}>×</button>
        </div>
      )}
      <div className="essay-clippy-body" title="Click me. Drag to move me."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClickCapture={event => { if (justDragged.current) { justDragged.current = false; event.preventDefault(); event.stopPropagation(); } }}>
        <ClippyAnimation compact reaction={mode === 'saved' ? 'spin' : 'curious'} paused={paused || userPaused} active={active}
          onPoke={() => setOpen(true)} />
      </div>
    </div>
  );
}

/** Phone counterpart to the desktop helper, kept below the program picture. */
export function StudyBreakInvitation({ onOpenEssay, onDismiss }: { onOpenEssay: () => void; onDismiss: () => void }) {
  return <aside className="show2006-audience-cue show2006-study-break" aria-label="Essay invitation">
    <span className="show2006-audience-cue-copy" role="status"><strong>STUDY BREAK!</strong> Pick a prompt and add a few lines to your 2006 reflection.</span>
    <button type="button" className="show2006-audience-cue-action" onClick={onOpenEssay}>Open essay</button>
    <button type="button" className="show2006-audience-cue-dismiss" onClick={onDismiss} aria-label="Dismiss essay invitation">×</button>
  </aside>;
}

export { ESSAY_PROMPTS };

export function MailApp({ onStartEssay }: { onStartEssay: () => void }) {
  return (
    <div className="mac2006-mail-app">
      <div className="mac2006-app-menu"><span>Mail</span><span>File</span><span>Edit</span><span>Message</span><span>Mailbox</span><span>Window</span><span>Help</span></div>
      <div className="mac2006-mail-toolbar" aria-label="Mail actions">
        <button type="button" disabled title="Your one assignment is already here"><span className="mail-action-icon get-mail" aria-hidden="true" />Get Mail</button>
        <button type="button" onClick={onStartEssay}><span className="mail-action-icon reply" aria-hidden="true" />Reply</button>
        <button type="button" disabled title="You can’t delete your homework"><span className="mail-action-icon delete" aria-hidden="true" />Delete</button>
      </div>
      <div className="mac2006-mail-layout">
        <nav className="mac2006-mailboxes" aria-label="Mailboxes">
          <strong>Mailboxes</strong>
          <button type="button" aria-current="page"><span className="mailbox-icon inbox" aria-hidden="true" />Inbox <em>1</em></button>
          <button type="button" onClick={onStartEssay}><span className="mailbox-icon drafts" aria-hidden="true" />Drafts</button>
          <button type="button" disabled><span className="mailbox-icon sent" aria-hidden="true" />Sent</button>
          <button type="button" disabled><span className="mailbox-icon trash" aria-hidden="true" />Trash</button>
        </nav>
        <div className="mac2006-mail-reader">
          <div className="mac2006-message-list" aria-label="Inbox messages">
            <button type="button" aria-current="true"><span className="unread-dot" aria-hidden="true" /><strong>Your Teacher</strong><span>Essay due!</span></button>
          </div>
          <article className="mac2006-email" aria-labelledby="essay-email-subject">
            <header>
              <h2 id="essay-email-subject">Essay due!</h2>
              <dl>
                <div><dt>From:</dt><dd>Your Teacher</dd></div>
                <div><dt>Subject:</dt><dd>Essay due!</dd></div>
                <div><dt>Due:</dt><dd>Before the show ends</dd></div>
              </dl>
            </header>
            <div className="mac2006-email-body">
              <p>Your 2006 reflection essay is due before the end of the show. Choose one prompt and start writing:</p>
              <ol>{ESSAY_PROMPTS.map((prompt) => <li key={prompt}>{prompt}</li>)}</ol>
              <button type="button" className="mac2006-aqua-button primary" onClick={onStartEssay}>Start Essay</button>
            </div>
          </article>
        </div>
      </div>
      <div className="mac2006-app-status">1 message, 1 unread</div>
    </div>
  );
}

export function TextEditApp({
  promptIndex, setPromptIndex, draft, setDraft, saved, saveError, onSave, paused = false, active = true,
  screenName, submission = null, submitting = false, submitError = null, onSubmit,
}: {
  promptIndex: number;
  setPromptIndex: (index: number) => void;
  draft: string;
  setDraft: (draft: string) => void;
  saved: boolean;
  saveError?: string | null;
  onSave: () => void;
  paused?: boolean;
  active?: boolean;
  screenName?: string;
  /** Tonight's published essay; once set, the document is final. */
  submission?: PublishedEssay | null;
  submitting?: boolean;
  submitError?: string | null;
  onSubmit?: () => void;
}) {
  const [helperVisible, setHelperVisible] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const typingLine = useTypingLines(draft, helperVisible && !submission);
  const shown = submission ? submission.body : draft;
  const wordCount = shown.trim() ? shown.trim().split(/\s+/).length : 0;
  const draftProblem = essayError(draft);

  return (
    <div className="mac2006-textedit-app">
      <div className="mac2006-app-menu"><span>TextEdit</span><span>File</span><span>Edit</span><span>Format</span><span>Window</span><span>Help</span></div>
      <div className="mac2006-textedit-toolbar">
        <label>
          <span>Essay prompt</span>
          <select value={promptIndex} disabled={Boolean(submission)} onChange={(event) => setPromptIndex(Number(event.target.value))}>
            {ESSAY_PROMPTS.map((prompt, index) => <option value={index} key={prompt}>{index + 1}. {prompt}</option>)}
          </select>
        </label>
        {!submission && <button type="button" className="mac2006-aqua-button" onClick={onSave}>Save Draft</button>}
        {onSubmit && !submission && (
          <button type="button" className="mac2006-aqua-button primary" disabled={submitting} aria-expanded={confirming}
            onClick={() => setConfirming(true)}>Submit essay</button>
        )}
      </div>
      {confirming && !submission && onSubmit && (
        <div className="show2006-essay-submit" role="group" aria-label="Submit your essay">
          {draftProblem ? <p>{draftProblem}</p> : (
            <p>Submitting publishes your essay with your screen name{screenName ? ` (${screenName})` : ''} for everyone at the show. It may be read aloud. You can’t change or delete it afterward.</p>
          )}
          <div>
            {!draftProblem && <button type="button" className="mac2006-aqua-button primary" disabled={submitting}
              onClick={() => { onSubmit(); }}>{submitting ? 'Submitting…' : 'Submit for everyone'}</button>}
            <button type="button" className="mac2006-aqua-button" disabled={submitting} onClick={() => setConfirming(false)}>{draftProblem ? 'OK' : 'Keep writing'}</button>
          </div>
        </div>
      )}
      {submission && (
        <p className="show2006-essay-submitted" role="status">Submitted as {submission.screenName}. Your essay is published for tonight’s show and can’t be changed.</p>
      )}
      <div className="mac2006-ruler" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span></div>
      <div className="mac2006-document-wrap">
        <div className="mac2006-document">
          <h2>2006 Reflection</h2>
          <p className="prompt">{submission ? submission.prompt : ESSAY_PROMPTS[promptIndex]}</p>
          <textarea value={shown} readOnly={Boolean(submission)} onChange={(event) => setDraft(event.target.value)}
            aria-label={submission ? 'Submitted essay' : 'Essay draft'} placeholder="Start writing here…" />
        </div>
      </div>
      {saveError && <p className="show2006-save-error" role="alert">{saveError}</p>}
      {submitError && <p className="show2006-save-error" role="alert">{submitError}</p>}
      {helperVisible && <EssayClippy mode={saved ? 'saved' : 'essay'} typingLine={saved ? null : typingLine} paused={paused} active={active}
        onHide={() => setHelperVisible(false)} />}
      <div className="mac2006-app-status">
        <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
        {!helperVisible && <button type="button" className="show2006-clippy-return" onClick={() => setHelperVisible(true)}>Bring back Clippy</button>}
        <span>{submission ? 'Submitted' : saved ? 'Saved on this computer' : 'Not saved'}</span>
      </div>
    </div>
  );
}

export function ClippyAssistant({
  mode, onOpenMail, onOpenEssay, onDismiss, paused = false,
}: {
  mode: ClippyMode;
  paused?: boolean;
  onOpenMail: () => void;
  onOpenEssay: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside className="mac2006-clippy" aria-label="Clippy assistant">
      <div className="mac2006-clippy-bubble">
        <button type="button" className="mac2006-clippy-close" aria-label="Dismiss Clippy" onClick={onDismiss} />
        <ClippyDialogue mode={mode} />
        <div className="show2006-clippy-actions">
          <button type="button" className="mac2006-aqua-button primary" onClick={onOpenEssay}>{mode === 'saved' ? 'Keep writing' : 'Open essay'}</button>
          <button type="button" className="mac2006-aqua-button" onClick={onOpenMail}>Check Mail</button>
          <button type="button" className="mac2006-aqua-button" onClick={onDismiss}>Not Now</button>
        </div>
      </div>
      <ClippyAnimation reaction={mode === 'saved' ? 'spin' : mode === 'essay' ? 'curious' : 'hello'} paused={paused} />
    </aside>
  );
}
