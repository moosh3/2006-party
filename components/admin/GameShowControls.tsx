'use client';

import type { GameState } from '@/lib/game-types';
import { SHOW_INVITATIONS, type ShowInvitationKind } from '@/lib/show-invitations';
import { superlativeActions, triviaActions } from '@/lib/game-desk';
import './game-desk.css';

export default function GameShowControls({ data, disabled, act, onSetup }: {
  data: GameState | null;
  disabled: boolean;
  act: (actions: Record<string, unknown> | Record<string, unknown>[], notice?: string) => Promise<boolean>;
  onSetup: () => void;
}) {
  if (!data) return null;
  const show = data.show;
  if (!show) return <div className="desk-empty"><h2>Ready for tonight?</h2><p>Choose the night and prepare your questions in Setup.</p><button onClick={onSetup}>Set up tonight</button></div>;
  if (show.status !== 'active') return <div className="desk-empty">
    <h2>{show.title}</h2><p>This night is finished. Its answers and scores are saved.</p>
    <div className="game-admin-actions">
      {!show.results_visible && <button disabled={disabled} onClick={() => void act({ action: 'reveal_show' })}>Show final game results</button>}
      <button onClick={onSetup}>Set up the next night</button>
    </div>
  </div>;
  const questions = data.prompts.filter(p => p.kind === 'trivia');
  const openTrivia = triviaActions(questions, 'open');
  const closeTrivia = triviaActions(questions, 'close_reveal');
  const answering = questions.filter(p => p.status === 'open').length;
  const awards = data.prompts.filter(p => p.kind === 'superlative');
  const toOpen = superlativeActions(awards, 'open');
  const toClose = superlativeActions(awards, 'close');
  const toReveal = superlativeActions(awards, 'reveal');
  return <div className="desk-showtime">
    <p className="desk-night"><strong>{show.title}</strong><span>Show time</span></p>
    <section className="desk-cue-row" aria-labelledby="desk-messages">
      <div><h2 id="desk-messages">On screen</h2><p>Show a message beside the video.</p></div>
      <div>
        <div className="desk-message-buttons">
          {(Object.keys(SHOW_INVITATIONS) as ShowInvitationKind[]).map(kind => (
            <button key={kind} disabled={disabled} onClick={() => void act({ action: 'audience_invitation', invitation: kind }, 'Message sent to viewers.')}>
              {data.invitation?.kind === kind ? 'Resend: ' : ''}{SHOW_INVITATIONS[kind].label}
            </button>
          ))}
          <button disabled={disabled || !data.invitation} onClick={() => void act({ action: 'audience_invitation', invitation: 'clear' }, 'On-screen message cleared.')}>Clear message</button>
        </div>
        <p className="desk-status" role="status">{data.invitation ? `Showing: ${SHOW_INVITATIONS[data.invitation.kind].label}` : 'No message showing.'}</p>
      </div>
    </section>
    <section className="desk-cue-row" aria-labelledby="desk-trivia">
      <div><h2 id="desk-trivia">Trivia</h2><p>The full list under the video. Guests answer at their own pace.</p></div>
      <div>
        {questions.length ? <>
          <p className="desk-status">{answering} open · {questions.filter(p => p.status === 'draft').length} ready · {questions.filter(p => p.status === 'closed').length} closed</p>
          <div className="game-admin-actions">
            {openTrivia.length > 0 && <button className="desk-primary" disabled={disabled} onClick={() => void act(openTrivia, 'The full trivia list is open under the video.')}>
              {answering ? 'Open remaining trivia' : 'Open trivia'}
            </button>}
            {closeTrivia.length > 0 && <button className="desk-primary" disabled={disabled} onClick={() => void act(closeTrivia, 'Trivia is closed. Answers are showing and scores are updated.')}>
              {answering ? 'Close trivia & show answers' : 'Show trivia answers'}
            </button>}
          </div>
          {answering > 0 && <p className="desk-status">Leave the list open until you’re ready to reveal the answers.</p>}
          {!openTrivia.length && !closeTrivia.length && <p className="desk-status">Trivia is finished. Guests can see the answers in the list.</p>}
          <details className="desk-details"><summary>View questions in tonight’s order</summary>
            <ol>{questions.map(p => <li key={p.id}>{p.question} <span className="desk-status">({p.status === 'draft' ? 'private' : p.status})</span></li>)}</ol>
          </details>
        </> : <>
          <p>No trivia prepared yet.</p>
          <button onClick={onSetup}>Prepare trivia</button>
        </>}
      </div>
    </section>
    <section className="desk-cue-row" aria-labelledby="desk-superlatives">
      <div><h2 id="desk-superlatives">Superlatives</h2><p>The audience votes for your cast here.</p></div>
      <div>
        <p className="desk-status">{awards.length ? `${toClose.length} open · ${toOpen.length} ready · ${awards.filter(p => p.status === 'closed').length} closed` : 'No categories prepared yet.'}</p>
        <div className="game-admin-actions">
          {toOpen.length > 0 && <button className="desk-primary" disabled={disabled} onClick={() => void act(toOpen, 'Prepared superlatives are open.')}>
            {toClose.length ? 'Open remaining superlatives' : 'Open superlatives'}
          </button>}
          {toClose.length > 0 && <button className="desk-primary" disabled={disabled} onClick={() => void act(toClose, 'Superlative voting is closed.')}>Close superlatives</button>}
          {!toClose.length && toReveal.length > 0 && <button className="desk-primary" disabled={disabled} onClick={() => void act(toReveal, 'Superlative results are showing.')}>Show superlative results</button>}
          {!awards.length && <button onClick={onSetup}>Prepare superlatives</button>}
        </div>
        {toClose.length > 0 && <p className="desk-status">Leave voting open during the show. Close it when you’re ready to count the winners.</p>}
        {!!awards.length && <details className="desk-details">
          <summary>View categories and totals</summary>
          {awards.map(p => <div className="desk-award" key={p.id}><h3>{p.question}</h3><p className="desk-status">{p.status}{p.results_visible ? ' · results showing' : ' · results hidden'}</p><ul>{p.options.map(o => <li key={o.id}>{o.label}: {o.count || 0}</li>)}</ul></div>)}
        </details>}
      </div>
    </section>
    <p className="desk-external">Music-video voting happens on your other website. Use its final ranking to arrange the countdown videos.</p>
    <details className="desk-details desk-finish">
      <summary>Finish tonight</summary>
      <p>Close all remaining game rounds and save tonight’s scores. Video playback continues separately.</p>
      <button className="danger" disabled={disabled} onClick={() => {
        if (window.confirm('Finish tonight’s game? All open rounds will close and no more answers will be accepted.')) void act({ action: 'finish' }, 'Tonight’s game is finished.');
      }}>End game and calculate winners</button>
    </details>
  </div>;
}
