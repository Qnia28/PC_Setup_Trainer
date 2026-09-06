import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decoder} from 'tetris-fumen';
import {boardFromFumenPage} from '../src/board.mjs';
import {expandPattern} from '../src/pattern.mjs';
import {createWasmSolver} from '../src/wasm-backend.mjs';
import {solveQueuesExistence} from '../src/pc-enumeration-engine.mjs';

test('existence deduplicates before routing and preserves multiplicity and order',()=>{
 const calls=[];
 const solver={height:4,canPcPatternMany(){throw Error('duplicate count must not select pattern');},
  canPcManyScalar(board,queues){calls.push(queues);return queues.map(q=>q==='I');}};
 const queues=Array.from({length:5040},(_,i)=>i%3?'I':'O');
 assert.deepEqual(solveQueuesExistence({board:0n,queues,solver}),queues.map(q=>q==='I'));
 assert.deepEqual(calls,[['O','I']]);
});

test('bounded probes are tri-state, enforce node budgets and never poison later exact calls',async()=>{
 const queues=expandPattern('*p7');
 for(const height of [4,5,6]){
  const fumen=height===4?'v115@DhD8FeD8FeD8FeD8JeAgH':'v115@zgB8GeC8GeE8EeD8DeG8AeE8JeAgH';
  let board=boardFromFumenPage(decoder.decode(fumen)[0],height===6?5:height);
  if(height===6)board=(board<<10n)|1023n;
  const solver=await createWasmSolver(height),oracle=await createWasmSolver(height);
  try {
   for(const hold of [false,true])for(const index of [0,17,123,700,1337,2400,4095,5039]){
    const queue=queues[index],exact=oracle.canPc(board,queue,hold);
    for(const budget of [0,1,8,256,4096]){
     const p=solver.probeCanPc(board,queue,hold,budget);
     assert.ok(p.nodes<=budget);if(p.completed)assert.equal(p.value,exact);
    }
    assert.equal(solver.canPc(board,queue,hold),exact);
   }
  }finally{solver.close();oracle.close();}
 }
});

test('tall adaptive routing reuses completed probes and retries unknown queues exactly',()=>{
 const queues=Array.from({length:64},(_,i)=>'I'.repeat(i+1));
 const visited=new Set();let patternCalls=0;
 const solver={height:5,
  probeCanPc(board,queue){visited.add(queue);return visited.size===2?{completed:false,nodes:256}:{completed:true,value:true,nodes:256};},
  canPcManyScalar(board,pending){assert.ok(!pending.includes([...visited][0]));assert.ok(pending.includes([...visited][1]));return pending.map(()=>false);},
  canPcPatternMany(){patternCalls++;return [];}};
 const result=solveQueuesExistence({board:0n,queues,solver});
 assert.equal(result.filter(Boolean).length,1);assert.equal(patternCalls,0); // Sparse multiset groups.
});

test('byte-budget eviction retains entries, preserves results and invalidates legal entries',async()=>{
 const solver=await createWasmSolver(4),reference=await createWasmSolver(4);
 const board=boardFromFumenPage(decoder.decode('v115@DhD8FeD8FeD8FeD8JeAgH')[0],4);
 const queues=expandPattern('*p7').slice(0,64);
 try {
  const expected=reference.canPcManyScalar(board,queues,true);
  assert.deepEqual(solver.canPcManyScalar(board,queues,true),expected);
  const before=solver.stats();assert.ok(before.cacheEntries>100);
  solver.setPlacementCacheBudget(8192);
  const after=solver.stats();
  assert.ok(after.cacheEntries>0&&after.cacheEntries<before.cacheEntries);
  assert.ok(after.cacheEstimatedBytes<=8192*3/4);assert.ok(after.cacheEvictions>0);
  assert.deepEqual(solver.canPcManyScalar(board,queues,true),expected);
  assert.throws(()=>solver.setPlacementCacheBudget(0));
  solver.loadLegal(await readFile(new URL('../wasm/legal_boards_4.lgb',import.meta.url)));
  assert.equal(solver.stats().cacheEntries,0);
  assert.equal(solver.stats().cacheEstimatedBytes,0);
  assert.deepEqual(solver.canPcManyScalar(board,queues,true),expected);
 }finally{solver.close();reference.close();}
 const tall=await createWasmSolver(5),tallReference=await createWasmSolver(5);
 try{
  tall.setPlacementCacheBudget(8192);
  const tallBoard=boardFromFumenPage(decoder.decode('v115@zgB8GeC8GeE8EeD8DeG8AeE8JeAgH')[0],5);
  assert.deepEqual(tall.canPcManyScalar(tallBoard,queues.slice(0,8),true),tallReference.canPcManyScalar(tallBoard,queues.slice(0,8),true));
  assert.ok(tall.stats().cacheEvictions>0);
 }finally{tall.close();tallReference.close();}
});

test('pattern placement cache above the old entry cliff survives the next request',async()=>{
 const solver=await createWasmSolver(4),queues=expandPattern('*p7');
 const board=boardFromFumenPage(decoder.decode('v115@DhD8FeD8FeD8FeD8JeAgH')[0],4);
 try{
  const first=solver.canPcPatternMany(board,queues,true),before=solver.stats();
  assert.ok(before.cacheEntries>32768);
  assert.deepEqual(solver.canPcPatternMany(board,queues,true),first);
  assert.equal(solver.stats().cacheMisses,before.cacheMisses);
 }finally{solver.close();}
});
