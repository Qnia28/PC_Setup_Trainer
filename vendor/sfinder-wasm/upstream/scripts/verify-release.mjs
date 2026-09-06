import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(path.join(root,'RELEASE_3.0_MANIFEST.json')));
const files=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else files.push(path.relative(root,p).split(path.sep).join('/'));}}
walk(root);
assert.deepEqual(files.filter(f=>f!=='RELEASE_3.0_MANIFEST.json').sort(),manifest.files.map(f=>f.file).sort());
for(const item of manifest.files){const bytes=readFileSync(path.join(root,item.file));assert.equal(bytes.length,item.bytes,item.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.file);}
console.log('Verified '+manifest.files.length+' release files and hashes.');
