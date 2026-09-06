import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {decoder} from 'tetris-fumen';
const toolsRoot=process.env.SFINDER_TEST_TOOLS_ROOT;
const {chromium}=await import(toolsRoot?pathToFileURL(path.join(toolsRoot,'playwright-core/index.mjs')).href:'playwright-core');
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.wasm':'application/wasm'};
const errors=[],requests=[],results=[];
const scope=process.env.SFINDER_BROWSER_SCOPE;
const isolated=scope!=='fallback'||process.env.SFINDER_BROWSER_ISOLATED==='1';
const server=http.createServer((req,res)=>{
 if(isolated){res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');}
 const url=new URL(req.url,'http://127.0.0.1'),f=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(!f.startsWith(root)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',types[path.extname(f)]??'application/octet-stream');
 const stream=fs.createReadStream(f);stream.on('error',()=>res.writeHead(404).end());stream.pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const fixtures=JSON.parse(fs.readFileSync(new URL('fixtures.json',import.meta.url)));
function verify(f,r){
 assert.equal(r.minimalCount,f.K);assert.equal(r.fumenPages,f.K);
 const keys=decoder.decode(r.fumen).map(page=>{
  const masks=Array(7).fill(0n);
  for(let y=0;y<4;y++)for(let x=0;x<10;x++){const i='IJLOSTZ'.indexOf(page.field.at(x,y));if(i>=0)masks[i]|=1n<<BigInt(y*10+x);}
  return masks.map(m=>m.toString(16)).join(':');
 });
 assert.equal(new Set(keys).size,f.K);
 const selected=new Set(keys.map(k=>{const i=f.keys.indexOf(k);assert.notEqual(i,-1);return i;}));
 assert.ok(f.primaryCases.every(row=>row.some(i=>selected.has(i))));
 assert.equal(r.saveSuccess,f.primaryCases.length);
 return {...r,coverageVerified:true,fixture:f.id};
}
let caps;
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.stack));page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
 page.on('response',r=>{if(r.status()>=400&& !r.url().endsWith('favicon.ico'))errors.push(r.status()+' '+r.url());});
 page.on('request',r=>requests.push(r.url()));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>window.ready);
 caps=await page.evaluate(()=>({ua:navigator.userAgent,crossOriginIsolated,jspi:typeof WebAssembly.promising,sharedArrayBuffer:typeof SharedArrayBuffer}));
 const run=async(f,Primary)=>{
  console.log('START',f.id,Primary);
  const r=verify(f,await page.evaluate(input=>window.runCase(input),{...f.input,Primary}));
  assert.equal(r.primaryResolved,Primary==='Auto'?(f.id.startsWith('cycle')?'rust':isolated?'ortools':'highs'):Primary.toLowerCase());
  results.push({...r,Primary});console.log('PASS',f.id,Primary,r.primaryResolved,r.minimalCount,r.ms);
 };
 if(scope==='fallback'){
  assert.equal(caps.crossOriginIsolated,isolated);
  const small=fixtures.find(f=>f.id.startsWith('cycle'));
  const box7=fixtures.find(f=>f.id==='box3x4-7p');
  // Deliberately excludes all 3x4 BOX 8P solves, including cancellation probes.
  await run(small,'Auto');
  if(!isolated){
   await assert.rejects(page.evaluate(input=>window.runCase(input),{...box7.input,Primary:'ORTools'}),/ORTools requires/);
   results.push({fixture:'explicit-ortools-unavailable',errorVerified:true});
  }
  await run(box7,'Auto');
  const last=results.at(-1);
  assert.equal(last.primaryRequested,'auto');
  assert.equal(last.useHiGHSResolved,!isolated);
  if(!isolated)assert.ok(!requests.some(url=>/ortools-primary-worker|cp-sat|cp_sat_runtime/.test(url)),'unsupported runtime must not be loaded');
 }else if(scope==='features'){
  const small=fixtures.find(f=>f.id.startsWith('cycle'));
  const per=await page.evaluate(input=>window.runFeature('per-save-minimals',input),{...fixtures[1].input,Primary:'ORTools'});
  const active=Object.values(per.results).filter(r=>r.minimalCount);
  console.log('PER-SAVE BACKENDS',active.map(r=>({K:r.minimalCount,req:r.primaryRequested,res:r.primaryResolved,card:r.cardinalityBackend})));assert.ok(active.length>0);
  for(const r of active){assert.equal(r.primaryRequested,'ortools');assert.ok(['ortools','kernel'].includes(r.primaryResolved));}
  const fifth=await page.evaluate(()=>window.runFeature('fifth',{sourceFumen:'v115@9gglIeglHewwhlzhBexwzhEewwJeAgH',pattern:'T,[^TIL]!,*p2',Primary:'ORTools'}));
  assert.equal(fifth.pageCounts.L,2);
  results.push({fixture:'per-save-final',backends:active.map(r=>r.primaryResolved),counts:active.map(r=>r.minimalCount)},{fixture:'fifth-final',pageCounts:fifth.pageCounts});
 }else{
 const small=fixtures.find(f=>f.id.startsWith('cycle'));
 for(const mode of ['Auto','Rust','HiGHS','ORTools'])await run(small,mode);
 await run(fixtures[0],'Auto');await run(fixtures[0],'ORTools');
 await run(fixtures.find(f=>f.id==='box4x4'),'Auto');
 await run(fixtures[1],'Auto');
 const cancelled=await page.evaluate(input=>window.cancelAndRestart(input),fixtures[1].input);
 assert.equal(cancelled.cancelled.name,'AbortError');verify(fixtures[0],cancelled.result);
 results.push({fixture:'cancel-and-restart',cancelled:true,result:cancelled.result});
 }
 await page.evaluate(()=>window.dispose());
 assert.deepEqual(errors,[]);
 const resultFile=scope==='fallback'?'../../RELEASE_3.0_FALLBACK_BROWSER_'+(isolated?'ISOLATED':'NONISOLATED')+'_RESULTS.json':scope==='features'?'../../RELEASE_3.0_BROWSER_FEATURE_RESULTS.json':'../../RELEASE_3.0_BROWSER_RESULTS.json';
 fs.writeFileSync(new URL(resultFile,import.meta.url),JSON.stringify({caps,results,errors,requests},null,2));
 console.log('ALL BROWSER CHECKS PASSED');
}finally{await browser.close();await new Promise(r=>server.close(r));}
