import assert from 'node:assert/strict';
import { partyResults } from '../lib/party-results';
import { castScores, type GameState } from '../lib/game-types';
import { renderResults, resultPages, validateResults } from '../public/2006/results/render.mjs';
const game:GameState={show:{id:'show',title:'Test night',status:'active',results_visible:false,suggestions_open:false},score:0,prompts:[
 {id:'award',show_id:'show',kind:'superlative',question:'Most 2006',status:'closed',results_visible:false,options:[{id:'mk',label:'mkashe9',count:3},{id:'jen',label:'SBconfetti',count:3}]},
 {id:'empty',show_id:'show',kind:'superlative',question:'Empty',status:'closed',results_visible:false,options:[{id:'mk',label:'MK',count:0}]},
 {id:'open',show_id:'show',kind:'superlative',question:'Unfinished',status:'open',results_visible:false,options:[{id:'mk',label:'MK',count:50}]},
 {id:'trivia',show_id:'show',kind:'trivia',question:'Q',status:'closed',results_visible:false,correct_option:'secret',options:[{id:'secret',label:'Right answer',count:1},{id:'wrong',label:'Other answer',count:2}]},
],scores:[{id:'private-viewer-id',name:'<script>alert(1)</script>',score:1},{id:'two',name:'Other',score:1}],cast:[{id:'mk',name:'mkashe9'},{id:'jen',name:'SBconfetti'}]};
game.castScores=castScores(game.prompts,game.cast!);
const data=partyResults(game); validateResults(data);
assert.equal(data.awards.length,1); assert.equal(data.awards[0].winners.length,2);
assert.equal(data.cast[0].score,1); assert.equal(data.cast[1].score,1);
assert.deepEqual(data.awards[0].winners.map(x=>x.name).sort(),['Jen','MK']);
assert.equal(data.triviaQuestions,1);
assert.ok(!JSON.stringify(data).includes('private-viewer-id'));assert.ok(!JSON.stringify(data).includes('secret'));
const pages=resultPages(data);const trivia=pages.at(-1)!;assert.deepEqual(trivia.rows.map((r:any)=>r.place),[1,1]);
assert.ok(renderResults(data,pages.length-1).includes('&lt;script&gt;'));assert.ok(!renderResults(data,pages.length-1).includes('<script>'));
for (const invalid of [{...data,type:'other'},{...data,trivia:[{name:'bad',score:99,art:null}]},{...data,cast:[{name:'bad',score:1,art:'../../secret'}]},{...data,capturedAt:'no'}]) assert.throws(()=>validateResults(invalid));
const empty=partyResults({...game,prompts:[],scores:[],castScores:[]});assert.equal(resultPages(empty).length,2);assert.match(renderResults(empty),/No closed/);
const many={...data,trivia:Array.from({length:14},(_,i)=>({name:'Guest '+i,score:i%2,art:null}))};assert.equal(resultPages(many).filter((p:any)=>p.title==='SuperFan').length,4);
console.log('PASS party results: closed rounds, ties, zero votes, original Sprite mapping, real trivia totals, export minimization, safe rendering, validation, empty states and pagination.');

assert.equal(data.rounds.length,3); // Include the closed zero-vote round, exclude open rounds.
assert.equal(data.rounds[0].options.length,2);
assert.ok(resultPages(data).some((p:any)=>p.title==='Empty'));
assert.throws(()=>validateResults({...data,rounds:[{kind:'trl',question:'Spoiler',options:[]}]}));

const question=data.rounds.find(r=>r.kind==='trivia')!;
assert.equal(question.correctCount,1);assert.equal(question.responses,3);
const questionPage=resultPages(data).findIndex((p:any)=>p.kind==='trivia');
assert.match(renderResults(data,questionPage),/person got it right/);
assert.match(renderResults(data,questionPage),/out of 3 answers/);
const awardPage=resultPages(data).findIndex((p:any)=>p.kind==='award');
assert.match(renderResults(data,awardPage),/JOINT WINNERS/);
assert.match(renderResults(data,awardPage),/party-plaque/);
assert.throws(()=>validateResults({...data,rounds:[{...question,correctCount:4}]}));
const zero={...data,rounds:[{...question,correctCount:0,responses:3}]};
assert.match(renderResults(zero,resultPages(zero).findIndex((p:any)=>p.kind==='trivia')),/people got it right/);
