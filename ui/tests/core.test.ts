import { describe, it, expect } from "vitest";
import { parseDocument, generatedDocument } from "../src/document";
import { layout } from "../src/layout";
import { Parameters } from "../src/parameters";
import { DeclarativeEditor } from "../src/editor";

const metadata = [{id:"7",name:"Cutoff",defaultValue:0.5,stepCount:4}];
function service() {
  let value = 0.5;
  const events: unknown[] = [];
  const listeners = new Set<(id:string,value:number)=>void>();
  return {metadata,events,get:()=>value,begin:(id:string)=>events.push(["begin",id]),set:(id:string,v:number)=>events.push(["set",id,v]),end:(id:string)=>events.push(["end",id]),subscribe:(fn:(id:string,v:number)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},publish(v:number){value=v;listeners.forEach(fn=>fn("7",v))}};
}
describe("declarative core",()=>{
  it("normalizes stable identities and rejects duplicate or missing interactive IDs",()=>{
    const doc = generatedDocument(metadata);
    const graph = parseDocument(doc,metadata);
    expect(graph.nodes.get("parameter-7")?.parameter).toBe("7");
    expect(()=>parseDocument({version:1,root:{type:"column",children:[{type:"slider",parameter:"7"}]}},metadata)).toThrow(/id/i);
    expect(()=>parseDocument({version:1,root:{type:"column",id:"x",children:[{type:"label",id:"x"}]}},metadata)).toThrow(/duplicate/i);
  });
  it("rejects excessive nesting, nonfinite dimensions and unknown bindings",()=>{
    let root:any={type:"label"}; for(let i=0;i<70;i++) root={type:"column",children:[root]};
    expect(()=>parseDocument({version:1,root},metadata)).toThrow();
    expect(()=>parseDocument({version:1,root:{type:"label",width:NaN}},metadata)).toThrow();
    expect(()=>parseDocument({version:1,root:{type:"knob",id:"a",parameter:"no"}},metadata)).toThrow();
  });
  it("lays out padded rows and grids deterministically and excludes hidden nodes",()=>{
    const graph=parseDocument({version:1,root:{type:"row",id:"r",padding:10,gap:10,children:[{type:"label",id:"a",width:50},{type:"label",id:"b",width:"1fr"},{type:"label",id:"c",visible:false}]}},[]);
    const boxes=layout(graph,210,100);
    expect(boxes.get("a")).toEqual({x:10,y:10,width:50,height:80});
    expect(boxes.get("b")).toEqual({x:70,y:10,width:130,height:80});
    expect(boxes.has("c")).toBe(false);
  });
  it("requests stepped values without replacing canonical state, closing gestures exactly once",()=>{
    const host=service(); const p=new Parameters(host);
    p.begin("7");p.begin("7");p.set("7",0.69);
    expect(p.value("7")).toBe(0.5);
    expect(host.events).toEqual([["begin","7"],["set","7",0.75]]);
    host.publish(0.75); expect(p.value("7")).toBe(0.75);
    p.dispose();p.dispose();expect(host.events.at(-1)).toEqual(["end","7"]);
    expect(host.events.length).toBe(3);
  });
  it("routes pointer and keyboard changes, exposes semantics and releases on blur",()=>{
    const host=service(); const editor=new DeclarativeEditor(generatedDocument(metadata),host);
    editor.resize(320,160);
    const node=editor.frame().semantics.nodes.find(n=>n.parameter==="7")!;
    expect(node.role).toBe("slider");
    editor.input({type:"keydown",targetId:node.id,key:"ArrowRight"});
    expect(host.events).toEqual([["begin","7"],["set","7",0.75],["end","7"]]);
    editor.input({type:"pointerdown",targetId:node.id,x:40,y:40,pointerId:3});
    editor.input({type:"blur"});editor.dispose();
    expect(host.events.filter((e:any)=>e[0]==="begin").length).toBe(host.events.filter((e:any)=>e[0]==="end").length);
  });
  it("keeps two editors subscribed independently and recreates without a DSP service call",()=>{
    const host=service(); const a=new DeclarativeEditor(undefined,host),b=new DeclarativeEditor(undefined,host);
    a.dispose();host.publish(1); expect(b.parameters.value("7")).toBe(1);b.dispose();
    expect(host.events).toEqual([]);
  });
});
