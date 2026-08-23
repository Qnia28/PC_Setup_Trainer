import test from'node:test';import assert from'node:assert/strict';import{runWorkerRequest}from'../src/worker-runtime.mjs';
test('worker runtime uses WASM backend',async()=>{const r=await runWorkerRequest({kind:'chance',input:{sourceFumen:'v115@vhAAgH',pattern:'OOOOO',clear:2}});assert.deepEqual([r.success,r.total],[1,1])});
