import type { GameState } from './game-types';
import { SPRITES } from './cast';
export function partyResults(game: GameState) {
  const sprite = (name:string) => SPRITES.find(s => [s.name,s.screenName].some(n=>n.toLowerCase()===name.toLowerCase()));
  const spriteFor = (name:string) => sprite(name)?.art || null;
  const castName = (name:string) => sprite(name)?.name || name;
  const awards = game.prompts.filter(p=>p.kind==='superlative' && p.status==='closed').flatMap(p=>{
    const max=Math.max(0,...p.options.map(o=>o.count||0));
    return max ? [{question:p.question,winners:p.options.filter(o=>o.count===max).map(o=>({name:castName(o.label),score:max,art:spriteFor(o.label)}))}] : [];
  });
  const rounds = game.prompts.filter(p=>(p.kind==='superlative' || p.kind==='trivia') && p.status==='closed').map(p=>({kind:p.kind, question:p.question, ...(p.kind==='trivia'?{responses:p.options.reduce((sum,o)=>sum+(o.count||0),0),correctCount:p.correct_option && p.options.some(o=>o.id===p.correct_option)?p.options.find(o=>o.id===p.correct_option)!.count||0:null}:{}), options:p.options.map(o=>({name:p.kind==='superlative'?castName(o.label):o.label,score:o.count||0,art:p.kind==='superlative'?spriteFor(o.label):null}))}));
  return {type:'2006-party-results',version:1,showTitle:game.show?.title || '2006',capturedAt:new Date().toISOString(),
    triviaQuestions:game.prompts.filter(p=>p.kind==='trivia' && p.status==='closed').length,
    trivia:[...(game.scores||[])].map(s=>({name:s.name,score:s.score,art:null})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)),
    cast:[...(game.castScores||[])].map(s=>({name:castName(s.name),score:s.score,art:spriteFor(s.name)})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)),awards,rounds};
}
export type PartyResults = ReturnType<typeof partyResults>;
