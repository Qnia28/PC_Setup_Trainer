from pathlib import Path
import shutil,subprocess,json,hashlib
w=Path(__file__).parent.resolve();stage=w/'runtime-v915-lto';pkg=w/'wasm-v915/javascript/build/javascript'
for folder in ['node','browser']:
 shutil.copytree(w/'upstream/javascript/build/javascript'/folder,stage/folder,dirs_exist_ok=True)
for folder in ['node-wasm','wasm']:
 (pkg/folder).mkdir(parents=True,exist_ok=True)
 for p in (w/'build-v915-lto/javascript'/folder).glob('cp_sat_runtime*'):
  if p.suffix in ['.js','.wasm']:shutil.copy2(p,pkg/folder/p.name)
# Release ASSERTIONS=0 emits a different glue shape; only retain needed JSPI ctor await.
for p in pkg.glob('*/*.js'):
 text=p.read_text()
 old='function initRuntime(){runtimeInitialized=true;'
 assert old in text
 text=text.replace(old,'async function initRuntime(){runtimeInitialized=true;',1)
 text=text.replace('wasmExports["__wasm_call_ctors"]();FS.ignorePermissions=false','await wasmExports["__wasm_call_ctors"]();FS.ignorePermissions=false',1)
 text=text.replace('if(ABORT)return;initRuntime();postRun()','if(ABORT)return;await initRuntime();postRun()',1)
 p.write_text(text)

for folder in ['node-wasm','wasm']:shutil.copytree(pkg/folder,stage/folder,dirs_exist_ok=True)
(stage/'package.json').write_text('{"type":"module","private":true}')
cmds=json.loads((w/'build-v915-lto/compile_commands.json').read_text());audit=[]
for x in cmds:
 if any(x['file'].endswith(s) for s in ['cp_model_solver.cc','revised_simplex.cc','cp_sat_api.cc']):audit.append(x)
files=[]
for p in stage.rglob('*'):
 if p.is_file():files.append({'file':p.relative_to(stage).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
manifest={'source':json.loads((w/'rebuild-source-audit.json').read_text()),'emscripten':'6.0.8','nodeBenchmark':'24.13.0','cmake':'3.31.10','compilerExamples':audit,'files':files}
(w/'rebuilt-runtime-manifest.json').write_text(json.dumps(manifest,indent=2));print('Staged and hashed',len(files),'files')
