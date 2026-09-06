from pathlib import Path
import os,subprocess,sys,time
w=Path(__file__).parent.resolve();env=os.environ.copy();env['PATH']=str(w/'upstream/javascript/node_modules/.bin')+os.pathsep+str(w/'venv/Scripts')+os.pathsep+str(w/'emsdk/upstream/emscripten')+os.pathsep+env['PATH'];env['OR_TOOLS_PATCH']='6755'
cmake=str(w/'venv/Scripts/cmake.exe');base=['-S',str(w/'wasm-v915'),'-B',str(w/'build-v915-lto'),'-G','Ninja',f'-DCMAKE_TOOLCHAIN_FILE={w.as_posix()}/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG -flto -fwasm-exceptions','-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG -flto -fwasm-exceptions','-DBUILD_SHARED_LIBS=OFF','-DBUILD_TESTING=OFF','-DBUILD_SAMPLES=OFF','-DBUILD_EXAMPLES=OFF','-DBUILD_PYTHON=OFF',f'-DOR_TOOLS_PROTOC_EXECUTABLE={w.as_posix()}/protoc-v33.1/bin/protoc.exe']
for opt in ['CLP','CBC','KNAPSACK','BOP','GLPK','SCIP']:base.append(f'-DORTOOLS_WASM_USE_{opt}=OFF')
mode=sys.argv[1] if len(sys.argv)>1 else 'configure'
cmd=[cmake]+(base if mode=='configure' else ['--build',str(w/'build-v915-lto'),'--target','cp_sat_runtime_node','cp_sat_runtime','--parallel','3'])
print(' '.join(cmd),flush=True)
with (w/'logs'/f'rebuild-{mode}.log').open('w',encoding='utf8') as log:
 p=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
 code=p.wait()
print(f'{mode} exit={code}',flush=True);sys.exit(code)
