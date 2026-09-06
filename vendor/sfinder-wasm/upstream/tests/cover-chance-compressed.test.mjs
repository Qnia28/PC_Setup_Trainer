import test from 'node:test';
import assert from 'node:assert/strict';
import { encoder, Field } from 'tetris-fumen';
import { createPatternPrefixSource } from '../src/pattern-prefix-source.mjs';
import { expandPattern } from '../src/pattern.mjs';
import { createWasmSolver } from '../src/wasm-backend.mjs';
import { calculateChance, calculateChanceCount } from '../src/chance-feature.mjs';
import { calculateCover } from '../src/batch-cover-feature.mjs';
import { BatchReachability, loadBatchWasm } from '../src/batch-backend.mjs';
import { buildVariants, canQueueBuildOrder } from '../src/batch-orders.mjs';
const BOX = 'v115@9gC8GeC8GeC8GeC8QeAgH';
const GOLD = 'v115@ThR4BeBtCeR4zhBtKeAgH';
const bit = (x,y) => 1n << BigInt(y*10+x);

test('implicit bag prefixes exactly preserve constrained branches and suffix multiplicity', () => {
  const patterns = ['*!', '*p3;[IJLOSTZ]p3', '[^SZ]p3{I<T,T<L},[SZ]!', '[IOT]p2{I<T,T<O}', '[IOT]p2{I<I}', '[IOT]p3{I<T,T<I}', 'I,*p2,[SZ]p1'];
  for (const pattern of patterns) {
    const queues = expandPattern(pattern);
    for (let take=0;take<=Math.min(queues[0]?.length??3,4);take++) {
      const source = createPatternPrefixSource(pattern,take), expected = new Map(), actual = new Map();
      for (const q of queues) expected.set(q.slice(0,take),(expected.get(q.slice(0,take))??0n)+1n);
      for (const {queue,weight} of source.prefixes()) actual.set(queue,(actual.get(queue)??0n)+weight);
      assert.equal(source.total,BigInt(queues.length),pattern);
      assert.deepEqual(actual,expected,`${pattern}/${take}`);
    }
  }
});

test('count-only chance matches materialized chance, both Hold modes and streamed chunks', async () => {
  const solver = await createWasmSolver(4);
  try {
    for (const pattern of ['*!', 'I,*!', '*p4;*p4', '[IOT]p2{I<T},[JL]!', 'I,*!{T<I}']) for (const useHold of [false,true]) {
      const input={sourceFumen:BOX,pattern,solver,useHold};
      const expected=calculateChance(input), actual=calculateChanceCount({...input,maxBatchPrefixes:137});
      assert.deepEqual([actual.total,actual.success,actual.failed],[expected.total,expected.success,expected.failed],`${pattern}/${useHold}`);
      assert.equal('failedQueues' in actual,false);
    }
    const direct=calculateChance({sourceFumen:BOX,pattern:'*!',solver,outputMode:'count'});
    assert.equal(direct.total,5040);
    assert.throws(()=>calculateChanceCount({sourceFumen:BOX,pattern:'I',solver,maxBatchPrefixes:0}),RangeError);
  } finally { solver.close(); }
});

test('count-only handles unexpanded multi-bag totals beyond safe Number', async () => {
  // A completed board makes every suffix successful. No permutation enumeration.
  const field=Field.create('');for(let y=0;y<4;y++)for(let x=0;x<10;x++)field.set(x,y,'X');
  const sourceFumen=encoder.encode([{field}]), solver=await createWasmSolver(4);
  try {
    const result=calculateChanceCount({sourceFumen,pattern:'*!,*!,*!,*!,*!',solver});
    assert.equal(result.totalExact,(5040n**5n).toString());
    assert.equal(result.successExact,result.totalExact);
    assert.equal(typeof result.total,'string');
    assert.equal(result.evaluatedPrefixes,1);
    assert.equal(result.percent,100);
  } finally { solver.close(); }
});

test('Cover coverage-only preserves coverage for every mode, mirrors, duplicate cases',async()=>{
  const modes=['normal','tetris','tetris-end','1l','1l-or-pc','2l','2l-or-pc','3l','3l-or-pc','4l','4l-or-pc','tsm','tss','tsd','tst','b2b'];
  for (const mode of modes) for (const useHold of [false,true]) {
    const input={sourceFumen:GOLD,pattern:'*p3;*p3',mode,mirror:'yes',useHold};
    const expected=await calculateCover(input),actual=await calculateCover({...input,outputMode:'coverage'});
    assert.deepEqual([actual.covered,actual.failedQueues],[expected.covered,expected.failedQueues],`${mode}/${useHold}`);
    assert.ok(actual.targets.every(target=>!('variants' in target)&&!('orders' in target)));
  }
});

