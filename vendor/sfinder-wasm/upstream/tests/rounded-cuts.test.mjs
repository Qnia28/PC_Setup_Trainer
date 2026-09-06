import test from 'node:test';
import assert from 'node:assert/strict';
import {generateTripleCuts} from '../src/min-cover-rounded-cuts.mjs';
import {solveCardinality, normalizePrimaryProof} from '../src/highs-cardinality.mjs';
import {runWorkerRequest} from '../src/worker-runtime.mjs';

test('rounded cuts preserve every integer cover including columns covering all three rows',()=>{
  const rows=[[0,3,4,6],[1,3,5,6],[2,4,5,6]];
  const x=[0,0,0,.5,.5,.5,0];
  const {cuts}=generateTripleCuts(rows,7,x,{samples:100});
  assert.equal(cuts.length,1);
  assert.deepEqual(cuts[0].terms.find(([id])=>id===6),[6,2]);
  let checked=0;
  for(let mask=0;mask<128;mask++)if(rows.every(r=>r.some(j=>mask&(1<<j)))){
    for(const c of cuts)assert.ok(c.terms.reduce((s,[j,a])=>s+(mask&(1<<j)?a:0),0)>=c.rhs);
    checked++;
  }
  assert.equal(checked,109);
  assert.deepEqual(generateTripleCuts(rows.map(r=>[...r,...r]),7,x,{samples:100}).cuts,cuts);
});

test('proof option keeps exact cardinality on triangle and rejects unknown modes',async()=>{
  const rows=[[0,1],[1,2],[0,2]];
  const a=await solveCardinality(rows,3);
  const b=await solveCardinality(rows,3,{primaryProof:'rounded-cuts'});
  assert.equal(a.count,2);assert.equal(b.count,2);
  assert.throws(()=>normalizePrimaryProof('auto'),/invalid primaryProof/);
  await assert.rejects(solveCardinality([],0,{primaryProof:'invalid'}),/invalid primaryProof/);
});

test('worker minimals forwards proof options through the public API',async()=>{
  const input={sourceFumen:'v115@9gglIeglHewwhlzhBexwzhEewwJeAgH',pattern:'T,[^TIL]!,*p2',wantedSave:'T',fastStateBudget:1};
  await assert.rejects(runWorkerRequest({kind:'minimals',input:{...input,primaryProof:'invalid'}}),/invalid primaryProof/);
  const standard=await runWorkerRequest({kind:'minimals',input});
  const rounded=await runWorkerRequest({kind:'minimals',input:{...input,primaryProof:'rounded-cuts'}});
  assert.deepEqual(rounded,standard); // Kernel-only path must stay unchanged.
});
