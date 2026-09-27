import { AccessibilityProjection } from "./accessibility.js";
import { DeclarativeEditor } from "./editor.js";
import { renderCanvas,validateDisplayList,validateSemantics } from "./graphics.js";
import { CustomSession, type WorkerPort } from "./session.js";
import { CORE_CAPABILITIES,type Diagnostics,type DisplayList,type InputEvent,type ParameterHost,type ProgramHost,type SemanticTree } from "./types.js";
import { PROGRAMS_CAPABILITY,programEvent,validateHostRequest } from "./programs.js";
import type { AssetCache } from "./assets.js";
export interface EditorOptions {
  container:HTMLElement;parameters:ParameterHost;document?:unknown;
  packageId?:string;editorId?:string;diagnostic?:Diagnostics;
  custom?:{wasm:Uint8Array;requiredCapabilities?:string[];optionalCapabilities?:string[]};
  capabilities?:string[];createWorker?:()=>WorkerPort;disableCustom?:boolean;
  assets?:AssetCache;assetIds?:string[];timeoutMs?:number;
  /** Optional host program (preset) service; negotiated as host.programs/1. */
  programs?:ProgramHost;
}
let serial=0;
export function mountEditor(options:EditorOptions) {
  const editorId=options.editorId??`editor-${++serial}`;
  const diagnostic=(code:string,message=code)=>options.diagnostic?.({severity:"warning",subsystem:"ui",packageId:options.packageId??"unknown",editorId,code,message});
  const surface=document.createElement("div");Object.assign(surface.style,{position:"relative",overflow:"hidden"});
  const canvas=document.createElement("canvas");canvas.tabIndex=0;canvas.setAttribute("aria-label","Plugin editor");canvas.style.display="block";canvas.style.touchAction="none";
  surface.append(canvas);options.container.append(surface);
  const ctx=canvas.getContext("2d");if(!ctx){surface.remove();throw Error("Canvas2D unavailable")}
  let ended=false,visible=true,raf=0,customReady=false,session:CustomSession|undefined,width=640,height=480,scale=1;
  let pendingDisplay:DisplayList|undefined,pendingSemantics:SemanticTree|undefined,customDisplay:DisplayList|undefined,customSemantics:SemanticTree|undefined,invalidFrame=false;
  const images=new Map<string,CanvasImageSource>(),fonts=new Map<string,string>(),releases:Array<()=>void>=[],missing=new Set<string>();
  let editor:DeclarativeEditor;
  const schedule=()=>{if(!ended&&visible&&!raf)raf=requestAnimationFrame(draw)};
  try{editor=new DeclarativeEditor(options.document,options.parameters,schedule)}catch(e){diagnostic("UI_SCHEMA_INVALID",String(e));editor=new DeclarativeEditor(undefined,options.parameters,schedule)}
  function input(event:InputEvent){if(ended)return;if(customReady)session?.send({type:"event",event});else editor.input(event)}
  const accessibility=new AccessibilityProjection(surface,input);
  const resources={image:(id:string)=>images.get(id),font:(id:string)=>fonts.get(id),missing:(id:string)=>{if(!missing.has(id)){missing.add(id);diagnostic("UI_ASSET_MISSING",id)}}};
  function paint(display:DisplayList,semantics:SemanticTree){ctx!.setTransform(scale,0,0,scale,0,0);ctx!.clearRect(0,0,canvas.width/scale,canvas.height/scale);renderCanvas(ctx!,display,resources);accessibility.update(semantics)}
  function draw(time:number){raf=0;if(ended||!visible)return;if(customReady){if(customDisplay&&customSemantics)paint(customDisplay,customSemantics);session?.frame(time)}else{const frame=editor.frame();paint(frame.display,frame.semantics)}}
  function resize(w:number,h:number,dpi=globalThis.devicePixelRatio||1){if(ended||![w,h,dpi].every(Number.isFinite)||w<=0||h<=0||w>16384||h>32768)return;width=w;height=h;scale=Math.max(0.5,Math.min(3,dpi));editor.resize(w,h);const size=customReady?{width:w,height:h}:editor.size;
    // Bound backing allocation independently of CSS content dimensions (long fallback editors scroll).
    scale=Math.min(scale,Math.sqrt(32*1024*1024/Math.max(1,size.width*size.height)));
    canvas.width=Math.ceil(size.width*scale);canvas.height=Math.ceil(size.height*scale);canvas.style.width=`${size.width}px`;canvas.style.height=`${size.height}px`;surface.style.width=`${size.width}px`;surface.style.height=`${size.height}px`;if(customReady)session?.send({type:"resize",width:w,height:h,scale});schedule()}
  const abort=new AbortController();
  for(const type of ["pointerdown","pointermove","pointerup","pointercancel"] as const)canvas.addEventListener(type,e=>{
    const b=canvas.getBoundingClientRect();if(type==="pointerdown"){canvas.focus();canvas.setPointerCapture(e.pointerId)}
    input({type,x:e.clientX-b.left,y:e.clientY-b.top,pointerId:e.pointerId,button:e.button,buttons:e.buttons,pointerType:e.pointerType,pressure:e.pressure,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,altKey:e.altKey,metaKey:e.metaKey});
    if((type==="pointerup"||type==="pointercancel")&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  },{signal:abort.signal});
  canvas.addEventListener("lostpointercapture",()=>input({type:"pointercancel"}),{signal:abort.signal});
  canvas.addEventListener("blur",()=>input({type:"blur"}),{signal:abort.signal});
  canvas.addEventListener("keydown",e=>{if(e.key==="Tab")return;e.preventDefault();input({type:"keydown",key:e.key,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,altKey:e.altKey,metaKey:e.metaKey})},{signal:abort.signal});
  canvas.addEventListener("wheel",e=>{if(!customReady)return;e.preventDefault();const b=canvas.getBoundingClientRect(),unit=e.deltaMode===1?16:e.deltaMode===2?b.height:1;input({type:"wheel",x:e.clientX-b.left,y:e.clientY-b.top,deltaX:e.deltaX*unit,deltaY:e.deltaY*unit,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,altKey:e.altKey,metaKey:e.metaKey})},{signal:abort.signal,passive:false});
  function fallback(code:string){customReady=false;session=undefined;editor.parameters.cancel();diagnostic(code);resize(width,height,scale);schedule()}
  const unsubscribe=options.parameters.subscribe((id,value)=>{if(customReady)session?.send({type:"parameter",id:Number(id),value})});
  const sendProgram=()=>{if(customReady&&options.programs){const {category,program}=options.programs.current();session?.send({type:"event",event:{type:"program",category,program}})}};
  const unsubscribePrograms=options.programs?.subscribe(sendProgram)??(()=>{});
  if(options.custom&&!options.disableCustom){
    const capabilities=options.capabilities??[...CORE_CAPABILITIES,...(options.programs?[PROGRAMS_CAPABILITY]:[])];
    session=new CustomSession({createWorker:options.createWorker??(()=>new Worker(new URL("./worker-entry.ts",import.meta.url),{type:"module"}) as unknown as WorkerPort),requiredCapabilities:options.custom.requiredCapabilities??[],capabilities,timeoutMs:options.timeoutMs,onFallback:fallback,onMessage:m=>{
      if(m.type==="ready") {customReady=true;session?.send({type:"configure",parameters:options.parameters.metadata.map(({format,...p})=>p)});for(const p of options.parameters.metadata)session?.send({type:"parameter",id:Number(p.id),value:options.parameters.get(p.id)});if(options.programs&&capabilities.includes(PROGRAMS_CAPABILITY)){try{session?.send({type:"event",event:programEvent(options.programs.categories)});sendProgram()}catch(e){diagnostic("UI_PROGRAMS_BUDGET_EXCEEDED",String(e))}}resize(width,height,scale)}
      else if(m.type==="host-request") {try{const r=validateHostRequest(m.value);const list=options.programs?.categories;if(!list||!capabilities.includes(PROGRAMS_CAPABILITY)||r.category>=list.length||r.program>=list[r.category]!.programs.length)throw Error("UI_REQUEST_INVALID");options.programs!.select(r.category,r.program)}catch(e){diagnostic("UI_REQUEST_INVALID",String(e))}}
      else if(m.type==="submit") {try{if(m.kind===1)pendingDisplay=validateDisplayList(m.value);else if(m.kind===2)pendingSemantics=validateSemantics(m.value)}catch(e){invalidFrame=true;diagnostic("UI_DISPLAY_LIST_INVALID",String(e))}}
      else if(m.type==="diagnostic"){invalidFrame=true;diagnostic(m.code)}
      else if(m.type==="done"&&m.frame){if(!invalidFrame&&pendingDisplay&&pendingSemantics){customDisplay=pendingDisplay;customSemantics=pendingSemantics;if(visible)paint(customDisplay,customSemantics)}pendingDisplay=undefined;pendingSemantics=undefined;invalidFrame=false}
      else if(m.type==="request") {const id=String(m.id);if(!editor.parameters.metadata.has(id))return;if(m.op===0)editor.parameters.begin(id);else if(m.op===1)editor.parameters.set(id,m.value);else if(m.op===2)editor.parameters.end(id)}
      else if(m.type==="invalidate")schedule();
    }});session.start(options.custom.wasm);
  }
  if(options.assets)for(const id of options.assetIds??[])options.assets.acquire(id).then(asset=>{if(ended){asset.release();return}releases.push(asset.release);if(typeof asset.value==="string")fonts.set(id,asset.value);else if(!(asset.value instanceof Uint8Array))images.set(id,asset.value as CanvasImageSource);schedule()}).catch(e=>diagnostic("UI_ASSET_MISSING",String(e)));
  resize(Math.max(1,options.container.clientWidth||640),Math.max(1,options.container.clientHeight||480));
  return {
    canvas,resize,
    get mode(){return customReady?"custom":options.document?"declarative":"generated"},
    setVisible(value:boolean){visible=value;if(!value){input({type:"blur"});editor.parameters.cancel();cancelAnimationFrame(raf);raf=0}else schedule()},
    dispose(){if(ended)return;ended=true;cancelAnimationFrame(raf);session?.dispose();unsubscribe();unsubscribePrograms();editor.dispose();accessibility.dispose();abort.abort();releases.forEach(release=>release());surface.remove()},
  };
}
