import fs from'node:fs';
const PIECE_CODE={I:0,J:1,L:2,O:3,S:4,T:5,Z:6};
function queueBits(q){let b=0n;for(let i=0;i<q.length;i++){const v=PIECE_CODE[q[i]];if(v===undefined)throw new Error(`bad piece ${q[i]}`);b|=BigInt(v)<<BigInt(i*3)}return b}
async function bytesFor(url){if(typeof process!=='undefined'&&process.versions?.node)return new Uint8Array(fs.readFileSync(url));const r=await fetch(url);if(!r.ok)throw new Error(`fetch ${url}: ${r.status}`);return new Uint8Array(await r.arrayBuffer())}
let assetsPromise;
export async function loadWasmAssets(){assetsPromise??=(async()=>{const wasm=await bytesFor(new URL('../wasm/pc_wasm.wasm',import.meta.url));const legal=await bytesFor(new URL('../wasm/legal_boards_4.lgb',import.meta.url));const{instance}=await WebAssembly.instantiate(wasm,{});return{exports:instance.exports,legal}})();return assetsPromise}
export class WasmPcSolver{
 constructor(exports,height,legalBytes=null){this.e=exports;this.ptr=exports.solver_new(height);this.height=height;if(!this.ptr)throw new Error(`unsupported height ${height}`);if(height===4&&legalBytes)this.loadLegal(legalBytes)}
 loadLegal(bytes){const p=this.e.wasm_alloc(bytes.length);new Uint8Array(this.e.memory.buffer,p,bytes.length).set(bytes);try{if(!this.e.solver_load_legal_pack(this.ptr,p,bytes.length))throw new Error('invalid legal-board pack')}finally{this.e.wasm_dealloc(p,bytes.length)}}
 canPc(board,queue,useHold=true){return!!this.e.solver_can_pc(this.ptr,board,queueBits(queue),queue.length,useHold?1:0)}
 canPcMany(board,queues,useHold=true){
  if(this.height>=5&&queues.length>=256&&this.e.solver_can_pc_pattern_many)return this.canPcPatternMany(board,queues,useHold);
  if(!this.e.solver_can_pc_many||!this.e.wasm_alloc_u64||!this.e.wasm_dealloc_u64)return queues.map(q=>this.canPc(board,q,useHold));
  if(!queues.length)return[];
  const qp=this.e.wasm_alloc_u64(queues.length),lp=this.e.wasm_alloc(queues.length),op=this.e.wasm_alloc(queues.length);
  try{
   const qb=new BigUint64Array(this.e.memory.buffer,qp,queues.length),ql=new Uint8Array(this.e.memory.buffer,lp,queues.length);
   for(let i=0;i<queues.length;i++){if(queues[i].length>21)throw new Error(`queue length ${queues[i].length} exceeds 21`);qb[i]=queueBits(queues[i]);ql[i]=queues[i].length}
   if(!this.e.solver_can_pc_many(this.ptr,board,qp,lp,queues.length,useHold?1:0,op))throw new Error('WASM canPcMany failed');
   return Array.from(new Uint8Array(this.e.memory.buffer,op,queues.length),x=>x!==0);
  }finally{this.e.wasm_dealloc_u64(qp,queues.length);this.e.wasm_dealloc(lp,queues.length);this.e.wasm_dealloc(op,queues.length)}
 }
 canPcPatternMany(board,queues,useHold=true){
  if(this.height<=4||!this.e.solver_can_pc_pattern_many)return this.canPcMany(board,queues,useHold);
  if(!queues.length)return[];
  const qp=this.e.wasm_alloc_u64(queues.length),lp=this.e.wasm_alloc(queues.length),op=this.e.wasm_alloc(queues.length);
  try{
   const qb=new BigUint64Array(this.e.memory.buffer,qp,queues.length),ql=new Uint8Array(this.e.memory.buffer,lp,queues.length);
   for(let i=0;i<queues.length;i++){if(queues[i].length>21)throw new Error(`queue length ${queues[i].length} exceeds 21`);qb[i]=queueBits(queues[i]);ql[i]=queues[i].length}
   if(!this.e.solver_can_pc_pattern_many(this.ptr,board,qp,lp,queues.length,useHold?1:0,op))throw new Error('WASM canPcPatternMany failed');
   return Array.from(new Uint8Array(this.e.memory.buffer,op,queues.length),x=>x!==0);
  }finally{this.e.wasm_dealloc_u64(qp,queues.length);this.e.wasm_dealloc(lp,queues.length);this.e.wasm_dealloc(op,queues.length)}
 }
 enumeratePc(board,queue,useHold=true){const n=Number(this.e.solver_enumerate_pc(this.ptr,board,queueBits(queue),queue.length,useHold?1:0)),out=[];for(let i=0;i<n;i++){const masks=[];for(let p=0;p<7;p++)masks.push(this.e.solver_solution_mask(this.ptr,i,p));out.push({masks,key:masks.map(x=>x.toString(16)).join(':'),orderCount:Number(this.e.solver_solution_order_count?.(this.ptr,i)??0)})}return out}
 enumeratePcPattern(board,queues,useHold=true){
  if(this.height<=4||!this.e.solver_enumerate_pc_pattern||!this.e.solver_pattern_coverage_offset)return null;
  if(!queues.length)return[];
  const qp=this.e.wasm_alloc_u64(queues.length),lp=this.e.wasm_alloc(queues.length);
  try{
   const qb=new BigUint64Array(this.e.memory.buffer,qp,queues.length),ql=new Uint8Array(this.e.memory.buffer,lp,queues.length);
   for(let i=0;i<queues.length;i++){if(queues[i].length>21)throw new Error(`queue length ${queues[i].length} exceeds 21`);qb[i]=queueBits(queues[i]);ql[i]=queues[i].length}
   const n=Number(this.e.solver_enumerate_pc_pattern(this.ptr,board,qp,lp,queues.length,useHold?1:0));
   if(n===0xffffffff)throw new Error('WASM pattern enumeration failed');
   const out=[];
   for(let i=0;i<n;i++){
    const masks=[];for(let p=0;p<7;p++)masks.push(this.e.solver_solution_mask(this.ptr,i,p));
    const start=Number(this.e.solver_pattern_coverage_offset(this.ptr,i)),end=Number(this.e.solver_pattern_coverage_offset(this.ptr,i+1)),coverage=[];
    if(start===0xffffffff||end===0xffffffff||end<start)throw new Error('invalid WASM pattern coverage offsets');
    for(let j=start;j<end;j++)coverage.push({caseIndex:Number(this.e.solver_pattern_coverage_case(this.ptr,j)),orderCount:Number(this.e.solver_pattern_coverage_order_count(this.ptr,j))});
    out.push({masks,key:masks.map(x=>x.toString(16)).join(':'),orderCount:Number(this.e.solver_solution_order_count?.(this.ptr,i)??0),coverage});
   }
   return out;
  }finally{this.e.wasm_dealloc_u64(qp,queues.length);this.e.wasm_dealloc(lp,queues.length)}
 }
 enumeratePcMany(board,queues,useHold=true){
  if(this.height<=4||queues.length<24||typeof this.enumeratePcPattern!=='function')return queues.map(q=>this.enumeratePc(board,q,useHold));
  const rows=this.enumeratePcPattern(board,queues,useHold);
  if(!Array.isArray(rows))return queues.map(q=>this.enumeratePc(board,q,useHold));
  const out=Array.from({length:queues.length},()=>[]);
  for(const solution of rows)for(const hit of solution.coverage){if(hit.caseIndex<out.length)out[hit.caseIndex].push({masks:solution.masks,key:solution.key,orderCount:hit.orderCount})}
  for(const row of out)row.sort((a,b)=>a.key.localeCompare(b.key));
  return out;
 }
 perSaveBest(board,queue,useHold=true,{candidateLimit=16}={}){if(!this.e.solver_per_save_best)return null;const k=Math.max(1,Math.min(65535,Number(candidateLimit)||16)),n=Number(this.e.solver_per_save_best(this.ptr,board,queueBits(queue),queue.length,useHold?1:0,k)),out=[];for(let i=0;i<n;i++){const masks=[];for(let p=0;p<7;p++)masks.push(this.e.solver_solution_mask(this.ptr,i,p));const saved=Number(this.e.solver_solution_saved_piece(this.ptr,i));out.push({saved,masks,key:masks.map(x=>x.toString(16)).join(':'),orderCount:Number(this.e.solver_solution_order_count(this.ptr,i))})}return out}
 minimumCover(coverage,{qualityFor=null}={}){
  if(!this.e.solver_min_cover||!this.e.wasm_alloc_u32||!this.e.wasm_dealloc_u32)return null;
  const rawCases=[],keySet=new Set();
  for(const[caseId,solutions]of coverage){if(!solutions?.size)continue;const row=[...solutions];for(const key of row)keySet.add(key);rawCases.push({caseId,row})}
  if(rawCases.length===0)return{count:0,keys:[],qualityVector:[],searchedStates:0};
  const keys=[...keySet].sort(),keyIndex=new Map(keys.map((key,i)=>[key,i]));
  let entryCount=0;for(const c of rawCases)entryCount+=c.row.length;
  const offsets=new Uint32Array(rawCases.length+1),ids=new Uint32Array(entryCount),qualities=new Uint32Array(entryCount);
  let pos=0;for(let ci=0;ci<rawCases.length;ci++){offsets[ci]=pos;const c=rawCases[ci];for(const key of c.row){ids[pos]=keyIndex.get(key);const raw=qualityFor?Number(qualityFor(key,c.caseId)):0;qualities[pos]=Number.isFinite(raw)?Math.max(0,Math.min(0xffffffff,Math.floor(raw))):0;pos++}}offsets[rawCases.length]=pos;
  const op=this.e.wasm_alloc_u32(offsets.length),ip=this.e.wasm_alloc_u32(ids.length),qp=this.e.wasm_alloc_u32(qualities.length);
  try{
   new Uint32Array(this.e.memory.buffer,op,offsets.length).set(offsets);
   if(ids.length)new Uint32Array(this.e.memory.buffer,ip,ids.length).set(ids);
   if(qualities.length)new Uint32Array(this.e.memory.buffer,qp,qualities.length).set(qualities);
   const n=Number(this.e.solver_min_cover(this.ptr,op,rawCases.length,ip,qp,entryCount,keys.length));
   if(n===0xffffffff)return{count:Infinity,keys:[],qualityVector:[],searchedStates:Number(this.e.solver_min_cover_searched_states?.(this.ptr)??0n)};
   const selected=[];for(let i=0;i<n;i++){const id=Number(this.e.solver_min_cover_selected(this.ptr,i));if(id>=keys.length)throw new Error('invalid WASM minimum-cover result');selected.push(keys[id])}
   const qn=Number(this.e.solver_min_cover_quality_len(this.ptr)),qualityVector=[];for(let i=0;i<qn;i++)qualityVector.push(Number(this.e.solver_min_cover_quality(this.ptr,i)));
   return{count:n,keys:selected,qualityVector,searchedStates:Number(this.e.solver_min_cover_searched_states(this.ptr))};
  }finally{this.e.wasm_dealloc_u32(op,offsets.length);this.e.wasm_dealloc_u32(ip,ids.length);this.e.wasm_dealloc_u32(qp,qualities.length)}
 }
 legalCount(stage){return Number(this.e.solver_legal_count(this.ptr,stage))}
 legalPackVersion(){return Number(this.e.solver_legal_pack_version?.(this.ptr)??0)}
 legalMemoryBytes(){return Number(this.e.solver_legal_memory_bytes?.(this.ptr)??0)}
 stage8OracleEntries(){return Number(this.e.solver_stage8_oracle_entries?.(this.ptr)??0)}
 stage9OracleEntries(){return Number(this.e.solver_stage9_oracle_entries?.(this.ptr)??0)}
 stats(){return{nodes:Number(this.e.solver_nodes(this.ptr)),cacheHits:Number(this.e.solver_cache_hits(this.ptr)),cacheMisses:Number(this.e.solver_cache_misses(this.ptr)),legalRejects:Number(this.e.solver_legal_rejects(this.ptr)),cacheEntries:Number(this.e.solver_cache_entries?.(this.ptr)??0)}}
 close(){if(this.ptr){this.e.solver_free(this.ptr);this.ptr=0}}
}
export async function createWasmSolver(height=4,{legal=true}={}){const a=await loadWasmAssets();return new WasmPcSolver(a.exports,height,legal?a.legal:null)}
