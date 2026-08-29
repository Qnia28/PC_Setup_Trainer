import{lastBagInfo}from'./pattern.mjs';
import{popcount}from'./board.mjs';
import{MASK_PIECES}from'./tiling.mjs';
import { TETRIS_DISPLAY_ORDER } from './piece-order.mjs';

const ORDER=TETRIS_DISPLAY_ORDER;
const PIECE_BIT=Object.fromEntries([...ORDER].map((p,i)=>[p,1<<i]));
const ORDER_INDEX=Object.fromEntries([...ORDER].map((p,i)=>[p,i]));
const SOLUTION_INDEX=Object.fromEntries([...MASK_PIECES].map((p,i)=>[p,i]));
const expressionTables=new Map();
const bagInfoCache=new Map();

export const tetrisSort=s=>[...new Set(s)].sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b)).join('');

function resolveBagInfo(analysis){
  if(typeof analysis==='string'){
    let info=bagInfoCache.get(analysis);
    if(!info){info=lastBagInfo(analysis);bagInfoCache.set(analysis,info)}
    return info;
  }
  if(analysis?.pieces instanceof Set&&Number.isInteger(analysis.drawCount))return analysis;
  if(analysis?.lastBag?.pieces instanceof Set)return analysis.lastBag;
  throw new Error('missing last-bag metadata for save analysis');
}


export function prepareQueuePieceCounts(queue){
  const counts=new Uint8Array(7);
  for(const piece of queue){const index=ORDER_INDEX[piece];if(index!==undefined)counts[index]++}
  return counts;
}

export function prepareSolutionPieceCounts(solution){
  const counts=new Uint8Array(7);
  for(let oi=0;oi<7;oi++){
    const piece=ORDER[oi],si=SOLUTION_INDEX[piece];
    counts[oi]=si===undefined?0:popcount(solution.masks[si])/4;
  }
  return counts;
}

export function prepareSaveCase(queue,analysis){
  const{pieces,drawCount}=resolveBagInfo(analysis);
  let bagMask=0,drawnMask=0;
  for(const piece of pieces){const bit=PIECE_BIT[piece];if(bit)bagMask|=bit}
  const start=drawCount===0?0:Math.max(0,queue.length-drawCount);
  for(let i=start;i<queue.length;i++){const bit=PIECE_BIT[queue[i]];if(bit)drawnMask|=bit}
  return{queueCounts:prepareQueuePieceCounts(queue),baseSavedMask:bagMask&~drawnMask};
}

export function savedMaskPrepared(caseMeta,solutionCounts){
  let saved=caseMeta.baseSavedMask;
  for(let oi=0;oi<7;oi++)if(caseMeta.queueCounts[oi]>solutionCounts[oi])saved|=1<<oi;
  return saved&0x7f;
}

export function unusedPiecePrepared(queueCounts,solutionCounts){
  let saved=null,total=0;
  for(let oi=0;oi<7;oi++){
    const remaining=queueCounts[oi]-solutionCounts[oi];
    if(remaining<0)throw new Error(`solution uses more ${ORDER[oi]} pieces than queue provides`);
    if(remaining){total+=remaining;saved=ORDER[oi]}
  }
  if(total!==1)throw new Error(`expected exactly one saved piece, got ${total}`);
  return saved;
}

export function saveMaskToString(mask){let out='';for(let i=0;i<ORDER.length;i++)if(mask&(1<<i))out+=ORDER[i];return out}
export function saveStringToMask(save){let mask=0;for(const piece of save){const bit=PIECE_BIT[piece];if(bit)mask|=bit}return mask}

// Return the 7-bit save set directly.  Strings/Sets/Maps are only created at
// API boundaries now; the hot saves/minimals loops use this compact value.
export function savedMask(queue,solution,analysis){
  return savedMaskPrepared(prepareSaveCase(queue,analysis),prepareSolutionPieceCounts(solution));
}

export function savedString(queue,solution,analysis){return saveMaskToString(savedMask(queue,solution,analysis))}

function containsSubsequence(save,want){let i=0;for(const p of save){if(p===want[i])i++;if(i===want.length)return true}return want.length===0}
function evaluateSaveExpressionRaw(save,expr){
  expr=expr.trim();
  let depth=0;
  for(let i=0;i<expr.length-1;i++){
    if(expr[i]==='(')depth++;else if(expr[i]===')')depth--;else if(depth===0&&expr.slice(i,i+2)==='||')return evaluateSaveExpressionRaw(save,expr.slice(0,i))||evaluateSaveExpressionRaw(save,expr.slice(i+2));
  }
  depth=0;
  for(let i=0;i<expr.length-1;i++){
    if(expr[i]==='(')depth++;else if(expr[i]===')')depth--;else if(depth===0&&expr.slice(i,i+2)==='&&')return evaluateSaveExpressionRaw(save,expr.slice(0,i))&&evaluateSaveExpressionRaw(save,expr.slice(i+2));
  }
  if(expr.startsWith('!'))return!evaluateSaveExpressionRaw(save,expr.slice(1));
  if(expr.startsWith('(')&&expr.endsWith(')'))return evaluateSaveExpressionRaw(save,expr.slice(1,-1));
  if(expr.startsWith('/')&&expr.endsWith('/'))return new RegExp(expr.slice(1,-1)).test(save);
  const wanted=tetrisSort(expr.replace(/\^/g,''));
  const hit=containsSubsequence(save,wanted);
  return expr.startsWith('^')?!hit:hit;
}

// Save sets have only 2^7 possible values.  Compile each expression once and
// evaluate all future solutions with one 7-bit table lookup.
export function compileSaveExpression(expr){
  const key=String(expr).trim();
  let table=expressionTables.get(key);
  if(table)return table;
  table=new Uint8Array(128);
  for(let mask=0;mask<128;mask++)table[mask]=evaluateSaveExpressionRaw(saveMaskToString(mask),key)?1:0;
  expressionTables.set(key,table);
  return table;
}

// Keep the public string evaluator compatible while routing canonical Tetris
// save strings through the same precompiled truth table used by hot paths.
export function evaluateSaveExpression(save,expr){return!!compileSaveExpression(expr)[saveStringToMask(tetrisSort(save))]}
export function evaluateSaveMask(mask,expr){return!!compileSaveExpression(expr)[mask&0x7f]}
export function filterSolutionsForSave(queue,solutions,analysis,wanted){const table=compileSaveExpression(wanted);return solutions.filter(s=>!!table[savedMask(queue,s,analysis)])}
export function queueCanSave(queue,solutions,analysis,wanted){const table=compileSaveExpression(wanted);return solutions.some(s=>!!table[savedMask(queue,s,analysis)])}
