import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateChance,calculateMinimalsFeature} from '../src/features.mjs';
import {calculateCover} from '../src/batch-features.mjs';
import {createWasmSolver} from '../src/wasm-backend.mjs';

const F5='v115@zgB8GeC8GeE8EeD8DeG8AeE8JeAgH';
const COVER_FUMEN='v115@ThR4BeBtCeR4zhBtKeAgH';

test('*! uses the same optimized 5-line chance path as *p7',async()=>{
  const solver=await createWasmSolver(5);
  try{
    const bang=calculateChance({sourceFumen:F5,pattern:'*!',clear:5,solver,useHold:true});
    const p7=calculateChance({sourceFumen:F5,pattern:'*p7',clear:5,solver,useHold:true});
    assert.deepEqual([bang.success,bang.total,bang.failed],[5004,5040,36]);
    assert.deepEqual(bang.failedQueues,p7.failedQueues);
  }finally{solver.close()}
});

test('*! uses the same 5-line minimals semantics as *p7',async()=>{
  const solver=await createWasmSolver(5);
  try{
    const bang=calculateMinimalsFeature({sourceFumen:F5,pattern:'*!',wantedSave:'',clear:5,solver,useHold:true});
    const p7=calculateMinimalsFeature({sourceFumen:F5,pattern:'*p7',wantedSave:'',clear:5,solver,useHold:true});
    assert.deepEqual([bang.total,bang.saveSuccess,bang.minimalCount],[5040,5004,21]);
    assert.deepEqual(bang.keys,p7.keys);
    assert.deepEqual(bang.coverageCounts,p7.coverageCounts);
  }finally{solver.close()}
});

test('*! is accepted by the batch cover wrapper with *p7-equivalent results',async()=>{
  const bang=await calculateCover({sourceFumen:COVER_FUMEN,pattern:'*!',clear:4,mode:'normal',mirror:'no'});
  const p7=await calculateCover({sourceFumen:COVER_FUMEN,pattern:'*p7',clear:4,mode:'normal',mirror:'no'});
  assert.deepEqual([bang.covered,bang.total,bang.failed],[432,5040,4608]);
  assert.deepEqual(bang.failedQueues,p7.failedQueues);
});
