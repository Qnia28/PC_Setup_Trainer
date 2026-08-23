import test from'node:test';
import assert from'node:assert/strict';
import{decoder}from'tetris-fumen';
import{fieldMasks}from'../src/batch-geometry.mjs';
import{expandPattern}from'../src/pattern.mjs';
import{createWasmSolver}from'../src/wasm-backend.mjs';

test('batched canPc matches independent single-queue calls across *p7',async()=>{
 const page=decoder.decode('v115@9gRpHeRpHeilGeglzhOeAgH')[0],{base,fill}=fieldMasks(page,4),board=base|fill,queues=expandPattern('*p7');
 const batched=await createWasmSolver(4),single=await createWasmSolver(4);
 try{
  assert.deepEqual(batched.canPcMany(board,queues,true),queues.map(q=>single.canPc(board,q,true)));
  const noHold=queues.slice(0,256);
  assert.deepEqual(batched.canPcMany(board,noHold,false),noHold.map(q=>single.canPc(board,q,false)));
 }finally{batched.close();single.close()}
});
