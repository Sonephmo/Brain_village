// Enumerate real runtime URLs (including generated avatar/audio paths), check exact
// filename casing, file signatures, sprite bounds, build copies and bundled WASM.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../',import.meta.url))
const publicRoot = resolve(root,'public')
const files = new Set()
const frames = []
const issues = []
const warnings = []
const collectURL = url => files.add(decodeURIComponent(url.replace(/^\//,'')))
function load(file,deps={},extra={}) {
  const source=readFileSync(resolve(root,file),'utf8').replaceAll('import.meta.env',JSON.stringify({BASE_URL:'/'}))
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText
  const exports={}
  vm.runInNewContext(js,{exports,console,require:id=>{if(id in deps)return deps[id];throw Error(id)},
    window:{addEventListener(){},removeEventListener(){}},...extra},{filename:file})
  return exports
}
function collect(value) {
  if(typeof value==='string' && value.startsWith('/assets/')) collectURL(value)
  else if(value && typeof value==='object') {
    if(value.src && value.sheet && value.rect)frames.push(value)
    Object.values(value).forEach(collect)
  }
}
const common=load('src/assets.ts')
const b=load('src/game/gameBAssets.ts',{'../assets':common})
const c=load('src/game/gameCAssets.ts',{'../assets':common})
const dCatalog=load('src/game/gameDCatalog.ts')
const d=load('src/game/gameDAssets.ts',{
  '../assets':common,
  './gameDCatalog':dCatalog,
  '../../public/assets/game-d/characters/frames-active.json':{default:JSON.parse(readFileSync(resolve(root,'public/assets/game-d/characters/frames-active.json'),'utf8'))},
  '../../public/assets/game-d/art-frames.json':{default:JSON.parse(readFileSync(resolve(root,'public/assets/game-d/art-frames.json'),'utf8'))},
})
;[common,b,c,d].forEach(collect)
for(const shopper of ['male','female'])for(const pose of ['profile','open','closing','closed'])collect(d.shopperFrame(shopper,pose))
for(const avatar of ['grandma','grandfa'])for(const flag of ['blue','white'])for(const pose of ['stand','up','left','right'])collectURL(common.bodySrc(avatar,flag,pose))
for(const face of ['stand','good','angry_left','angry_right','sad'])collectURL(common.faceSrc(face))
for(const rabbit of ['pink','brown'])for(const pose of ['up','down','idle','squeeze-1','squeeze-2'])collectURL(c.rabbitSrc(rabbit,pose))
for(const cursor of ['Idle','Selecting'])collectURL(`/assets/Cursor_${cursor}_cur.png`)

class AuditAudioContext {
  state='running'
  async decodeAudioData() {return {sampleRate:1000,duration:1,getChannelData:()=>new Float32Array(1000).fill(.2)}}
}
const audio=load('src/game/audio.ts',{'./gameClock':load('src/game/gameClock.ts')}, {AudioContext:AuditAudioContext,fetch:async url=>{
  collectURL(url);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}
}})
await audio.initAudio()
const bgm=load('src/game/bgm.ts',{}, {Audio:class {
  constructor(url){collectURL(url)}
  play(){return Promise.resolve()}
  pause(){}
}})
for(const name of ['opening','tutorial','report'])bgm.playBgm(name)
bgm.stopBgm()
for(const m of ['pose_landmarker_lite','gesture_recognizer'])collectURL(`/models/${m}.task`)
for(const name of readdirSync(resolve(root,'node_modules/@mediapipe/tasks-vision/wasm')))collectURL(`/wasm/${name}`)
const css=readFileSync(resolve(root,'src/styles.css'),'utf8')
for(const match of css.matchAll(/url\(['"]?(\/[^'"\)]+)['"]?\)/g))collectURL(match[1])

function exactFile(path) {
  let folder=publicRoot
  for(const part of path.split('/')) {
    if(!existsSync(folder)||!readdirSync(folder).includes(part))return false
    folder=resolve(folder,part)
  }
  return statSync(folder).isFile()
}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex')
const inventory=[]
for(const file of [...files].sort()) {
  if(!exactFile(file)){issues.push({file,problem:'missing or wrong filename casing'});continue}
  const path=resolve(publicRoot,file)
  const buf=readFileSync(path)
  const ext=extname(file)
  const item={file,bytes:buf.length,sha256:digest(buf)}
  if(!buf.length||buf.subarray(0,80).toString().includes('version https://git-lfs'))issues.push({file,problem:'empty file or LFS pointer'})
  if(ext==='.png') {
    if(buf.subarray(0,3).toString('hex')==='ffd8ff')warnings.push({file,problem:'JPEG data uses a .png filename; browser decode checked separately'})
    else if(buf.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')issues.push({file,problem:'invalid image signature'})
    else {item.width=buf.readUInt32BE(16);item.height=buf.readUInt32BE(20)}
  }
  if(ext==='.jpg'&&buf.subarray(0,3).toString('hex')!=='ffd8ff')issues.push({file,problem:'invalid JPEG signature'})
  if(ext==='.wasm'&&buf.subarray(0,4).toString('hex')!=='0061736d')issues.push({file,problem:'invalid WASM signature'})
  if(ext==='.woff2'&&buf.subarray(0,4).toString()!=='wOF2')issues.push({file,problem:'invalid font signature'})
  if(ext==='.task'&&!buf.includes(Buffer.from('PK\x03\x04')))issues.push({file,problem:'model package has no ZIP header'})
  if(file.startsWith('wasm/')) {
    const bundled=readFileSync(resolve(root,'node_modules/@mediapipe/tasks-vision',file))
    const identical = ext==='.js' ? bundled.toString().replaceAll('\r\n','\n')===buf.toString().replaceAll('\r\n','\n') : digest(bundled)===item.sha256
    if(!identical)warnings.push({file,problem:'differs from installed MediaPipe runtime beyond line endings'})
  }
  const built=resolve(root,'dist',file)
  if(!existsSync(built)||digest(readFileSync(built))!==item.sha256)issues.push({file,problem:'build copy missing or different; run build first'})
  inventory.push(item)
}
for(const frame of frames) {
  const file=decodeURIComponent(frame.src.slice(1))
  const actual=inventory.find(x=>x.file===file)
  const [sw,sh]=frame.sheet; const [x,y,w,h]=frame.rect
  if(x<0||y<0||w<=0||h<=0||x+w>sw||y+h>sh)issues.push({file,problem:'sprite crop exceeds declared sheet',rect:frame.rect,sheet:frame.sheet})
  if(actual?.width && (actual.width!==sw||actual.height!==sh))warnings.push({file,problem:'sprite sheet dimensions differ',declared:frame.sheet,actual:[actual.width,actual.height]})
}
function walk(dir,prefix='') {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name),`${prefix}${e.name}/`):[`${prefix}${e.name}`])
}
const unused=walk(publicRoot).filter(file=>!files.has(file)&&/\.(png|jpg|mp3|m4a|woff2|task|wasm)$/.test(file))
const report={checkedAt:new Date().toISOString(),references:files.size,frames:frames.length,
  counts:inventory.reduce((acc,x)=>{const ext=extname(x.file);acc[ext]=(acc[ext]??0)+1;return acc},{}),
  issues,warnings,unusedCandidates:unused,inventory}
