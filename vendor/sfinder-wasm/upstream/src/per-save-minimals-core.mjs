import {placedCounts} from './tiling.mjs';
import {minimumCover} from './min-cover.mjs';
import {recordOrderCount,makeOrderCountQuality} from './human-ranking.mjs';

export const PER_SAVE_DISPLAY_ORDER='TILJSZO';
const RUST_PIECE_ORDER='IJLOSTZ';

function counter(sequence){
  const counts=new Map();
  for(const piece of sequence)counts.set(piece,(counts.get(piece)||0)+1);
  return counts;
}

function normalizeCases(queues){
  return queues.map((entry,index)=>typeof entry==='string'?{caseId:`legacy:${index}`,queue:entry}:entry);
}

export function unusedPieceForSolution(queue,solution){
  const available=counter(queue),used=placedCounts(solution),left=[];
  for(const piece of PER_SAVE_DISPLAY_ORDER){
    const remaining=(available.get(piece)||0)-(used.get(piece)||0);
    if(remaining<0)throw new Error(`solution uses more ${piece} pieces than queue provides`);
    for(let i=0;i<remaining;i++)left.push(piece);
  }
  if(left.length!==1)throw new Error(`expected exactly one saved piece, got ${left.length}`);
  return left[0];
}

export function perSaveLabel(piece,{pcSuccess,success,saveRate,guaranteed}){
  if(guaranteed)return `☆ Save ${piece}`;
  if(pcSuccess===0||saveRate===null)return `Save ${piece} (N/A)`;
  return `Save ${piece} (${(saveRate*100).toFixed(2)}%)`;
}

function directSingleQueueResult({board,cases,direct,displayOrder}){
  const entry=cases[0],bestByPiece=new Map();
  for(const solution of direct){
    const piece=RUST_PIECE_ORDER[solution.saved];
    if(piece)bestByPiece.set(piece,solution);
  }
  const pcSuccess=direct.length?1:0,results={};
  for(const piece of displayOrder){
    const solution=bestByPiece.get(piece),success=solution?1:0;
    const saveRate=pcSuccess===0?null:success/pcSuccess;
    const guaranteed=pcSuccess>0&&success===pcSuccess;
    const coverage=new Map();
    if(solution)coverage.set(entry.caseId,new Set([solution.key]));
    const data={
      piece,success,pcSuccess,total:1,saveRate,guaranteed,
      minimalCount:success,
      keys:solution?[solution.key]:[],
      solutions:solution?[solution]:[],
      coverageCounts:solution?[1]:[],
      coverage,
      humanQualityVector:solution?[solution.orderCount??0]:[],
      playableOrderCount:solution?Number(solution.orderCount??0):null,
    };
    data.label=perSaveLabel(piece,data);
    results[piece]=data;
  }
  return{board,queues:[entry.queue],total:1,pcSuccess,pcRate:pcSuccess,results};
}

export function calculatePerSaveMinimalsFromBoard({
  board,queues,solver,useHold=true,displayOrder=PER_SAVE_DISPLAY_ORDER,candidateLimit=16,
}){
  const cases=normalizeCases(queues);

  // New single-concrete-queue path. With the rebuilt WASM this bypasses
  // all-solution transfer, save regrouping, and set-cover entirely.
  if(cases.length===1&&typeof solver.perSaveBest==='function'){
    const direct=solver.perSaveBest(board,cases[0].queue,useHold,{candidateLimit});
    if(Array.isArray(direct))return directSingleQueueResult({board,cases,direct,displayOrder});
  }

  const coverageByPiece=new Map([...displayOrder].map(piece=>[piece,new Map()]));
  const byKey=new Map(),solutionsByQueue=new Map(),qualityIndex=new Map();
  let pcSuccess=0;

  const patternRows=cases.length>=24&&solver.height>=5&&typeof solver.enumeratePcPattern==='function'
    ?solver.enumeratePcPattern(board,cases.map(entry=>entry.queue),useHold):null;
  if(Array.isArray(patternRows)){
    const pcCases=new Set();
    for(const solution of patternRows){
      byKey.set(solution.key,solution);
      for(const hit of solution.coverage){
        const entry=cases[hit.caseIndex];
        if(!entry)throw new Error(`invalid pattern coverage case ${hit.caseIndex}`);
        pcCases.add(entry.caseId);
        recordOrderCount(qualityIndex,entry.caseId,{key:solution.key,orderCount:hit.orderCount});
        const saved=unusedPieceForSolution(entry.queue,solution);
        let keys=coverageByPiece.get(saved).get(entry.caseId);
        if(!keys){keys=new Set();coverageByPiece.get(saved).set(entry.caseId,keys)}
        keys.add(solution.key);
      }
    }
    pcSuccess=pcCases.size;
  }else{
    for(const entry of cases){
      let solutions=solutionsByQueue.get(entry.queue);
      if(!solutions){
        solutions=solver.enumeratePc(board,entry.queue,useHold);
        solutionsByQueue.set(entry.queue,solutions);
      }
      if(solutions.length===0)continue;
      pcSuccess++;

      for(const solution of solutions){
        byKey.set(solution.key,solution);
        recordOrderCount(qualityIndex,entry.caseId,solution);
        const saved=unusedPieceForSolution(entry.queue,solution);
        let keys=coverageByPiece.get(saved).get(entry.caseId);
        if(!keys){keys=new Set();coverageByPiece.get(saved).set(entry.caseId,keys)}
        keys.add(solution.key);
      }
    }
  }

  const qualityFor=makeOrderCountQuality(qualityIndex),results={};
  for(const piece of displayOrder){
    const coverage=coverageByPiece.get(piece),success=coverage.size;
    const saveRate=pcSuccess===0?null:success/pcSuccess;
    const guaranteed=pcSuccess>0&&success===pcSuccess;
    let minimalCount=0,keys=[],solutions=[],coverageCounts=[],humanQualityVector=[];

    if(success>0){
      const minimal=minimumCover(coverage,{qualityFor,solver});
      if(Number.isFinite(minimal.count)&&minimal.keys.length){
        minimalCount=minimal.count;
        keys=[...minimal.keys];
        solutions=keys.map(key=>byKey.get(key));
        coverageCounts=keys.map(key=>{
          let count=0;
          for(const set of coverage.values())if(set.has(key))count++;
          return count;
        });
        humanQualityVector=minimal.qualityVector??[];
      }
    }

    const data={piece,success,pcSuccess,total:cases.length,saveRate,guaranteed,minimalCount,keys,solutions,coverageCounts,coverage,humanQualityVector,playableOrderCount:cases.length===1&&solutions.length?humanQualityVector[0]??0:null};
    data.label=perSaveLabel(piece,data);
    results[piece]=data;
  }

  return{board,queues:cases.map(entry=>entry.queue),total:cases.length,pcSuccess,pcRate:cases.length===0?null:pcSuccess/cases.length,results};
}
