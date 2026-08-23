import {decoder,encoder} from 'tetris-fumen';
import {expandPattern,expandPatternCases,queuesForFinder} from './pattern.mjs';
import {coloredOperationSets,fieldMasks,aggregateMasks} from './batch-geometry.mjs';
import {coverTargets} from './batch-cover.mjs';
import {findCongruentSolutions} from './batch-setup.mjs';
import {loadBatchWasm,BatchReachability} from './batch-backend.mjs';
import {loadWasmAssets,WasmPcSolver} from './wasm-backend.mjs';
import {solutionPage} from './fumen.mjs';

const MASK_ORDER='IJLOSTZ';
function boolMirror(v){return v===true||String(v).toLowerCase()==='yes'}
function masksArray(operations){const m=aggregateMasks(operations);return [...MASK_ORDER].map(p=>m[p]??0n)}
function solutionFromOps(operations,comment=''){const masks=masksArray(operations);return{masks,key:masks.map(x=>x.toString(16)).join(':'),comment}}
function decodedTargets(sourceFumen,height){const pages=decoder.decode(sourceFumen);if(!pages.length)throw new Error('input Fumen has no pages');const targets=[];for(const page of pages){const {base,operationSets}=coloredOperationSets(page,height,{assembleOperation:true});for(const operations of operationSets)targets.push({base,operations,sourcePage:page})}return targets}
async function batchReachability(height,physics){const e=await loadBatchWasm();return new BatchReachability(e,height,physics)}

export async function calculateCover({sourceFumen,pattern,clear=4,mode='normal',mirror='no',useHold=true}){
 if(clear<2||clear>6)throw new Error(`unsupported clear height ${clear}`);
 const finderPattern=queuesForFinder(pattern),queues=expandPatternCases(finderPattern),targets=decodedTargets(sourceFumen,clear),reachability=await batchReachability(clear,'jstris');
 const result=coverTargets({targets,queues,height:clear,reachability,useHold,mirror:boolMirror(mirror),mode});
 return{pathPattern:finderPattern,analysisPattern:pattern,mode:result.mode,mirror:boolMirror(mirror),covered:result.covered,total:result.total,failed:result.failed.length,failedQueues:result.failed,percent:result.total?result.covered/result.total*100:0,targets:result.targets};
}

export async function calculateCongruent({sourceFumen,pattern,clear=4,blueGarbage=false,useHold=true,_keepVariants=false}){
 if(clear<2||clear>6)throw new Error(`unsupported clear height ${clear}`);const pages=decoder.decode(sourceFumen);if(!pages.length)throw new Error('input Fumen has no pages');
 const finderPattern=queuesForFinder(pattern),queues=expandPattern(finderPattern),reachability=await batchReachability(clear,'tetrio');const out=[];
 for(const page of pages){let {base,fill}=fieldMasks(page,clear);if(blueGarbage){fill|=base;base=0n}const solutions=findCongruentSolutions({base,fill,queues,height:clear,reachability,useHold});for(const s of solutions){if(_keepVariants)out.push({...s,base});else{const{variants,...publicSolution}=s;out.push({...publicSolution,base})}}}
 if(!out.length)throw new Error('no congruent solutions');
 const fumen=encoder.encode(out.map(s=>solutionPage(s.base,solutionFromOps(s.operations),s.comment,clear)));
 return{pathPattern:finderPattern,analysisPattern:pattern,solutions:out,count:out.length,fumen};
}

export async function calculateCongruentCover({sourceFumen,pattern,clear=4,mode='normal',mirror='no',blueGarbage=false,useHold=true}){
 const congruent=await calculateCongruent({sourceFumen,pattern,clear,blueGarbage,useHold,_keepVariants:true});const queues=expandPatternCases(congruent.pathPattern),reachability=await batchReachability(clear,'jstris');const targets=congruent.solutions.map(s=>({base:s.base,operations:s.operations,orders:s.orders,variants:s.variants,comment:s.comment,key:s.key}));const result=coverTargets({targets,queues,height:clear,reachability,useHold,mirror:boolMirror(mirror),mode});
 const publicSolutions=congruent.solutions.map(({variants,...solution})=>solution);return{...congruent,solutions:publicSolutions,mode:result.mode,mirror:boolMirror(mirror),covered:result.covered,total:result.total,failed:result.failed.length,failedQueues:result.failed,percent:result.total?result.covered/result.total*100:0,coverTargets:result.targets};
}

async function pcSolver(height){const a=await loadWasmAssets();return new WasmPcSolver(a.exports,height,height===4?a.legal:null)}
export async function calculateCoverPercent({sourceFumen,pattern,coverPattern,percentPattern,clear=4,mode='normal',mirror='no',useHold=true}){
 const cq=coverPattern??pattern,pq=percentPattern??pattern;if(!cq||!pq)throw new Error('cover and percent patterns are required');const cover=await calculateCover({sourceFumen,pattern:cq,clear,mode,mirror,useHold});
 const percentQueues=expandPattern(pq),solver=await pcSolver(clear);try{const rows=[],solveCache=new Map();for(const target of cover.targets){const occupied=target.base|target.operations.reduce((m,o)=>m|o.mask,0n),cacheKey=occupied.toString(16);let solve=solveCache.get(cacheKey);if(solve===undefined){solve=solver.canPcMany(occupied,percentQueues,useHold).reduce((n,v)=>n+(v?1:0),0);solveCache.set(cacheKey,solve)}const solution=solutionFromOps(target.operations);rows.push({solution,base:target.base,mirror:!!target.mirror,covered:target.coverage,coverPercent:cover.total?target.coverage/cover.total*100:0,solve,solveTotal:percentQueues.length,solvePercent:percentQueues.length?solve/percentQueues.length*100:0});}rows.sort((a,b)=>b.solvePercent-a.solvePercent||b.coverPercent-a.coverPercent);const fumen=encoder.encode(rows.map(r=>solutionPage(r.base,r.solution,`Cover: ${Number(r.coverPercent.toFixed(2))}, Solve: ${Number(r.solvePercent.toFixed(2))}`,clear)));return{coverPattern:cover.pathPattern,percentPattern:pq,covered:cover.covered,total:cover.total,failed:cover.failed,totalCoverPercent:cover.percent,solutions:rows,count:rows.length,fumen};}finally{solver.close()}
}