const output=resolve(root,'docs/review-20260929')
mkdirSync(output,{recursive:true})
writeFileSync(resolve(output,'asset-audit.json'),JSON.stringify(report,null,2)+'\n')

// A local, read-only media probe: actual browser decoders, no camera and no uploads.
const media=inventory.filter(x=>/\.(png|jpg|mp3|m4a|woff2)$/.test(x.file))
const page=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>영차마을 에셋 검증</title>
<style>body{font-family:system-ui;margin:32px;background:#f7f7f5;color:#18221d}li{margin:8px 0}.fail{color:#ab1724}#summary{font-size:24px;font-weight:700}</style>
<h1>영차마을 에셋 검증</h1><p>이미지·음원·글꼴 파일을 브라우저에서 열어 확인합니다. 소리는 재생하지 않습니다.</p><p id="summary">검사 중</p><ul id="results"></ul>
<script type="module">
const files=${JSON.stringify(media.map(x=>x.file))};let passed=0,failed=0;
for(const file of files){const li=document.createElement('li');try{
const src='/'+file.split('/').map(encodeURIComponent).join('/');let detail='';
if(/\\.(png|jpg)$/.test(file)){const image=new Image();image.src=src;await image.decode();detail=image.naturalWidth+'×'+image.naturalHeight;}
else if(file.endsWith('.woff2')){await new FontFace('audit-font','url('+src+')').load();detail='글꼴 로드';}
else{const audio=new Audio();await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('metadata timeout')),10000);audio.onloadedmetadata=()=>{clearTimeout(t);resolve()};audio.onerror=()=>{clearTimeout(t);reject(Error('audio decode'))};audio.preload='metadata';audio.src=src});if(!Number.isFinite(audio.duration)||audio.duration<=0)throw Error('invalid duration');detail=audio.duration.toFixed(2)+'초';audio.removeAttribute('src');audio.load();}
li.textContent='통과 · '+file+' · '+detail;passed++;
}catch(e){li.textContent='실패 · '+file+' · '+e.message;li.className='fail';failed++;}
document.getElementById('results').append(li);document.getElementById('summary').textContent='확인 '+(passed+failed)+' / '+files.length+' · 통과 '+passed+' · 실패 '+failed;
}document.getElementById('summary').dataset.complete='true';
</script></html>`
writeFileSync(resolve(output,'asset-check.html'),page)
console.log(JSON.stringify({...report,inventory:undefined,unusedCandidates:undefined,unusedCandidateCount:unused.length},null,2))
if(issues.length)process.exitCode=1
