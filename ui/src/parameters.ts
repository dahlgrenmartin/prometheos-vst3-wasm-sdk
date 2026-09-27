import type { ParameterHost, ParameterInfo } from "./types.js";
export class Parameters {
  readonly metadata:Map<string,ParameterInfo>;
  private values=new Map<string,number>();private gestures=new Set<string>();private unsubscribe:()=>void;private disposed=false;
  constructor(private host:ParameterHost,private changed:()=>void=()=>{}) {
    this.metadata=new Map();
    for(const p of host.metadata) {
      if(this.metadata.has(p.id)||!Number.isInteger(p.stepCount)||p.stepCount<0||!Number.isFinite(p.defaultValue))throw Error("UI_BAD_PARAMETER_BINDING: metadata");
      this.metadata.set(p.id,p);this.values.set(p.id,this.normalize(p.id,host.get(p.id)));
    }
    this.unsubscribe=host.subscribe((id,value)=>{if(!this.disposed&&this.metadata.has(id)&&Number.isFinite(value)){this.values.set(id,this.normalize(id,value));this.changed()}});
  }
  normalize(id:string,value:number) {const p=this.metadata.get(id);if(!p||!Number.isFinite(value))throw Error("UI_BAD_PARAMETER_BINDING");const v=Math.max(0,Math.min(1,value));return p.stepCount?Math.round(v*p.stepCount)/p.stepCount:v}
  value(id:string) {if(!this.values.has(id))throw Error("UI_BAD_PARAMETER_BINDING");return this.values.get(id)!}
  text(id:string) {const p=this.metadata.get(id)!;const v=this.value(id);return p.format?.(v)??p.choices?.[Math.round(v*p.stepCount)]??`${Math.round(v*1000)/10}%`}
  begin(id:string) {if(this.disposed||this.metadata.get(id)?.readOnly||!this.metadata.has(id)||this.gestures.has(id))return;this.host.begin(id);this.gestures.add(id)}
  set(id:string,value:number) {if(this.disposed||this.metadata.get(id)?.readOnly||!this.metadata.has(id))return;this.host.set(id,this.normalize(id,value))}
  end(id:string) {if(this.gestures.delete(id))this.host.end(id)}
  change(id:string,value:number) {this.begin(id);try{this.set(id,value)}finally{this.end(id)}}
  cancel() {for(const id of [...this.gestures])this.end(id)}
  dispose() {if(this.disposed)return;this.disposed=true;this.cancel();this.unsubscribe()}
}
