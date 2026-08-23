import{decoder}from'tetris-fumen';
import{boardFromFumenPage}from'./board.mjs';
import{expandPatternCases}from'./pattern.mjs';
import{filterSolutionsForSave,queueCanSave}from'./saves.mjs';
import{minimumCover}from'./min-cover.mjs';
import{recordOrderCount,makeOrderCountQuality}from'./human-ranking.mjs';
import{combineWithIntro,solutionPage}from'./fumen.mjs';
export const FIFTH_PIECES='TILJSZO',FIFTH_DISPLAY_ORDER='SZOLJIT',FIFTH_BESTSAVE_PIECES='ILJSZO';
export const fifthSaveCondition=p=>[...FIFTH_PIECES].filter(x=>x!==p).join('');

function caseSeesPiece(entry,piece){
  const n=(entry.observedBag??entry.lastBag)?.drawCount??0;
  return n>0&&entry.queue.slice(-n).includes(piece);
}

export function fifthMinimalsPerSaves({sourceFumen,analysisPattern,solver,useHold=true}){
  const board=boardFromFumenPage(decoder.decode(sourceFumen)[0]),cases=expandPatternCases(analysisPattern),queues=cases.map(x=>x.queue),all=new Map(),solutionCache=new Map(),byKey=new Map(),qualityIndex=new Map();
  for(const entry of cases){
    if(!entry.lastBag)throw new Error(`5th analysis branch ${entry.branchIndex+1} does not end in a bag token`);
    let sols=solutionCache.get(entry.queue);
    if(!sols){sols=solver.enumeratePc(board,entry.queue,useHold);solutionCache.set(entry.queue,sols)}
    all.set(entry.caseId,sols);
    for(const s of sols){byKey.set(s.key,s);recordOrderCount(qualityIndex,entry.caseId,s)}
  }
  const qualityFor=makeOrderCountQuality(qualityIndex),usages={},results={};
  for(const p of FIFTH_DISPLAY_ORDER){
    const want=fifthSaveCondition(p),coverage=new Map();let success=0,seen=0;
    for(const entry of cases){
      if(!caseSeesPiece(entry,p))continue;
      seen++;
      const sols=all.get(entry.caseId)??[];
      if(queueCanSave(entry.queue,sols,entry.lastBag,want))success++;
      const f=filterSolutionsForSave(entry.queue,sols,entry.lastBag,want);
      if(f.length)coverage.set(entry.caseId,new Set(f.map(s=>s.key)));
    }
    const availability=seen?success/seen:0,isSee=seen>0&&success===seen,label=isSee?`See ${p}`:`Use ${p}`;
    usages[p]={piece:p,success,total:queues.length,seen,availability,isSee,label};
    if(success){
      const m=minimumCover(coverage,{qualityFor,solver}),keys=[...m.keys].sort();
      results[p]={minimalCount:m.count,keys,solutions:keys.map(k=>byKey.get(k)),humanQualityVector:m.qualityVector??[]};
    }else results[p]={minimalCount:0,keys:[],solutions:[],humanQualityVector:[]};
  }
  const bestsave=[...FIFTH_BESTSAVE_PIECES].every(p=>usages[p].isSee);
  return{board,cases,queues,all,usages,results,bestsave};
}
export function encodeFifthCombined({sourceFumen,title,calculation:c}){const pages=[],pageCounts={};for(const p of FIFTH_DISPLAY_ORDER){const r=c.results[p];pageCounts[p]=r.solutions.length;for(const s of r.solutions){const u=c.usages[p],comment=u.isSee?`☆ ${u.label}`:u.label;pages.push(solutionPage(c.board,s,comment))}}return{fumen:combineWithIntro(sourceFumen,title,pages),pageCounts}}
