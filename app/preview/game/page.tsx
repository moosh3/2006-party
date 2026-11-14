'use client';
import { useEffect, useState } from 'react';
import GameBoard from '@/components/game/GameBoard';
import type { GameState } from '@/lib/game-types';

const CAST = ['MK', 'Jen', 'Lip', 'Yongwoo', 'Emma', 'Alec'];
const cast = (counts?: number[]) => CAST.map((label, i) => ({ id: label.toLowerCase(), label, ...(counts ? { count: counts[i] } : {}) }));
const options = (labels: string[], counts?: number[]) => labels.map((label, i) => ({ id: `o${i}`, label, ...(counts ? { count: counts[i] } : {}) }));

const SAMPLE: GameState = {
  show: { id: 'preview', title: '2006: The Year, The Show', status: 'active', results_visible: true, suggestions_open: true },
  viewer: { id: 'viewer', name: 'xoSk8erGrl06', blocked: false },
  score: 2,
  prompts: [
    { id: 's1', show_id: 'preview', kind: 'superlative', status: 'open', results_visible: true, question: 'Most likely to have a MySpace Top 8 meltdown', options: cast([7, 12, 3, 5, 9, 2]) },
    { id: 's2', show_id: 'preview', kind: 'superlative', status: 'open', results_visible: false, question: 'Best away message', options: cast() },
    { id: 's3', show_id: 'preview', kind: 'superlative', status: 'closed', results_visible: true, question: 'Most likely to still own a Razr', answer: 'lip', options: cast([4, 6, 15, 8, 1, 6]) },
    { id: 't1', show_id: 'preview', kind: 'trivia', status: 'open', results_visible: false, question: 'Which video retired from TRL in 2006 after 50 days at number one?', options: options(['“Dance, Dance”', '“SOS”', '“Hips Don’t Lie”', '“Promiscuous”']) },
    { id: 't2', show_id: 'preview', kind: 'trivia', status: 'open', results_visible: false, question: 'What did Twitter call itself when it launched in 2006?', answer: 'o1', options: options(['Tweeter', 'twttr', 'Status', 'Chirp']) },
    { id: 't3', show_id: 'preview', kind: 'trivia', status: 'closed', results_visible: true, question: 'Which console launched with Wii Sports?', answer: 'o2', correct_option: 'o2', options: options(['PlayStation 3', 'Xbox 360', 'Wii', 'GameCube'], [3, 5, 31, 2]) },
    { id: 't4', show_id: 'preview', kind: 'trivia', status: 'closed', results_visible: true, question: 'Who was named Time’s Person of the Year for 2006?', answer: 'o0', correct_option: 'o3', options: options(['Tom from MySpace', 'Al Gore', 'Borat', 'You'], [9, 6, 4, 22]) },
  ],
};

/** Local demo of the audience game with sample questions. Votes stay in this tab. */
export default function GamePreviewPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const state: GameState = JSON.parse(JSON.stringify(SAMPLE));
    const real = window.fetch;
    window.fetch = async (input, init) => {
      if (!String(input).startsWith('/api/game')) return real(input, init);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.action === 'vote') {
          const prompt = state.prompts.find(p => p.id === body.promptId)!;
          for (const option of prompt.options) if (option.count !== undefined) option.count += Number(option.id === body.optionId) - Number(option.id === prompt.answer);
          prompt.answer = body.optionId;
        }
        return Response.json({ ok: true });
      }
      return Response.json(state);
    };
    setReady(true);
    return () => { window.fetch = real; };
  }, []);
  return <main className="game-standalone">{ready && <GameBoard screenName="xoSk8erGrl06" autoTriviaPopup={false} />}</main>;
}
