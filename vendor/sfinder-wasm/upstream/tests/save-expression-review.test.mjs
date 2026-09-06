import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileExactSaveExpression, compileSaveExpression, compileSaveOutcomeExpression,
  prepareSaveCase, prepareSolutionPieceCounts, savedMultiplicityCodePrepared,
  saveMultiplicityCodeToString, savedCodePrepared, saveCodeToString, saveMaskToString,
} from '../src/saves.mjs';
import {calculateSaves, calculateMinimalsFeature, calculateLegacyMinimalsFeature} from '../src/features.mjs';
import {createWasmSolver} from '../src/wasm-backend.mjs';

const BOARD='v115@9gglIeglHewwhlzhBexwzhEewwJeAgH', PATTERN='T,[^TIL]!,*p2';
const ONE_I='v115@+gI8AeI8AeI8AeI8JeAgH';
const exact=save=>savedMultiplicityCodePrepared(prepareSaveCase(save,{pieces:new Set(),drawCount:0}),new Uint8Array(7));
const outcome=(s,e)=>[...compileSaveOutcomeExpression(e)(new Set(s))].sort();

test('prefix negations bind to just the next atom/group in both evaluation models',()=>{
  const universes=[[],['T'],['I','T','TO'],['I','O'],['TT','TI','O']];
  for(const prefix of ['!','^','!!','^^','!^','^!']) {
    for(const atom of ['O','(O||I)','/O/']) {
      for(const op of ['&&','||']) {
        const plain=prefix+atom+op+'T',grouped='('+prefix+atom+')'+op+'T';
        for(const universe of universes) assert.deepEqual(outcome(universe,plain),outcome(universe,grouped),plain);
        for(const save of ['','T','O','TI','TO','TT']) assert.equal(compileExactSaveExpression(plain)(exact(save)),compileExactSaveExpression(grouped)(exact(save)),plain+'/'+save);
      }
    }
  }
  assert.deepEqual(outcome(['T','I'],'!O&&T'),['I','T']);
  assert.deepEqual(outcome(['T','O'],'^O&&T'),['T']);
  for(const prefix of ['!!','^^'])for(const save of ['','T','O']) {
    assert.equal(compileExactSaveExpression(prefix+'T')(exact(save)),save.includes('T'));
  }
});

test('exact scalar expressions agree with legacy precedence on all 128 distinct save sets',()=>{
  const expressions=['T||I&&O','T&&I||O','T||I&&O||S&&Z','!O&&T',
    '^O&&T','!!T||!I&&O','T||(I&&O)','(T||I)&&O','!(T||I)&&O','T&&!(I||O)'];
  for(const e of expressions){
    const legacy=compileSaveExpression(e),predicate=compileExactSaveExpression(e);
    for(let mask=0;mask<128;mask++)assert.equal(predicate(exact(saveMaskToString(mask))),!!legacy[mask],e+'/'+mask);
  }
  // Intentional queue contract differs: mixed connectors are left-associative.
  assert.deepEqual(outcome(['T'],'T||I&&O'),[]);
  assert.equal(compileExactSaveExpression('T||I&&O')(exact('T')),true);
  assert.equal(compileExactSaveExpression('TT||I&&O')(exact('TT')),true);
  assert.equal(compileExactSaveExpression('TT||I&&O')(exact('T')),false);
});

test('whitespace is ignored outside regex literals and preserved inside them',()=>{
  for(const [plain,spaced] of [['!O&&T',' ! O \t&&\n T '],['T||I&&O',' T || I && O '],['^O&&(T||I)',' ^ O && ( T || I ) ']]){
    for(const save of ['','T','I','O','TI','TIO']){
      assert.equal(compileExactSaveExpression(plain)(exact(save)),compileExactSaveExpression(spaced)(exact(save)));
      assert.deepEqual(outcome([save],plain),outcome([save],spaced));
    }
  }
  for(const e of ['/T T/','/T\tT/']){
    assert.equal(compileExactSaveExpression(' '+e+' ')(exact('TT')),false);
    assert.deepEqual(outcome(['TT'],e),[]);
  }
  assert.equal(compileExactSaveExpression('/T|I/ && ! O')(exact('T')),true);
  assert.equal(compileExactSaveExpression('/T\\/T/ || I')(exact('I')),true);
});

test('save encoding preserves all copies, including counts above 7 and 255',()=>{
  for(const count of [0,1,2,7,8,255,256,300]){
    const meta=prepareSaveCase('T'.repeat(count)+'I',{pieces:new Set('TZI'),drawCount:1});
    const used=prepareSolutionPieceCounts({masks:[15n,0n,0n,0n,0n,0n,0n]});
    const expected='T'.repeat(count+1)+'Z'; // Last-bag undrawn copy plus unused queue copies.
    const code=savedMultiplicityCodePrepared(meta,used);
    assert.equal(saveMultiplicityCodeToString(code),expected);
    assert.equal(saveCodeToString(savedCodePrepared(meta,used)),expected);
    assert.equal(compileExactSaveExpression('/^T{'+(count+1)+'}Z$/')(code),true);
  }
});

test('review 1 and 2: production and legacy minimals produce the corrected cover',async()=>{
  const solver=await createWasmSolver(4);
  try{
    for(const calculate of [calculateMinimalsFeature,calculateLegacyMinimalsFeature]){
      const run=wantedSave=>calculate({sourceFumen:BOARD,pattern:PATTERN,wantedSave,solver});
      for(const expr of ['!O&&T','^O&&T']){
        const actual=await run(expr),grouped=await run('('+expr.slice(0,2)+')&&T');
        assert.deepEqual([actual.saveSuccess,actual.minimalCount],[288,1]);
        assert.equal(actual.fumen,grouped.fumen);
      }
      const actual=await run('T||I&&O'),grouped=await run('T||(I&&O)');
      assert.deepEqual([actual.saveSuccess,actual.minimalCount],[1008,6]);
      assert.equal(actual.fumen,grouped.fumen);
    }
  }finally{solver.close();}
});

test('review 3 and 4: saves and minimals preserve unused copies and accept spaced filters',async()=>{
  const solver=await createWasmSolver(4);
  try{
    for(const count of [2,8]){
      const input={sourceFumen:ONE_I,pattern:'I'+'T'.repeat(count-1)+',[T]!',solver};
      const all=calculateSaves(input);
      assert.deepEqual(all.saveResults,[{save:'T'.repeat(count),success:1,total:1,percent:100}]);
      for(const wantedSave of ['T'.repeat(count),' '+ 'T'.repeat(count)+' || I ']){
        assert.equal(calculateSaves({...input,wantedSave}).success,1);
        const m=await calculateMinimalsFeature({...input,wantedSave});
        assert.deepEqual([m.saveSuccess,m.minimalCount],[1,1]);
      }
    }
  }finally{solver.close();}
});
