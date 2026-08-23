import test from'node:test';import assert from'node:assert/strict';
import{exactMinimumCover}from'../src/min-cover.mjs';

const coverage=rows=>new Map(rows.map(([id,keys])=>[id,new Set(keys)]));

test('independent exact cover preserves minimum cardinality',()=>{
  const c=coverage([['A',['X','Y']],['B',['Y','Z']],['C',['X','Z']]]);
  const r=exactMinimumCover(c);
  assert.equal(r.count,2);
  const selected=new Set(r.keys);
  for(const keys of c.values())assert.ok([...keys].some(k=>selected.has(k)));
});

test('human-quality tie-break improves the worst case after cardinality',()=>{
  const c=coverage([['A',['X','Y']],['B',['Z','W']]]);
  const q={X:100,Y:30,Z:1,W:30};
  const r=exactMinimumCover(c,{qualityFor:key=>q[key]});
  assert.equal(r.count,2);
  assert.deepEqual(r.qualityVector,[30,100]);
  assert.deepEqual(new Set(r.keys),new Set(['X','W']));
});

test('new min-cover cardinality matches brute force on deterministic random matrices',()=>{
  function brute(c){
    const keys=[...new Set([...c.values()].flatMap(s=>[...s]))];
    const full=[...c.values()];
    for(let k=0;k<=keys.length;k++){
      const chosen=[];
      function rec(i,left){
        if(left===0){const set=new Set(chosen);return full.every(row=>[...row].some(x=>set.has(x)))}
        if(keys.length-i<left)return false;
        chosen.push(keys[i]);if(rec(i+1,left-1))return true;chosen.pop();
        return rec(i+1,left);
      }
      if(rec(0,k))return k;
    }
    return Infinity;
  }
  let seed=0x12345678;
  const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32};
  for(let t=0;t<200;t++){
    const caseCount=1+Math.floor(rnd()*7),solutionCount=1+Math.floor(rnd()*7),c=new Map();
    for(let ci=0;ci<caseCount;ci++){
      const keys=new Set();for(let si=0;si<solutionCount;si++)if(rnd()<0.45)keys.add(`S${si}`);
      if(!keys.size)keys.add(`S${Math.floor(rnd()*solutionCount)}`);
      c.set(`C${ci}`,keys);
    }
    assert.equal(exactMinimumCover(c).count,brute(c));
  }
});

import{createWasmSolver}from'../src/wasm-backend.mjs';

test('Rust/WASM exact minimum-cover matches JavaScript fallback including human-quality tie-break',async()=>{
  const solver=await createWasmSolver(4);
  try{
    let seed=0x08912345;
    const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
    for(let t=0;t<100;t++){
      const caseCount=1+Math.floor(rnd()*8),solutionCount=1+Math.floor(rnd()*8),coverage=new Map(),quality=new Map();
      for(let ci=0;ci<caseCount;ci++){
        const keys=new Set();
        for(let si=0;si<solutionCount;si++)if(rnd()<0.45){const key=`S${si}`;keys.add(key);quality.set(`${ci}|${key}`,1+Math.floor(rnd()*20))}
        if(!keys.size){const key=`S${Math.floor(rnd()*solutionCount)}`;keys.add(key);quality.set(`${ci}|${key}`,1+Math.floor(rnd()*20))}
        coverage.set(`C${ci}`,keys);
      }
      const qualityFor=(key,caseId)=>quality.get(`${Number(caseId.slice(1))}|${key}`)??0;
      const js=exactMinimumCover(coverage,{qualityFor}),wasm=solver.minimumCover(coverage,{qualityFor});
      assert.equal(wasm.count,js.count);
      assert.deepEqual(wasm.keys,js.keys);
      assert.deepEqual(wasm.qualityVector,js.qualityVector);
    }
  }finally{solver.close()}
});
