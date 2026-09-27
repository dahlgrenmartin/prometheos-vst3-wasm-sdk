export interface WorkerPort {onmessage:((event:{data:any})=>void)|null;onerror:((event:unknown)=>void)|null;postMessage(message:unknown):void;terminate():void}
export interface SessionOptions {createWorker:()=>WorkerPort;requiredCapabilities:readonly string[];capabilities:readonly string[];timeoutMs?:number;onFallback:(code:string)=>void;onMessage:(message:any)=>void}
/** Owns only a UI Worker. No DSP handle is accepted or retained here. */
export class CustomSession {
  private worker?:WorkerPort;private timer?:ReturnType<typeof setTimeout>;private ended=false;private ready=false;private framePending=false;private pending=0;
  constructor(private options:SessionOptions){}
  start(wasm:Uint8Array) {
    if(this.worker||this.ended)return;
    if(this.options.requiredCapabilities.some(c=>!this.options.capabilities.includes(c))){this.fail("UI_CAPABILITY_MISSING");return}
    try {
      this.worker=this.options.createWorker();
      this.worker.onmessage=e=>{
        if(this.ended)return;
        if(e.data?.type==="error"){this.fail(e.data.code??"UI_WORKER_TRAP");return}
        if(e.data?.type==="ready"){this.ready=true;clearTimeout(this.timer);this.timer=undefined}
        if(e.data?.type==="done"){this.pending=Math.max(0,this.pending-1);if(e.data.frame!==false)this.framePending=false;if(!this.pending){clearTimeout(this.timer);this.timer=undefined}}
        this.options.onMessage(e.data);
      };
      this.worker.onerror=()=>this.fail("UI_WORKER_TRAP");this.watch();this.worker.postMessage({type:"start",wasm});
    } catch {this.fail("UI_WORKER_TRAP")}
  }
  private watch(){if(!this.timer)this.timer=setTimeout(()=>this.fail("UI_WORKER_TIMEOUT"),this.options.timeoutMs??2000)}
  send(message:unknown){if(this.ended||!this.worker)return;if(++this.pending>4096){this.fail("UI_WORKER_BUDGET_EXCEEDED");return}this.watch();try{this.worker.postMessage(message)}catch{this.fail("UI_WORKER_TRAP")}}
  frame(time:number){if(!this.ready||this.framePending||this.ended)return;this.framePending=true;this.send({type:"frame",time})}
  private fail(code:string){if(this.ended)return;this.dispose();this.options.onFallback(code)}
  dispose(){if(this.ended)return;this.ended=true;clearTimeout(this.timer);this.worker?.terminate();this.worker=undefined}
}
