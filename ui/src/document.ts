import type { Graph, ParameterInfo, UiDocument, UiNode } from "./types.js";
const types = new Set(["row","column","grid","label","button","toggle","slider","knob","combo","group","slot","image"]);
const stateful = new Set(["button","toggle","slider","knob","combo","slot"]);
const numeric = ["minWidth","minHeight","maxWidth","maxHeight","flex","padding","gap","columns","aspectRatio"] as const;
export function parseDocument(value:unknown, parameters:readonly ParameterInfo[]):Graph {
  if (!value || typeof value!=="object" || (value as UiDocument).version!==1) throw Error("UI_SCHEMA_INVALID: version");
  const doc=value as UiDocument;
  const graph:Graph={root:"",nodes:new Map(),children:new Map(),parents:new Map(),theme:{}};
  const ids=new Set(parameters.map(p=>p.id)); let anonymous=0;
  function visit(raw:UiNode, parent?:string, depth=0):string {
    if (!raw || typeof raw!=="object" || !types.has(raw.type) || depth>64 || graph.nodes.size>=4096) throw Error("UI_UNKNOWN_COMPONENT or tree budget");
    if (raw.id!==undefined && (typeof raw.id!=="string" || !raw.id || raw.id.length>256 || raw.id.startsWith("@"))) throw Error("UI_SCHEMA_INVALID: id");
    if (!raw.id && stateful.has(raw.type)) throw Error("UI_SCHEMA_INVALID: stable id required");
    const id=raw.id ?? `@anonymous-${anonymous++}`;
    if(graph.nodes.has(id)) throw Error("UI_SCHEMA_INVALID: duplicate id");
    if(raw.parameter!==undefined && (typeof raw.parameter!=="string" || !ids.has(raw.parameter))) throw Error("UI_BAD_PARAMETER_BINDING");
    for(const key of numeric) if(raw[key]!==undefined && (typeof raw[key]!=="number" || !Number.isFinite(raw[key]) || raw[key]!<0 || raw[key]!>1e6)) throw Error(`UI_LAYOUT_INVALID: ${key}`);
    if(raw.columns!==undefined && (!Number.isInteger(raw.columns)||raw.columns<1)) throw Error("UI_LAYOUT_INVALID: columns");
    if(raw.aspectRatio===0) throw Error("UI_LAYOUT_INVALID: aspect ratio");
    for(const key of ["width","height"] as const) if(raw[key]!==undefined && !(typeof raw[key]==="number"?Number.isFinite(raw[key])&&raw[key]>=0&&raw[key]<=1e6:/^(?:\d+(?:\.\d+)?)fr$/.test(raw[key]))) throw Error(`UI_LAYOUT_INVALID: ${key}`);
    for(const key of ["label","text","asset"] as const) if(raw[key]!==undefined && (typeof raw[key]!=="string" || raw[key]!.length>16384)) throw Error("UI_SCHEMA_INVALID: text");
    if(raw.children!==undefined && !Array.isArray(raw.children)) throw Error("UI_SCHEMA_INVALID: children");
    if(raw.choices!==undefined && (!Array.isArray(raw.choices)||raw.choices.length>4096||raw.choices.some(c=>typeof c!=="string"))) throw Error("UI_SCHEMA_INVALID: choices");
    if(raw.breakpoints!==undefined && (!Array.isArray(raw.breakpoints)||raw.breakpoints.length>32||raw.breakpoints.some(b=>!Number.isFinite(b.maxWidth)||b.maxWidth<0||(b.columns!==undefined&&(!Number.isInteger(b.columns)||b.columns<1))||(b.gap!==undefined&&(!Number.isFinite(b.gap)||b.gap<0))))) throw Error("UI_LAYOUT_INVALID: breakpoints");
    graph.nodes.set(id,{...raw,id});if(parent)graph.parents.set(id,parent);
    graph.children.set(id,(raw.children??[]).map(n=>visit(n,id,depth+1)));return id;
  }
  graph.root=visit(doc.root);
  if(doc.theme) for(const [key,v] of Object.entries(doc.theme)) {
    if(typeof v!=="string" && (typeof v!=="number"||!Number.isFinite(v))) throw Error("UI_SCHEMA_INVALID: theme");
    graph.theme[key]=v;
  }
  return graph;
}
export function generatedDocument(parameters:readonly ParameterInfo[]):UiDocument {
  return {version:1,root:{type:"column",id:"parameters",gap:8,padding:12,children:parameters.map(p=>({type:p.readOnly?"label":p.stepCount===1?"toggle":p.choices?.length?"combo":"slider",id:`parameter-${p.id}`,parameter:p.id,label:p.name,height:52}))}};
}
