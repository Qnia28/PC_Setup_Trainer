import test from 'node:test';
import assert from 'node:assert/strict';
import {createWasmSolver} from '../src/wasm-backend.mjs';

const BOARD=0x3c0f03c0fn;
const QUEUE='OJILSZT';

// BOX 4P fixture with enough alternative PCs to exercise the Top-K ranking.
test('WASM single-queue per-save Top-K preserves saves and picks max playable-order score',async()=>{
  const solver=await createWasmSolver(4);
  try{
    const all=solver.enumeratePc(BOARD,QUEUE,true);
    assert.equal(all.length,44);

    const grouped=new Map();
    for(const solution of all){
      const saved=solution.masks.findIndex(mask=>mask===0n);
      assert.ok(saved>=0);
      let rows=grouped.get(saved);
      if(!rows){rows=[];grouped.set(saved,rows)}
      rows.push(solution);
    }

    const direct=solver.perSaveBest(BOARD,QUEUE,true,{candidateLimit:16});
    assert.deepEqual(direct.map(x=>x.saved),[0,3,4,5,6]);
    assert.deepEqual(direct.map(x=>x.orderCount),[1,1,4,7,13]);

    for(const selected of direct){
      const candidates=grouped.get(selected.saved);
      assert.ok(candidates.some(x=>x.key===selected.key));
      assert.equal(selected.orderCount,Math.max(...candidates.map(x=>x.orderCount)));
    }
  }finally{
    solver.close();
  }
});
