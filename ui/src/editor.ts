import { parseDocument, generatedDocument } from "./document.js";
import { layout } from "./layout.js";
import { Parameters } from "./parameters.js";
import type { Command, Frame, Graph, InputEvent, ParameterHost, Rect, SemanticNode } from "./types.js";
const interactive=new Set(["slider","knob","toggle","button","combo"]);
export const defaultTheme={background:"#242527",surface:"#34363a",text:"#eeeeee",muted:"#bbbbbb",accent:"#ff9900",header:"#15558f",focus:"#79beff",fontSize:14,controlHeight:52};
export class DeclarativeEditor {
  readonly graph:Graph;readonly parameters:Parameters;
  private boxes=new Map<string,Rect>();private focused?:string;
  private drag?:{id:string;pointerId:number;x:number;y:number;value:number};
  private width=640;private height=480;private disposed=false;
  constructor(document:unknown,host:ParameterHost,private invalidate:()=>void=()=>{}) {
    this.graph=parseDocument(document??generatedDocument(host.metadata),host.metadata);
    this.parameters=new Parameters(host,invalidate);this.resize(this.width,this.height);
  }
  resize(width:number,height:number) {this.width=width;this.height=height;this.boxes=layout(this.graph,width,height);this.invalidate()}
  get size(){const r=this.boxes.get(this.graph.root)!;return {width:Math.max(this.width,r.width),height:Math.max(this.height,r.height)}}
  private hit(x:number,y:number) {return [...this.boxes].reverse().find(([id,b])=>interactive.has(this.graph.nodes.get(id)!.type)&&x>=b.x&&y>=b.y&&x<b.x+b.width&&y<b.y+b.height)?.[0]}
  input(e:InputEvent) {
    if(this.disposed)return;
    if(e.type==="blur"||e.type==="pointercancel") {this.parameters.cancel();this.drag=undefined;this.invalidate();return}
    if(e.type==="keydown"&&e.key==="Tab") {
      const ids=[...this.boxes.keys()].filter(id=>interactive.has(this.graph.nodes.get(id)!.type)&&!this.graph.nodes.get(id)!.disabled);
      const next=ids.indexOf(this.focused??"")+(e.shiftKey?-1:1);this.focused=ids[(next+ids.length)%ids.length];this.invalidate();return;
    }
    const id=this.drag?.id??e.targetId??(e.x!==undefined&&e.y!==undefined?this.hit(e.x,e.y):this.focused);
    const node=id?this.graph.nodes.get(id):undefined;
    if(!id||!node||!this.boxes.has(id)||node.disabled)return;
    if(e.type==="focus"){this.focused=id;this.invalidate();return}
    const p=node.parameter;if(!p||this.parameters.metadata.get(p)?.readOnly)return;
    const info=this.parameters.metadata.get(p)!,value=this.parameters.value(p),step=info.stepCount?1/info.stepCount:(e.shiftKey?0.001:0.01);
    const change=(v:number)=>this.parameters.change(p,v);
    if(e.type==="change"&&Number.isFinite(e.value))change(e.value!);
    if(e.type==="keydown") {
      if(["ArrowRight","ArrowUp"].includes(e.key??""))change(value+step);
      if(["ArrowLeft","ArrowDown"].includes(e.key??""))change(value-step);
      if(e.key==="Home")change(0);if(e.key==="End")change(1);
      if(e.key==="Enter"||e.key===" ")change(node.type==="combo"?(value>=1?0:value+step):value>=0.5?0:1);
      if(e.key==="Escape"){this.parameters.cancel();this.drag=undefined}
    }
    if(e.type==="pointerdown"&&(e.button??0)===0&&!this.drag) {
      this.focused=id;
      if(node.type==="toggle"||node.type==="button")change(value>=0.5?0:1);
      else if(node.type==="combo")change(value>=1?0:value+step);
      else {this.parameters.begin(p);this.drag={id,pointerId:e.pointerId??0,x:e.x??0,y:e.y??0,value}}
    }
    if(e.type==="pointermove"&&this.drag&&(e.pointerId??0)===this.drag.pointerId) {
      const b=this.boxes.get(id)!;
      const delta=node.orientation==="vertical"||node.type==="knob"?((this.drag.y-(e.y??this.drag.y))/Math.max(50,b.height)):(((e.x??this.drag.x)-this.drag.x)/Math.max(50,b.width));
      this.parameters.set(p,this.drag.value+delta*(e.shiftKey?0.1:1));
    }
    if(e.type==="pointerup"&&this.drag&&(e.pointerId??0)===this.drag.pointerId) {this.parameters.end(p);this.drag=undefined}
    this.invalidate();
  }
  frame():Frame {
    const t={...defaultTheme,...this.graph.theme};
    const color=(k:keyof typeof defaultTheme)=>String(t[k]);const font=Number(t.fontSize)||14;
    const commands:Command[]=[{op:"rect",x:0,y:0,width:this.size.width,height:this.size.height,color:color("background")}];const semantics:SemanticNode[]=[];
    for(const [id,b] of this.boxes) {
      const n=this.graph.nodes.get(id)!;const p=n.parameter;const label=n.label??(p?this.parameters.metadata.get(p)!.name:"");
      const text=(s:string,x=b.x+8,y=b.y+font+5,size=font,c=color("text"))=>commands.push({op:"text",text:s,x,y,size,color:c,font:"body"});
      if(["group","button","combo","toggle","slider","knob"].includes(n.type))commands.push({op:"rect",...b,color:color("surface")});
      if(n.type==="label")text(n.text??label);
      if(n.type==="image"&&n.asset)commands.push({op:"image",...b,asset:n.asset});
      if(n.type==="group"&&label){commands.push({op:"rect",...b,height:font+12,color:color("header")});text(label)}
      if(interactive.has(n.type)) {
        const value=p?this.parameters.value(p):0;const disabled=!!n.disabled||!!(p&&this.parameters.metadata.get(p)!.readOnly);
        text(label);if(p)text(this.parameters.text(p),b.x+8,b.y+b.height-6,Math.max(10,font-2),color("muted"));
        if(n.type==="slider"||n.type==="knob") {
          const vertical=n.orientation==="vertical";const x1=b.x+10,y1=b.y+b.height/2,x2=b.x+b.width-10;
          commands.push({op:"line",x1:vertical?b.x+b.width/2:x1,y1:vertical?b.y+25:y1,x2:vertical?b.x+b.width/2:x2,y2:vertical?b.y+b.height-23:y1,width:3,color:"#111111"});
          commands.push({op:"rect",x:vertical?b.x+b.width/2-5:x1+value*Math.max(0,b.width-20)-5,y:vertical?b.y+25+(1-value)*Math.max(0,b.height-48)-5:y1-5,width:10,height:10,radius:5,color:color("accent")});
        } else if(n.type==="toggle"||n.type==="button")commands.push({op:"rect",x:b.x+b.width-24,y:b.y+8,width:14,height:14,radius:2,color:value>=0.5?color("accent"):"#111111"});
        if(this.focused===id)commands.push({op:"rect",...b,color:color("focus"),stroke:true,lineWidth:2});
        semantics.push({id,role:n.type==="toggle"?"switch":n.type==="button"?"button":n.type==="combo"?"combobox":"slider",label,value,min:0,max:1,checked:value>=0.5,bounds:b,parameter:p,disabled,choices:n.choices??(p?this.parameters.metadata.get(p)!.choices:undefined)});
      } else if(n.type==="label")semantics.push({id,role:"text",label:n.text??label,bounds:b});
    }
    return {display:{version:1,commands},semantics:{version:1,nodes:semantics}};
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.parameters.dispose();this.drag=undefined}
}
