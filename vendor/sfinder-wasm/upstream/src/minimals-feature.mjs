import{decoder}from'tetris-fumen';
import{boardFromFumenPage}from'./board.mjs';
import{expandPatternCases}from'./pattern.mjs';
import{compileSaveExpression,filterSolutionsForSave,savedMask}from'./saves.mjs';
import{minimumCover}from'./min-cover.mjs';
import{recordOrderCount,makeOrderCountQuality}from'./human-ranking.mjs';
import{encodePages}from'./fumen.mjs';

function calculatePatternBatch({board,cases,wantedSave,solver,useHold,coverage,byKey,qualityIndex}){
  if(cases.length<24||solver.height<5||typeof solver.enumeratePcPattern!=='function')return null;
  const rows=solver.enumeratePcPattern(board,cases.map(x=>x.queue),useHold);
  if(!Array.isArray(rows))return null;
  const table=compileSaveExpression(wantedSave);
  for(const solution of rows){
    byKey.set(solution.key,solution);
    for(const hit of solution.coverage){
      const entry=cases[hit.caseIndex];
      if(!entry)throw new Error(`invalid pattern coverage case ${hit.caseIndex}`);
      if(!entry.lastBag)throw new Error(`save analysis branch ${entry.branchIndex+1} does not end in a bag token`);
      if(!table[savedMask(entry.queue,solution,entry.lastBag)])continue;
      let keys=coverage.get(entry.caseId);if(!keys){keys=new Set();coverage.set(entry.caseId,keys)}
      keys.add(solution.key);
      recordOrderCount(qualityIndex,entry.caseId,{key:solution.key,orderCount:hit.orderCount});
    }
  }
  return coverage.size;
}

export function calculateSaveMinimals({sourceFumen,analysisPattern,wantedSave,solver,useHold=true,height=4}){
  const board=boardFromFumenPage(decoder.decode(sourceFumen)[0],height);
  const cases=expandPatternCases(analysisPattern),queues=cases.map(x=>x.queue),coverage=new Map(),byKey=new Map(),solutionCache=new Map(),qualityIndex=new Map();
  let saveSuccess=calculatePatternBatch({board,cases,wantedSave,solver,useHold,coverage,byKey,qualityIndex});
  if(saveSuccess===null){
    saveSuccess=0;
    for(const entry of cases){
      let sols=solutionCache.get(entry.queue);
      if(!sols){sols=solver.enumeratePc(board,entry.queue,useHold);solutionCache.set(entry.queue,sols)}
      for(const s of sols){byKey.set(s.key,s);recordOrderCount(qualityIndex,entry.caseId,s)}
      if(!entry.lastBag)throw new Error(`save analysis branch ${entry.branchIndex+1} does not end in a bag token`);
      const filtered=filterSolutionsForSave(entry.queue,sols,entry.lastBag,wantedSave);
      if(filtered.length){saveSuccess++;coverage.set(entry.caseId,new Set(filtered.map(s=>s.key)))}
    }
  }
  const min=minimumCover(coverage,{qualityFor:makeOrderCountQuality(qualityIndex),solver});
  if(!Number.isFinite(min.count)||!min.keys.length)throw new Error('no minimal');
  const keys=[...min.keys],solutions=keys.map(k=>byKey.get(k));
  const coverageCounts=keys.map(k=>{let n=0;for(const set of coverage.values())if(set.has(k))n++;return n});
  return{board,height,cases,queues,coverage,saveSuccess,minimalCount:min.count,keys,solutions,coverageCounts,humanQualityVector:min.qualityVector??[]};
}
export function encodeSaveMinimalFumen(c){const comments=c.coverageCounts.map(n=>`${(n/c.queues.length*100).toFixed(2)}% (${n}/${c.queues.length})`);return encodePages(c.board,c.solutions,comments,c.height??4)}
