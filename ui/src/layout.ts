import type { Graph, Rect, UiNode } from "./types.js";
function fixed(v:number|string|undefined):number|undefined {return typeof v==="number"?v:undefined}
function weight(v:number|string|undefined,n:UiNode):number {return typeof v==="string"?parseFloat(v):n.flex??1}
export function layout(graph:Graph,width:number,height:number):Map<string,Rect> {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<0||height<0) throw Error("UI_LAYOUT_INVALID: viewport");
  const boxes=new Map<string,Rect>();
  function place(id:string,b:Rect) {
    const original=graph.nodes.get(id)!;if(original.visible===false)return;
    const bp=original.breakpoints?.filter(b=>width<=b.maxWidth).sort((a,b)=>a.maxWidth-b.maxWidth)[0];
    const n={...original,...bp};
    b={...b,width:Math.max(n.minWidth??0,Math.min(n.maxWidth??Infinity,b.width)),height:Math.max(n.minHeight??0,Math.min(n.maxHeight??Infinity,b.height))};
    if(n.aspectRatio) b.height=Math.min(b.height,b.width/n.aspectRatio);
    boxes.set(id,b);
    const children=(graph.children.get(id)??[]).filter(c=>graph.nodes.get(c)!.visible!==false);
    if(!children.length)return;
    const pad=n.padding??0,gap=n.gap??0;
    const inner={x:b.x+pad,y:b.y+pad,width:Math.max(0,b.width-2*pad),height:Math.max(0,b.height-2*pad)};
    if(n.type==="grid") {
      const columns=n.columns??2,rows=Math.ceil(children.length/columns);
      const w=Math.max(0,(inner.width-gap*(columns-1))/columns),h=Math.max(0,(inner.height-gap*(rows-1))/rows);
      children.forEach((c,i)=>place(c,{x:inner.x+(i%columns)*(w+gap),y:inner.y+Math.floor(i/columns)*(h+gap),width:w,height:h}));return;
    }
    const row=n.type==="row",main=row?"width":"height",cross=row?"height":"width";
    const available=Math.max(0,inner[main]-gap*(children.length-1));
    const used=children.reduce((sum,c)=>sum+(fixed(graph.nodes.get(c)![main])??0),0);
    const weights=children.reduce((sum,c)=>{const child=graph.nodes.get(c)!;return sum+(fixed(child[main])===undefined?weight(child[main],child):0)},0);
    let offset=0;
    for(const c of children) {
      const child=graph.nodes.get(c)!;
      const size=fixed(child[main])??Math.max(0,available-used)*weight(child[main],child)/(weights||1);
      const across=Math.min(inner[cross],fixed(child[cross])??inner[cross]);
      const align=n.align??"stretch",crossOffset=align==="center"?(inner[cross]-across)/2:align==="end"?inner[cross]-across:0;
      place(c,row?{x:inner.x+offset,y:inner.y+crossOffset,width:size,height:across}:{x:inner.x+crossOffset,y:inner.y+offset,width:across,height:size});offset+=size+gap;
    }
  }
  const root=graph.nodes.get(graph.root)!;
  place(graph.root,{x:0,y:0,width:fixed(root.width)??width,height:fixed(root.height)??height});return boxes;
}
