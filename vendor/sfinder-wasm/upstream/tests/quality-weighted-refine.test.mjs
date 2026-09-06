import test from 'node:test';
import assert from 'node:assert/strict';
import {refineMinimumCoverQuality as optimized} from '../src/min-cover-quality-refine.mjs';
import {refineMinimumCoverQuality as reference} from './helpers/refine-release27.mjs';

test('weighted row classes and sparse pair updates preserve selected IDs, quality, and passes',()=>{
 let seed=317;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let sample=0;sample<100;sample++){
  const n=6+rand(5),rows=[];
  for(let ci=0;ci<8;ci++){
   const row=[[ci%3,rand(7)]];
   for(let id=3;id<n;id++)if(rand(3)!==0)row.push([id,rand(5)===0?0xffffffff:rand(11)]);
   for(let copies=0,limit=17+rand(20);copies<limit;copies++)rows.push(copies%2?[...row].reverse():row);
  }
  const prepared={keys:Array.from({length:n},(_,j)=>`s${j}`),cases:rows};
  for(const maxPasses of [0,1,4])assert.deepEqual(optimized(prepared,[0,1,2],{maxPasses}),reference(prepared,[0,1,2],{maxPasses}),`sample=${sample}, passes=${maxPasses}`);
 }
});
