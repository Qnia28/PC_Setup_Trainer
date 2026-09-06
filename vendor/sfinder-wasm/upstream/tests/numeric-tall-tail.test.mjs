import test from 'node:test';
import assert from 'node:assert/strict';
import {decoder} from 'tetris-fumen';
import {createWasmSolver} from '../src/wasm-backend.mjs';
import {boardFromFumenPage} from '../src/board.mjs';
import {expandPatternCases} from '../src/pattern.mjs';
import {collectCompactMinimals} from '../src/minimals-compact.mjs';
import {prepareCoverageMatrix} from '../src/highs-cardinality.mjs';
import {calculateMinimalsFeature} from '../src/minimals-wrapper.mjs';
import {BatchReachability,loadBatchWasm} from '../src/batch-backend.mjs';
const F='v115@9gglIeglHewwhlzhBexwzhEewwJeAgH';

test('compact pattern CSR owns its storage and exactly matches object API',async()=>{
 const solver=await createWasmSolver(4),cases=expandPatternCases('*p7;*p7'),queues=cases.map(c=>c.queue),board=boardFromFumenPage(decoder.decode(F)[0],4);
 try {
  const compact=solver.enumeratePcPatternCompact(board,queues,true),legacy=solver.enumeratePcPattern(board,queues,true);
  solver.enumeratePc(0n,'OOOOO',true); // Invalidate the native result workspace.
  const collected=collectCompactMinimals(compact,cases,''),qualityFor=(key,caseId)=>collected.qualityIndex.get(caseId).get(key);
  const a=prepareCoverageMatrix(collected.coverage,qualityFor),coverage=new Map(),quality=new Map();
  for(const row of legacy)for(const hit of row.coverage){const id=cases[hit.caseIndex].caseId;if(!coverage.has(id))coverage.set(id,new Set());coverage.get(id).add(row.key);quality.set(`${id}/${row.key}`,hit.orderCount)}
  const b=prepareCoverageMatrix(coverage,(key,id)=>quality.get(`${id}/${key}`));
  for(const k of ['keys','cases','primaryCases','entryCount','maxQuality'])assert.deepEqual(a[k],b[k],k);
  for(const row of legacy)assert.deepEqual(collected.byKey.get(row.key),{masks:row.masks,key:row.key,orderCount:row.orderCount,saved:row.saved});
 }finally{solver.close()}
});

test('numeric minimals preserves Fumen, quality budgets and save multiplicity',async()=>{
 const solver=await createWasmSolver(4);
 try {
  for(const wantedSave of ['', 'T','TT','/T/']) {
   const input={sourceFumen:F,pattern:'T,[^TIL]!,*p2',wantedSave,solver,fastStateBudget:1000};
   const compact=solver.enumeratePcPatternCompact;solver.enumeratePcPatternCompact=undefined;
   let old;try{old=await calculateMinimalsFeature(input)}catch(e){old=e.message}
   solver.enumeratePcPatternCompact=compact;
   let current;try{current=await calculateMinimalsFeature(input)}catch(e){current=e.message}
   assert.deepEqual(current,old,wantedSave);
  }
 }finally{solver.close()}
});

function normalize(board,height){let n=0;const rows=[];for(let y=0;y<height;y++){const r=(board>>BigInt(y*10))&1023n;if(r===1023n)n++;else rows.push(r)}let out=(1n<<BigInt(n*10))-1n;for(let i=0;i<rows.length;i++)out|=rows[i]<<BigInt((n+i)*10);return out}
test('tall last-piece shape and reduced legal oracle match independent lock geometry',async()=>{
 const e=await loadBatchWasm();let seed=41357;
 const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
 for(const height of [5,6]) {
  const a=await createWasmSolver(height),b=await createWasmSolver(height,{legal:false}),lock=new BatchReachability(e,height),full=(1n<<BigInt(height*10))-1n;
  try {
   assert.ok(a.legalMemoryBytes()>0&&a.legalMemoryBytes()<1000000);assert.equal(a.legalCount(7),0);
   const holes=[];
   for(let y=0;y<height;y++)for(let x=0;x<7;x++)holes.push(15n<<BigInt(y*10+x));
   for(let y=0;y<height-1;y++)for(let x=0;x<9;x++)holes.push(3075n<<BigInt(y*10+x));
   for(let i=0;i<160;i++){let mask=0n;while(mask.toString(2).replaceAll('0','').length<4)mask|=1n<<BigInt(random(height*10));holes.push(mask)}
   for(const hole of holes){const board=full^hole,normalized=normalize(board,height),target=full^normalized;
    for(const piece of 'IJLOSTZ') {
     const expected=lock.placeExact(normalized,piece,target)!==null;
     assert.equal(a.canPc(normalized,piece,false),expected,`${height}/${hole}/${piece}/oracle`);
     assert.equal(b.canPc(normalized,piece,false),expected,`${height}/${hole}/${piece}/shape`);
     if(expected){assert.deepEqual(a.enumeratePc(board,piece,false),b.enumeratePc(board,piece,false));}
    }
   }
  }finally{a.close();b.close()}
 }
});

test('reconstruction merges identical histories without changing distinct order count',async()=>{
 const solver=await createWasmSolver(6);
 try {const result=solver.enumeratePcPattern(0n,['O'.repeat(15)],true);assert.equal(result.length,1);assert.equal(result[0].orderCount,1);assert.equal(result[0].coverage[0].orderCount,1);assert.ok(solver.stats().reconstructionSkipped>0);assert.ok(solver.stats().reconstructionVisits<10000)}finally{solver.close()}
});
