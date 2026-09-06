from pathlib import Path
import shutil,subprocess,json,urllib.request,zipfile
w=Path.cwd(); src=w/'upstream'; dst=w/'wasm-v915'
for name in ['CMakeLists.txt']:
 shutil.copy2(src/name,dst/name)
for name in ['cmake','scripts','patches','javascript']:
 shutil.copytree(src/name,dst/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','build','.git'))
p=dst/'ortools/port/os.h';s=subprocess.check_output(['git','-C',str(dst),'show','HEAD:ortools/port/os.h'],text=True);s=s.replace('defined(ORTOOLS_TARGET_OS_IS_EMSCRIPTEN)', '(defined(ORTOOLS_TARGET_OS_IS_EMSCRIPTEN) && !defined(__EMSCRIPTEN_PTHREADS__))');p.write_text(s)
p=dst/'CMakeLists.txt';s=p.read_text();s=s.replace('"-sASSERTIONS=1"','"-sASSERTIONS=0"');s=s.replace('    "-gsource-map"\n    "--source-map-base=./"', '    "-O3"\n    "-flto"');s=s.replace('"-fexceptions"','"-fwasm-exceptions"').replace('    "-sDISABLE_EXCEPTION_CATCHING=0"\n','');p.write_text(s)
audit={'officialCommit':subprocess.check_output(['git','-C',str(dst),'rev-parse','HEAD'],text=True).strip(),'portCommit':subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD'],text=True).strip(),'coreDiff':subprocess.check_output(['git','-C',str(src),'diff','v9.15','HEAD','--name-only','--','ortools'],text=True).splitlines(),'satGlopDiff':subprocess.check_output(['git','-C',str(src),'diff','v9.15','HEAD','--name-only','--','ortools/sat','ortools/glop'],text=True),'optimizations':['Release -O3','-flto compile and link','-msimd128 (already enabled in old port)','-sASSERTIONS=0','-fwasm-exceptions compile and link'],'portSourceChanges':subprocess.check_output(['git','-C',str(dst),'diff','--','ortools'],text=True)}
(w/'rebuild-source-audit.json').write_text(json.dumps(audit,indent=2))
url='https://github.com/protocolbuffers/protobuf/releases/download/v33.1/protoc-33.1-win64.zip'
urllib.request.urlretrieve(url,w/'protoc-v33.1.zip')
with zipfile.ZipFile(w/'protoc-v33.1.zip') as z:z.extractall(w/'protoc-v33.1')
print(json.dumps(audit,indent=2))
