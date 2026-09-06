import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Node 24's test-runner child-process isolation loses JSPI initialization.
// Run each node:test file in a fresh process with JSPI explicitly enabled.
const root = fileURLToPath(new URL('../', import.meta.url));
let failed=0;
for (const file of readdirSync(new URL('../tests/',import.meta.url)).filter(n=>n.endsWith('.test.mjs')).sort()) {
  console.log('\nTEST FILE ' + file);
  const result=spawnSync(process.execPath,['--experimental-wasm-stack-switching','tests/'+file],{cwd:root,stdio:'inherit'});
  if(result.status!==0){failed++;if(result.error)console.error(result.error);}
}
console.log('Failed test files: '+failed);
process.exitCode=failed?1:0;
