const VERSION='0.4.2';
const SDK_URL=`https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@${VERSION}/+esm`;
const ORT_WASM='https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
const ENGINE=`PP-OCRv5-browser-${VERSION}`;
const LOW_MEMORY=Number(navigator.deviceMemory||4)<=4||/iPhone|iPad|iPod/i.test(navigator.userAgent);
const LIMIT_SIDE=LOW_MEMORY?736:960;
let modulePromise=null,enginePromise=null,busy=false,disposeTimer=0;

function emit(status,progress=0){dispatchEvent(new CustomEvent('luckybean:ocr-progress',{detail:{status,progress:Math.max(0,Math.min(100,Number(progress)||0))}}))}
async function loadModule(){if(!modulePromise){emit('正在加载PP-OCRv5官方网页SDK',2);modulePromise=import(SDK_URL).catch(e=>{modulePromise=null;throw new Error(`PP-OCRv5 SDK加载失败：${e.message}`)})}return modulePromise}
async function createEngine(worker){const m=await loadModule();if(!m?.PaddleOCR?.create)throw new Error('PP-OCRv5 SDK接口不可用');return m.PaddleOCR.create({lang:'ch',ocrVersion:'PP-OCRv5',worker,textDetectionBatchSize:1,textRecognitionBatchSize:1,ortOptions:{backend:'wasm',wasmPaths:ORT_WASM,numThreads:1,simd:true}})}
async function ensureEngine(){clearTimeout(disposeTimer);if(enginePromise)return enginePromise;enginePromise=(async()=>{emit('首次使用正在下载中文检测与识别模型',7);try{return await createEngine(true)}catch(workerError){emit('独立线程初始化失败，切换主线程兼容模式',10);try{return await createEngine(false)}catch(mainError){throw new Error(`PP-OCRv5初始化失败：${mainError.message||workerError.message}`)}}})().then(ocr=>{emit('PP-OCRv5中文模型已就绪',18);return ocr}).catch(e=>{enginePromise=null;throw e});return enginePromise}
async function dispose(){clearTimeout(disposeTimer);if(!enginePromise)return;const current=enginePromise;enginePromise=null;try{(await current)?.dispose?.()}catch{}}
function scheduleDispose(){clearTimeout(disposeTimer);disposeTimer=setTimeout(dispose,LOW_MEMORY?30000:120000)}
function meaningful(text){const chars=[...String(text||'')];if(!chars.length)return 0;return chars.filter(c=>/[\p{Script=Han}A-Za-z0-9年月日海拔处理烘焙庄园产区豆种%°./:+-]/u.test(c)).length/chars.length}
function normalizeItems(result,imageId){return (result?.items||[]).map(item=>({text:String(item?.text||'').trim(),confidence:Number(item?.score??0),polygon:item?.poly||null,imageId,engine:ENGINE})).filter(item=>item.text&&item.confidence>=.28&&meaningful(item.text)>=.55).sort((a,b)=>{const ay=Number(a.polygon?.[0]?.[1]||0),by=Number(b.polygon?.[0]?.[1]||0);return ay-by||Number(a.polygon?.[0]?.[0]||0)-Number(b.polygon?.[0]?.[0]||0)})}
async function predict(images){const ocr=await ensureEngine(),blocks=[],groups=[];for(let i=0;i<images.length;i++){const image=images[i];emit(`PP-OCRv5正在识别第${i+1}/${images.length}张图片`,20+Math.round(i/Math.max(1,images.length)*70));const [result]=await ocr.predict(image.blob,{textDetLimitSideLen:LIMIT_SIDE,textDetLimitType:'min',textDetMaxSideLimit:2200,textDetThresh:.22,textDetBoxThresh:.35,textDetUnclipRatio:1.55,textRecScoreThresh:.28});const current=normalizeItems(result,image.id);blocks.push(...current);if(current.length)groups.push(current.map(x=>x.text).join('\n'));await new Promise(r=>setTimeout(r,0))}if(!blocks.length)throw new Error('PP-OCRv5没有得到可信文字。请靠近文字区域拍摄，避免整只包装占画面过小。');emit('PP-OCRv5中英文识别完成',100);scheduleDispose();return{engine:`${ENGINE}${LOW_MEMORY?'-low-memory':'-worker'}`,blocks,fullText:groups.join('\n\n')}}
async function run(task){if(busy)throw new Error('识别任务正在运行，请勿重复点击');busy=true;try{return await task()}catch(error){await dispose();emit(`识别失败：${error.message}`,0);throw new Error(`${error.message}；本次未使用Tesseract乱码回退，可直接修正文字或补拍局部照片。`)}finally{busy=false;scheduleDispose()}}

globalThis.LuckyBeanPaddleOCR={version:VERSION,engine:ENGINE,lowMemory:LOW_MEMORY,recognizeCoffeeBag(images){return run(()=>predict(images))},async recognize(blob){const r=await run(()=>predict([{id:'single',blob}]));return{blocks:r.blocks}},dispose};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&LOW_MEMORY&&!busy)dispose()});addEventListener('pagehide',()=>{if(!busy)dispose()});document.documentElement.dataset.webOcr=`ppocr-v5-${VERSION}-trusted-only`;
