import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePrimary, primaryRequest, selectPrimaryBackendFromStats} from '../src/primary-backend.mjs';
import {minimumCoverAsync, minimumCoverAdaptiveAsync} from '../src/min-cover-adaptive.mjs';
import {solveORToolsCardinalityKernel, assertORToolsSupported, isORToolsSupported} from '../src/ortools-min-cover.mjs';
import {createWasmSolver} from '../src/wasm-backend.mjs';
const triangle = () => new Map([['A', new Set(['X','Y'])], ['B', new Set(['X','Z'])], ['C', new Set(['Y','Z'])]]);
test('Primary modes, legacy aliases, precedence, and measured Auto boundaries', () => {
  for (const mode of ['Auto','Rust','HiGHS','ORTools']) assert.equal(normalizePrimary(mode),mode.toLowerCase());
  assert.equal(primaryRequest({Primary:'ORTools',useHiGHS:false}),'ortools');
  assert.equal(primaryRequest({primary:'Rust',Primary:'ORTools'}),'rust');
  assert.equal(primaryRequest({UseHiGHS:true}),'highs');
  assert.equal(primaryRequest({UseHiGHS:false}),'rust');
  assert.throws(()=>normalizePrimary('SAT'),/Invalid Primary/);
  const choose = (cases,solutions,entries,mode='auto') => selectPrimaryBackendFromStats({cases,solutions,entries},mode);
  assert.equal(choose(749,110,10056),'rust');
  assert.equal(choose(1096,124,14620),'ortools');
  assert.equal(choose(3481,383,128021),'ortools');
  assert.equal(choose(200,112,2200),'ortools');
  assert.equal(choose(199,112,2200),'rust');
  assert.equal(choose(200,111,2200),'rust');
  assert.equal(choose(200,112,2199),'rust');
  assert.equal(choose(1,1,1,'highs'),'highs');
  for (const mode of ['auto','rust','highs','ortools']) assert.equal(choose(0,0,0,mode),'kernel');
});
test('all primary backends prove K and the same exact secondary optimum', async () => {
  const solver = await createWasmSolver(4);
  try {
    const qualityFor = (key, id) => ({AX:100,AY:30,BX:20,BZ:90,CY:80,CZ:10}[id+key]);
    let expected;
    for (const Primary of ['Auto','Rust','HiGHS','ORTools']) {
      const r = await minimumCoverAsync(triangle(), {solver,Primary,qualityFor,exactQuality:'True'});
      assert.equal(r.count,2); assert.equal(r.qualityExact,true);
      assert.equal(r.primaryRequested,Primary.toLowerCase());
      assert.equal(r.cardinalityBackend,Primary==='Auto'?'rust':Primary.toLowerCase());
      expected ??= r.qualityVector; assert.deepEqual(r.qualityVector,expected);
      assert.ok([...triangle().values()].every(row=>r.keys.some(key=>row.has(key))));
    }
    for (const Primary of ['Rust','HiGHS','ORTools']) {
      const r=await minimumCoverAdaptiveAsync(triangle(),{solver,Primary});
      assert.equal(r.cardinalityBackend,Primary.toLowerCase());
    }
  } finally {solver.close();}
});
test('isolated ORTools workers handle repeated and concurrent calls and forced IDs',async()=>{
  const kernel={cases:[[0,1],[0,2],[1,2]],solutionIds:[3,5,7],forced:[11]};
  for (let round=0;round<2;round++) {
    const results=await Promise.all([solveORToolsCardinalityKernel(kernel),solveORToolsCardinalityKernel(kernel)]);
    for(const r of results){assert.equal(r.count,3);assert.equal(r.proofBound,3);assert.ok(r.selected.includes(11));}
  }
  assert.equal((await solveORToolsCardinalityKernel({cases:[],solutionIds:[],forced:[11]})).backend,'kernel');
});
test('unsupported ORTools capability is explicit',()=>{
  const original=WebAssembly.promising;
  try {WebAssembly.promising=undefined;assert.throws(assertORToolsSupported,/ORTools requires/);}
  finally {WebAssembly.promising=original;}
});

test('Auto falls back only for wide kernels when ORTools is unavailable',()=>{
  const wide={cases:200,solutions:112,entries:2200}, unavailable={ortoolsAvailable:false};
  assert.equal(selectPrimaryBackendFromStats(wide,'auto',unavailable),'highs');
  assert.equal(selectPrimaryBackendFromStats(wide,'auto',{ortoolsAvailable:true}),'ortools');
  for(const dimension of Object.keys(wide)) {
    assert.equal(selectPrimaryBackendFromStats({...wide,[dimension]:wide[dimension]-1},'auto',unavailable),'rust');
  }
  for(const mode of ['rust','highs','ortools']) {
    assert.equal(selectPrimaryBackendFromStats(wide,mode,unavailable),mode);
    assert.equal(selectPrimaryBackendFromStats({cases:0,solutions:0,entries:0},mode,unavailable),'kernel');
  }
});

test('ORTools capability check includes isolation, SharedArrayBuffer and both JSPI APIs',()=>{
  for(const [owner,key,value] of [[globalThis,'crossOriginIsolated',false],
    [globalThis,'SharedArrayBuffer',undefined],[WebAssembly,'Suspending',undefined],
    [WebAssembly,'promising',undefined]]) {
    const original=Object.getOwnPropertyDescriptor(owner,key);
    try {
      Object.defineProperty(owner,key,{value,configurable:true,writable:true});
      assert.equal(isORToolsSupported(),false);
      assert.throws(assertORToolsSupported,/ORTools requires/);
    } finally {
      if(original)Object.defineProperty(owner,key,original);else delete owner[key];
    }
  }
  assert.equal(isORToolsSupported(),true);
});

test('per-save numeric shortcuts and fifth honor explicit Primary on small covers', async()=>{
  const {calculatePerSaveMinimalsFeature}=await import('../src/features.mjs');
  const {fifthMinimalsPerSavesAsync}=await import('../src/fifth.mjs');
  const solver=await createWasmSolver(4),sourceFumen='v115@9gglIeglHewwhlzhBexwzhEewwJeAgH',pattern='T,[^TIL]!,*p2';
  try{
    for(const Primary of ['HiGHS','ORTools']){
      const per=await calculatePerSaveMinimalsFeature({sourceFumen,pattern,solver,Primary});
      const fifth=await fifthMinimalsPerSavesAsync({sourceFumen,analysisPattern:pattern,solver,Primary});
      for(const result of [...Object.values(per.results),...Object.values(fifth.results)]){
        if(!result.minimalCount)continue;
        assert.equal(result.primaryRequested,Primary.toLowerCase());
        assert.ok([Primary.toLowerCase(),'kernel'].includes(result.primaryResolved));
        assert.ok(!result.cardinalityBackend.includes('legacy'));
      }
    }
  }finally{solver.close();}
});
