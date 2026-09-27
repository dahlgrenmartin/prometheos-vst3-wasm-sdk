import type { Command, DisplayList, Rect, SemanticTree } from "./types.js";
const finite=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=1e7;
const logical=(v:unknown)=>typeof v==="string"&&/^[a-zA-Z0-9_.-]{1,256}$/.test(v)&&v!=="..";
function rect(c:Record<string,unknown>) {return ["x","y","width","height"].every(k=>finite(c[k]))&&(c.width as number)>=0&&(c.height as number)>=0}
function invalid():never{throw Error("UI_DISPLAY_LIST_INVALID")}
export function validateDisplayList(value:unknown,maxCommands=65536):DisplayList {
  const list=value as DisplayList;if(!list||list.version!==1||!Array.isArray(list.commands)||list.commands.length>maxCommands)invalid();
  let depth=0;
  for(const c of list.commands) {
    if(!c||typeof c!=="object")invalid();
    if(c.opacity!==undefined&&(!finite(c.opacity)||(c.opacity as number)<0||(c.opacity as number)>1))invalid();
    if(c.color!==undefined&&(typeof c.color!=="string"||c.color.length>128))invalid();
    if(c.lineWidth!==undefined&&(!finite(c.lineWidth)||(c.lineWidth as number)<0))invalid();
    switch(c.op) {
      case "save":if(++depth>64)invalid();break;
      case "restore":if(--depth<0)invalid();break;
      case "rect":case "clip":if(!rect(c))invalid();if(c.radius!==undefined&&(!finite(c.radius)||(c.radius as number)<0))invalid();break;
      case "line":if(![c.x1,c.y1,c.x2,c.y2,c.width].every(finite)||(c.width as number)<0)invalid();break;
      case "text":if(![c.x,c.y,c.size].every(finite)||(c.size as number)<=0||(c.size as number)>4096||typeof c.text!=="string"||c.text.length>16384||!logical(c.font)||(c.align!==undefined&&!["left","center","right"].includes(c.align as string)))invalid();break;
      case "transform":if(!Array.isArray(c.matrix)||c.matrix.length!==6||!c.matrix.every(finite))invalid();break;
      case "image":if(!rect(c)||!logical(c.asset))invalid();break;
      case "path":if(!Array.isArray(c.points)||c.points.length>65536||c.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)))invalid();break;
      default:invalid();
    }
  }
  if(depth!==0)invalid();return list;
}
export function validateSemantics(value:unknown):SemanticTree {
  const tree=value as SemanticTree;const ids=new Set<string>();const roles=new Set(["text","slider","switch","checkbox","button","combobox","meter","group"]);
  if(!tree||tree.version!==1||!Array.isArray(tree.nodes)||tree.nodes.length>10000)throw Error("UI_ACCESSIBILITY_INVALID");
  for(const n of tree.nodes) {
    if(!n||typeof n.id!=="string"||!n.id||n.id.length>256||ids.has(n.id)||!roles.has(n.role)||typeof n.label!=="string"||n.label.length>16384||!n.bounds||!rect(n.bounds as unknown as Record<string,unknown>)||(n.value!==undefined&&typeof n.value!=="string"&&!finite(n.value))||(n.min!==undefined&&!finite(n.min))||(n.max!==undefined&&!finite(n.max))||(n.choices!==undefined&&(!Array.isArray(n.choices)||n.choices.length>4096||n.choices.some(c=>typeof c!=="string"))))throw Error("UI_ACCESSIBILITY_INVALID");
    ids.add(n.id);
  }return tree;
}
export interface RenderResources {image(id:string):CanvasImageSource|undefined;font(id:string):string|undefined;missing?(id:string):void}
export function renderCanvas(ctx:CanvasRenderingContext2D,value:unknown,resources?:RenderResources) {
  const list=validateDisplayList(value);ctx.save();
  try {for(const c of list.commands) {
    const n=(k:string)=>c[k] as number;
    if(c.color!==undefined){ctx.fillStyle=String(c.color);ctx.strokeStyle=String(c.color)}
    ctx.globalAlpha=c.opacity===undefined?1:n("opacity");
    switch(c.op) {
      case "save":ctx.save();break;case "restore":ctx.restore();break;
      case "rect":ctx.beginPath();if(c.radius)ctx.roundRect(n("x"),n("y"),n("width"),n("height"),n("radius"));else ctx.rect(n("x"),n("y"),n("width"),n("height"));if(c.stroke){ctx.lineWidth=n("lineWidth")||1;ctx.stroke()}else ctx.fill();break;
      case "line":ctx.beginPath();ctx.moveTo(n("x1"),n("y1"));ctx.lineTo(n("x2"),n("y2"));ctx.lineWidth=n("width");ctx.stroke();break;
      case "text":ctx.font=`${n("size")}px ${resources?.font(String(c.font))??"sans-serif"}`;ctx.textAlign=(c.align as CanvasTextAlign|undefined)??"left";ctx.fillText(String(c.text),n("x"),n("y"));break;
      case "clip":ctx.beginPath();ctx.rect(n("x"),n("y"),n("width"),n("height"));ctx.clip();break;
      case "transform":ctx.transform(...c.matrix as [number,number,number,number,number,number]);break;
      case "image":{const resource=resources?.image(String(c.asset));if(resource)ctx.drawImage(resource,n("x"),n("y"),n("width"),n("height"));else {resources?.missing?.(String(c.asset));ctx.fillStyle="#777";ctx.fillRect(n("x"),n("y"),n("width"),n("height"))}break}
      case "path":{const points=c.points as number[][];ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(c.closed)ctx.closePath();if(c.stroke){ctx.lineWidth=n("lineWidth")||1;ctx.stroke()}else ctx.fill();break}
    }
  }}finally{ctx.restore()}
}
