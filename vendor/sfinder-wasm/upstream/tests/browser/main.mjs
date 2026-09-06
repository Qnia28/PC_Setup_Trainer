import {SolverWorkerClient,viteWorkerFactory} from '../../src/worker-client.mjs';
import {decoder} from 'tetris-fumen';
const client=new SolverWorkerClient(viteWorkerFactory);
window.runCase=async input=>{
 const start=performance.now(),r=await client.request('minimals',input);
 return {...r,ms:performance.now()-start,fumenPages:decoder.decode(r.fumen).length};
};
window.cancelAndRestart=async input=>{
 const controller=new AbortController();
 const pending=client.request('minimals',input,{signal:controller.signal}).then(()=>({unexpectedSuccess:true}),e=>({name:e.name}));
 setTimeout(()=>controller.abort(),1000);
 const cancelled=await pending;
 const r=await window.runCase({...input,pattern:'*!',Primary:'ORTools'});
 return {cancelled,result:r};
};
window.dispose=()=>client.dispose();
window.ready=true;

window.runFeature=(kind,input)=>client.request(kind,input);
