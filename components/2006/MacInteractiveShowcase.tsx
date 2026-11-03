'use client';

import { useState } from 'react';
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

/** Guest-controlled copy changes, with no timer or changes to their writing. */
function ClippyDialogue({ mode }: { mode: ClippyMode }) {
  const [line, setLine] = useState(0);
  const content = CLIPPY_DIALOGUE[mode];
  return <>
    <div className="show2006-clippy-copy" role="status" aria-atomic="true">
      <strong>{content.heading}</strong>
      <p>{content.lines[line % content.lines.length]}</p>
    </div>
    <button type="button" className="show2006-clippy-another" onClick={() => setLine(value => (value + 1) % content.lines.length)}>What else, Clippy?</button>
  </>;
}

/** Phone counterpart to the desktop helper, kept below the program picture. */
export function StudyBreakInvitation({ onOpenEssay, onDismiss }: { onOpenEssay: () => void; onDismiss: () => void }) {
  return <aside className="show2006-audience-cue show2006-study-break" aria-label="Essay invitation">
    <span className="show2006-audience-cue-copy" role="status"><strong>STUDY BREAK!</strong> Pick a prompt and add a few lines to your 2006 reflection.</span>
    <button type="button" className="show2006-audience-cue-action" onClick={onOpenEssay}>Open essay</button>
    <button type="button" className="show2006-audience-cue-dismiss" onClick={onDismiss} aria-label="Dismiss essay invitation">×</button>
  </aside>;
}

export const ESSAY_PROMPTS = [
  'Write about a song that made 2006 feel bigger than your bedroom.',
  'Describe the first online space where you felt like yourself.',
  'What did you think adulthood would look like in 2006?',
] as const;

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
}) {
  const [helperVisible, setHelperVisible] = useState(true);
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <div className="mac2006-textedit-app">
      <div className="mac2006-app-menu"><span>TextEdit</span><span>File</span><span>Edit</span><span>Format</span><span>Window</span><span>Help</span></div>
      <div className="mac2006-textedit-toolbar">
        <label>
          <span>Essay prompt</span>
          <select value={promptIndex} onChange={(event) => setPromptIndex(Number(event.target.value))}>
            {ESSAY_PROMPTS.map((prompt, index) => <option value={index} key={prompt}>{index + 1}. {prompt}</option>)}
          </select>
        </label>
        <button type="button" className="mac2006-aqua-button primary" onClick={onSave}>Save Draft</button>
      </div>
      {helperVisible ? <aside className="show2006-essay-clippy" aria-label="Clippy essay helper">
        <ClippyAnimation reaction={saved ? 'spin' : 'curious'} paused={paused} active={active} />
        <div>
          <ClippyDialogue mode={saved ? 'saved' : 'essay'} />
          <button type="button" className="mac2006-aqua-button" onClick={() => setHelperVisible(false)}>Hide Clippy</button>
        </div>
      </aside> : <button type="button" className="show2006-clippy-return" onClick={() => setHelperVisible(true)}>Bring back Clippy</button>}
      <div className="mac2006-ruler" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span></div>
      <div className="mac2006-document-wrap">
        <div className="mac2006-document">
          <h2>2006 Reflection</h2>
          <p className="prompt">{ESSAY_PROMPTS[promptIndex]}</p>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Essay draft" placeholder="Start writing here…" />
        </div>
      </div>
      {saveError && <p className="show2006-save-error" role="alert">{saveError}</p>}
      <div className="mac2006-app-status"><span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span><span>{saved ? 'Saved on this computer' : 'Not saved'}</span></div>
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
