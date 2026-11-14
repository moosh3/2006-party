const sprites=[['mk','MK'],['jen','Jen'],['lip','Lip'],['yongwoo','Yongwoo'],['emma','Emma'],['alec','Alec']];
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function validateResults(data) {
 const text=(s,max)=>typeof s==='string' && s.length<=max;
 const row=r=>r && text(r.name,100) && Number.isSafeInteger(r.score) && r.score>=0 && r.score<=1000000 && (r.art===null || sprites.some(([id])=>id===r.art));
 if (!data || data.type!=='2006-party-results' || data.version!==1 || !text(data.showTitle,120) || !text(data.capturedAt,40) || !Number.isFinite(Date.parse(data.capturedAt)) || !Number.isSafeInteger(data.triviaQuestions) || data.triviaQuestions<0 || data.triviaQuestions>200 || !Array.isArray(data.trivia) || data.trivia.length>5000 || !data.trivia.every(r=>row(r)&&r.score<=data.triviaQuestions) || !Array.isArray(data.cast) || data.cast.length>30 || !data.cast.every(row) || !Array.isArray(data.awards) || data.awards.length>200 || !data.awards.every(a=>a && text(a.question,300) && Array.isArray(a.winners) && a.winners.length>0 && a.winners.length<=30 && a.winners.every(row))) throw new Error('Choose a valid results export from the online game desk.');
 if (data.rounds!==undefined && (!Array.isArray(data.rounds) || data.rounds.length>200 || !data.rounds.every(r=>r && ['superlative','trivia'].includes(r.kind) && text(r.question,300) && Array.isArray(r.options) && r.options.length<=100 && r.options.every(row)))) throw new Error('Choose a valid results export from the online game desk.');
 if (data.rounds?.some(r=>r.kind==='trivia' && ((r.responses!==undefined && (!Number.isSafeInteger(r.responses)||r.responses<0)) || (r.correctCount!==undefined && r.correctCount!==null && (!Number.isSafeInteger(r.correctCount)||r.correctCount<0||!Number.isSafeInteger(r.responses)||r.correctCount>r.responses))))) throw new Error('Invalid trivia totals.');
 return data;
}
export function resultPages(data) {
 const pages=[];
 const ranked=rows=>[...rows].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((r,i,list)=>({...r,place:list.findIndex(x=>x.score===r.score)+1}));
 const group=(title,unit,rows,empty,pageSize=6)=>{
  const sorted=ranked(rows);
  if (!sorted.length) pages.push({title,unit,rows:[],empty});
  for(let i=0;i<sorted.length;i+=pageSize) pages.push({title,unit,rows:sorted.slice(i,i+pageSize),empty});
 };
 group('Most 2006er','awards won',data.cast,'No closed superlative results yet.');
 if(data.rounds) {
  for(const round of data.rounds) {
   if(round.kind==='trivia') pages.push({title:round.question,kind:'trivia',rows:[],correctCount:round.correctCount??null,responses:round.responses??null});
   else {const max=Math.max(0,...round.options.map(o=>o.score));pages.push({title:round.question,kind:'award',rows:max?round.options.filter(o=>o.score===max):[]});}
  }
 } else for(const award of data.awards) pages.push({title:award.question,kind:'award',rows:award.winners});
 group('SuperFan','correct answers',data.trivia,data.triviaQuestions?'No trivia answers were submitted.':'No trivia rounds have closed yet.',4);
 return pages;
}
const star = '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#ffd91c" stroke="#fff58c" stroke-width="2" d="m32 3 8 19 21 2-16 14 5 22-18-11-18 11 5-22L3 24l21-2Z"/><path fill="#fff59a" d="m32 3 0 29-18 28 5-22L3 24l21-2Z" opacity=".65"/><path fill="#e8a416" d="m32 32 18 28-5-22 16-14Z"/></svg>';
const coin = '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="32" rx="23" ry="29" fill="#e8ae00" stroke="#fff991" stroke-width="2"/><ellipse cx="29" cy="31" rx="20" ry="27" fill="#ffe422"/><path d="m29 11 5 12 12 1-9 8 3 14-11-7-10 7 3-14-9-8 12-1Z" fill="#fffa6b"/><path d="M18 12Q6 31 18 49" fill="none" stroke="#ffffa2" stroke-width="3"/></svg>';
export function renderResults(data,pageIndex=0) {
 const pages=resultPages(data), index=Math.min(Math.max(0,pageIndex),pages.length-1), page=pages[index];
 const ordinal=n=>n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th');
 const icon=page.unit==='awards won'?star:coin;
 const letters=[...'RESULTS'].map((letter,i)=>`<span style="--tilt:${[-12,3,-7,-12,5,9,-8][i]}deg">${letter}</span>`).join('');
 const rows=page.rows.map(r=>`<div class="party-row" data-place="${r.place}" data-leading="${r.place===1 && r.score>0}"><span class="party-place">${r.place}<small>${ordinal(r.place)}</small></span><span class="party-portrait">${r.art?`<img src="/2006/cast/${r.art}.png" alt="">`:'<span aria-hidden="true">★</span>'}</span><span class="party-name">${escape(r.name)}</span><span class="party-value"><b>${icon}</b><span class="party-times" aria-hidden="true">×</span>${r.score}</span></div>`).join('');
 const plaque=page.kind==='award'?`<section class="party-plaque"><div class="party-award-seal">${star}</div><p class="party-kicker">${page.rows.length>1?'JOINT WINNERS':'THE AWARD GOES TO'}</p><h3>${escape(page.title)}</h3><div class="party-winners">${page.rows.map(r=>`<div class="party-winner">${r.art?`<span class="party-portrait"><img src="/2006/cast/${r.art}.png" alt=""></span>`:''}<strong>${escape(r.name)}</strong></div>`).join('')||'<p>No winner — no votes were cast.</p>'}</div><p class="party-award-caption">${page.rows.length?'As voted by the online crowd':''}</p></section>`:'';
 const trivia=page.kind==='trivia'?`<section class="party-trivia"><p class="party-kicker">TRIVIA · DID YOU KNOW IT?</p><h3>${escape(page.title)}</h3><div class="party-trivia-reveal"><div class="party-reveal-wait">The crowd has answered…</div><div class="party-reveal-answer">${page.correctCount===null?'<p>Correct-answer total unavailable.<br>Export updated results from the game desk.</p>':`<strong>${page.correctCount}</strong><p>${page.correctCount===1?'person got it right':'people got it right'}</p><small>out of ${page.responses} ${page.responses===1?'answer':'answers'}</small>`}</div></div></section>`:'';
 const table=`<section class="party-table"><h3 class="party-table-title"><span>${escape(page.title)}</span><small>${escape(page.unit||'')}</small></h3><div class="party-rows">${rows||`<p class="party-empty">${escape(page.empty||'')}</p>`}</div></section>`;
 return `<section class="party-results${!page.kind&&page.rows.length>4?' party-results-six':''}" aria-label="Show results"><div class="party-water" aria-hidden="true"></div><div class="party-stage"><header><h2 aria-label="Results"><i aria-hidden="true">✦</i>${letters}<i aria-hidden="true">✦</i></h2></header>${plaque||trivia||table}<footer><strong><b aria-hidden="true">A</b> Continue</strong><span>${index+1} / ${pages.length}</span></footer><p class="party-show-title">${escape(data.showTitle)}</p></div></section>`;
}
