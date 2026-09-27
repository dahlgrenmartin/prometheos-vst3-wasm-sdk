import { validateDisplayList,validateSemantics } from "./graphics.js";
import { HOST_REQUEST_KIND,validateHostRequest,type HostRequest } from "./programs.js";
import type { InputEvent, ParameterInfo } from "./types.js";
export interface AbiCallbacks {request?:(value:HostRequest)=>void;submit:(kind:number,value:unknown)=>void;parameter:(op:number,id:number,value:number)=>void;invalidate:()=>void;diagnostic?:(code:string)=>void}
type Exports=Record<string,WebAssembly.ExportValue> & {memory:WebAssembly.Memory;wvui_version:()=>number;wvui_alloc:(bytes:number)=>number;wvui_free:(ptr:number,bytes:number)=>void;wvui_create:()=>number;wvui_destroy:(handle:number)=>void;wvui_resize:(handle:number,width:number,height:number,scale:number)=>void;wvui_event:(handle:number,ptr:number,bytes:number)=>void;wvui_parameter:(handle:number,id:number,value:number)=>void;wvui_frame:(handle:number,time:number)=>void;_initialize?:()=>void};
const required=["wvui_version","wvui_alloc","wvui_free","wvui_create","wvui_destroy","wvui_resize","wvui_event","wvui_parameter","wvui_frame"];
/** Validate declared memory limits before instantiation can allocate attacker-selected pages. */
export function validateMemory(bytes:Uint8Array,maxBytes:number) {
  let offset=8;const uleb=()=>{let value=0,shift=0;for(let i=0;i<5;i++){if(offset>=bytes.length)throw Error("UI_WASM_INVALID");const b=bytes[offset++];value+=(b&127)*2**shift;if(!(b&128))return value;shift+=7}throw Error("UI_WASM_INVALID")};
  let memories=0;
  while(offset<bytes.length){const type=bytes[offset++],size=uleb(),end=offset+size;if(end>bytes.length)throw Error("UI_WASM_INVALID");if(type===5){memories=uleb();if(memories!==1)throw Error("UI_MEMORY_BUDGET_EXCEEDED");const flags=uleb(),initial=uleb(),maximum=flags&1?uleb():undefined;if(flags!==1||maximum===undefined||initial>maximum||maximum*65536>maxBytes)throw Error("UI_MEMORY_BUDGET_EXCEEDED")}offset=end}
  if(memories!==1)throw Error("UI_WASM_INVALID: exported memory required");
}
/** Inline is for trusted test modules only: synchronous WASM cannot be preempted. Production uses worker.ts. */
export class InlineUi {
  private exports!:Exports;private handle=0;private closed=false;private knownParameters=new Set<number>();
  private constructor(private callbacks:AbiCallbacks,private maxMemoryBytes:number){}
  static async create(bytes:Uint8Array,callbacks:AbiCallbacks,maxMemoryBytes=64*1024*1024) {
    if(bytes.byteLength>16*1024*1024)throw Error("UI_WASM_BUDGET_EXCEEDED");
    validateMemory(bytes,maxMemoryBytes);
    const module=await WebAssembly.compile(new Uint8Array(bytes));
    for(const i of WebAssembly.Module.imports(module))if(i.module!=="webvst_ui"||i.kind!=="function"||!["submit","parameter","invalidate"].includes(i.name))throw Error("UI_IMPORT_FORBIDDEN");
    const self=new InlineUi(callbacks,maxMemoryBytes);
    const instance=await WebAssembly.instantiate(module,{webvst_ui:{
      submit:(kind:number,ptr:number,len:number)=>{
        try {const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(self.read(ptr,len,kind===HOST_REQUEST_KIND?4096:4*1024*1024)));if(kind===HOST_REQUEST_KIND){if(!callbacks.request)return -1;callbacks.request(validateHostRequest(parsed));return 0}if(kind===1)validateDisplayList(parsed);else if(kind===2)validateSemantics(parsed);else return -1;callbacks.submit(kind,parsed);return 0}
        catch {callbacks.diagnostic?.(kind===HOST_REQUEST_KIND?"UI_REQUEST_INVALID":kind===2?"UI_ACCESSIBILITY_INVALID":"UI_DISPLAY_LIST_INVALID");return -1}
      },
      parameter:(op:number,id:number,value:number)=>{if(![0,1,2].includes(op)||!self.knownParameters.has(id)||!Number.isFinite(value))return -1;callbacks.parameter(op,id,Math.max(0,Math.min(1,value)));return 0},
      invalidate:()=>callbacks.invalidate(),
    }});
    self.exports=instance.exports as Exports;
    if(!(self.exports.memory instanceof WebAssembly.Memory)||required.some(n=>typeof self.exports[n]!=="function"))throw Error("UI_ABI_INVALID");
    self.exports._initialize?.();if(self.exports.wvui_version()!==1)throw Error("UI_ABI_UNSUPPORTED");self.handle=self.exports.wvui_create();if(!self.handle)throw Error("UI_CREATE_FAILED");self.checkMemory();return self;
  }
  private checkMemory(){if(this.exports.memory.buffer.byteLength>this.maxMemoryBytes)throw Error("UI_MEMORY_BUDGET_EXCEEDED")}
  private read(ptr:number,len:number,max:number) {if(!this.exports||!Number.isInteger(ptr)||!Number.isInteger(len)||ptr<0||len<0||len>max||ptr>this.exports.memory.buffer.byteLength-len)throw Error("UI_BUFFER_INVALID");return new Uint8Array(this.exports.memory.buffer,ptr,len)}
  configure(parameters:readonly ParameterInfo[]) {this.knownParameters=new Set(parameters.map(p=>Number(p.id)).filter(p=>Number.isInteger(p)&&p>=0&&p<=0xffffffff));this.event({type:"parameters",parameters} as unknown as InputEvent)}
  event(event:InputEvent) {if(this.closed)return;const bytes=new TextEncoder().encode(JSON.stringify(event));if(bytes.length>1024*1024)throw Error("UI_EVENT_BUDGET_EXCEEDED");const ptr=this.exports.wvui_alloc(bytes.length);if(!ptr)throw Error("UI_ALLOCATION_FAILED");try{this.read(ptr,bytes.length,1024*1024).set(bytes);this.exports.wvui_event(this.handle,ptr,bytes.length);this.checkMemory()}finally{this.exports.wvui_free(ptr,bytes.length)}}
  parameter(id:number,value:number) {if(!this.closed&&this.knownParameters.has(id)&&Number.isFinite(value)){this.exports.wvui_parameter(this.handle,id,Math.max(0,Math.min(1,value)));this.checkMemory()}}
  resize(width:number,height:number,scale=1){if(!this.closed&&[width,height,scale].every(Number.isFinite)&&width>=0&&height>=0&&width<=32768&&height<=32768&&scale>0&&scale<=8){this.exports.wvui_resize(this.handle,width,height,scale);this.checkMemory()}}
  frame(time:number){if(!this.closed&&Number.isFinite(time)){this.exports.wvui_frame(this.handle,time);this.checkMemory()}}
  dispose(){if(this.closed)return;this.closed=true;this.exports.wvui_destroy(this.handle)}
}