test('real active 5/6-line Rust Cover preserves complete JS traces and wide clear history', async()=>{
  const e=await loadBatchWasm();
  for(const height of [4,5,6]) for(const physics of ['jstris','tetrio']) {
    // Two horizontal I pieces in each row: every one of 5/6 rows clears during play.
    let base=0n;const operations=[];
    for(let y=0;y<height;y++) {
      base|=bit(8,y)|bit(9,y);
      for(const x of [0,4]) operations.push({piece:'I',mask:15n<<BigInt(y*10+x)});
    }
    const fast=new BatchReachability(e,height,physics);
    const legacy={placeExact:fast.placeExact.bind(fast),tSpinKind:fast.tSpinKind.bind(fast)};
    const input={base,operations,height};
    const a=buildVariants({...input,reachability:fast}),b=buildVariants({...input,reachability:legacy});
    const signature=vs=>vs.map(v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x)).sort();
    assert.ok(a.length>0);assert.deepEqual(signature(a),signature(b),`${height}/${physics}`);
    assert.equal(a[0].trace.reduce((s,t)=>s+t.clearLines,0),height);
    if(height===6)assert.equal(a[0].trace[11].clearLines,1);
    const cases=['I'.repeat(operations.length),'O'.repeat(operations.length),'I'.repeat(operations.length)];
    for(const useHold of [false,true]) {
      const all=fast.coverTarget({...input,cases,useHold}),only=fast.coverTarget({...input,cases,useHold,coverageOnly:true});
      assert.deepEqual(only.covered,all.covered);assert.deepEqual(only.covered,[true,false,true]);
    }
  }
});

test('15-operation coverage uses six active rows and exact Hold trie terminal semantics',async()=>{
 const fast=new BatchReachability(await loadBatchWasm(),6),operations=[];
 for(let y=0;y<6;y+=2)for(let x=0;x<10;x+=2)operations.push({piece:'O',mask:bit(x,y)|bit(x+1,y)|bit(x,y+1)|bit(x+1,y+1)});
 const cases=['O'.repeat(15),'I'+'O'.repeat(15),'O'.repeat(14),'O'.repeat(15),''];
 for(const useHold of [false,true]) {
   const result=fast.coverTarget({base:0n,operations,cases,useHold,coverageOnly:true});
   assert.deepEqual(result.covered,cases.map(q=>canQueueBuildOrder(q,'O'.repeat(15),useHold)));
 }
});
import {boardFromFumenPage} from '../src/board.mjs';
import {runWorkerRequest} from '../src/worker-runtime.mjs';
import {runBatchWorkerRequest} from '../src/batch-worker-runtime.mjs';
import {decoder} from 'tetris-fumen';

test('compressed language and forced budget fallback match exact legacy projection',async()=>{
 const solver=await createWasmSolver(4), board=boardFromFumenPage(decoder.decode(BOX)[0],4);
 const queues=[...expandPattern('*!'),...expandPattern('*p6').slice(0,31),'I','',...expandPattern('*!').slice(0,13)];
 try {
  for(const useHold of [false,true]) {
   solver.setProbabilityEngine('legacy');const expected=solver.canPcPatternMany(board,queues,useHold);
   solver.setProbabilityEngine('compressed');assert.deepEqual(solver.canPcPatternMany(board,queues,useHold),expected);
   assert.ok(solver.probabilityStats().languageNodes>0);assert.equal(solver.probabilityStats().budgetFallback,false);
   solver.setProbabilityEngine('compressed',{maxLanguageNodes:0});assert.deepEqual(solver.canPcPatternMany(board,queues,useHold),expected);
   assert.equal(solver.probabilityStats().budgetFallback,true);
  }
  assert.throws(()=>solver.setProbabilityEngine('bad'),RangeError);
 }finally{solver.close()}
});

test('worker dispatch forwards count-only chance and coverage-only Cover options',async()=>{
 const result=await runWorkerRequest({kind:'chance',input:{sourceFumen:BOX,pattern:'*!,*!',clear:4,outputMode:'count'}});
 assert.equal(result.totalExact,'25401600');assert.equal(result.successExact,'25401600');assert.equal('failedQueues' in result,false);
 const cover=await runBatchWorkerRequest({kind:'cover',input:{sourceFumen:GOLD,pattern:'*!',outputMode:'coverage'}});
 assert.equal(cover.covered,432);assert.ok(cover.targets.every(t=>!('variants' in t)));
});

test('large-pattern Hold refinement preserves failed-prefix weights and bag constraints',async()=>{
 const solver=await createWasmSolver(4);
 try {
  // 8 observed items leave six arbitrary permutations in the second full bag.
  const observed=calculateChance({sourceFumen:GOLD,pattern:'*!,*',solver});
  assert.ok(observed.failed>0 && observed.success>0);
  const counted=calculateChanceCount({sourceFumen:GOLD,pattern:'*!,*!;*!,*!',solver,maxBatchPrefixes:1024});
  assert.equal(counted.successExact,(BigInt(observed.success)*720n*2n).toString());
  assert.equal(counted.failedExact,(BigInt(observed.failed)*720n*2n).toString());
 } finally {solver.close()}
});

test('automatic compressed selection handles 168 million geometric paths without enumeration',async()=>{
 const solver=await createWasmSolver(6);
 try {
  assert.deepEqual(solver.canPcPatternMany(0n,['O'.repeat(15)],true),[true]);
  assert.deepEqual(solver.probabilityStats(),{geometryPaths:168168000,languageNodes:17,budgetFallback:false});
 }finally{solver.close()}
});
