import { validateSemantics } from "./graphics.js";
import type { InputEvent, SemanticTree } from "./types.js";
/** DOM projection is host-owned. All labels are text, never package HTML. */
export class AccessibilityProjection {
  private elements=new Map<string,HTMLElement>();
  constructor(private container:HTMLElement,private send:(event:InputEvent)=>void){}
  update(value:unknown) {
    const tree=validateSemantics(value),ids=new Set(tree.nodes.map(n=>n.id));
    for(const [id,el] of this.elements)if(!ids.has(id)){el.remove();this.elements.delete(id)}
    for(const node of tree.nodes) {
      let el=this.elements.get(node.id);
      if(el&&el.dataset.role!==node.role){el.remove();this.elements.delete(node.id);el=undefined}
      if(!el) {
        el=document.createElement(node.role==="combobox"?"select":node.role==="slider"?"input":node.role==="button"||node.role==="switch"||node.role==="checkbox"?"button":"div");
        el.dataset.role=node.role;el.dataset.componentId=node.id;
        if(el instanceof HTMLInputElement){el.type="range";el.min="0";el.max="1";el.step="0.001"}
        el.setAttribute("role",node.role==="text"?"note":node.role);el.tabIndex=["text","group","meter"].includes(node.role)?-1:0;
        el.addEventListener("focus",()=>this.send({type:"focus",targetId:node.id}));
        el.addEventListener("blur",()=>this.send({type:"blur",targetId:node.id}));
        el.addEventListener("keydown",e=>{
          if(e.key==="Tab")return;
          if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","Enter"," ","Escape"].includes(e.key)){e.preventDefault();this.send({type:"keydown",targetId:node.id,key:e.key,shiftKey:e.shiftKey})}
        });
        el.addEventListener("input",()=>{if(el instanceof HTMLInputElement)this.send({type:"change",targetId:node.id,value:Number(el.value)})});
        el.addEventListener("change",()=>{if(el instanceof HTMLSelectElement)this.send({type:"change",targetId:node.id,value:Number(el.value)})});
        el.addEventListener("click",e=>{if(e.detail===0&&el instanceof HTMLButtonElement)this.send({type:"keydown",targetId:node.id,key:"Enter"})});
        Object.assign(el.style,{position:"absolute",opacity:"0.001",pointerEvents:"none",margin:"0",padding:"0",overflow:"hidden"});
        this.container.append(el);this.elements.set(node.id,el);
      }
      Object.assign(el.style,{left:`${node.bounds.x}px`,top:`${node.bounds.y}px`,width:`${node.bounds.width}px`,height:`${node.bounds.height}px`});
      el.setAttribute("aria-label",node.label);el.setAttribute("aria-disabled",String(!!node.disabled));
      if(el instanceof HTMLButtonElement||el instanceof HTMLInputElement||el instanceof HTMLSelectElement)el.disabled=!!node.disabled;
      if(el instanceof HTMLInputElement){el.value=String(node.value??0);el.setAttribute("aria-valuenow",String(node.value??0));el.setAttribute("aria-valuemin",String(node.min??0));el.setAttribute("aria-valuemax",String(node.max??1))}
      if(node.role==="switch"||node.role==="checkbox")el.setAttribute("aria-checked",String(!!node.checked));
      if(el instanceof HTMLSelectElement){const choices=node.choices??["Minimum","Maximum"];if(el.dataset.choices!==JSON.stringify(choices)){el.replaceChildren(...choices.map((choice,i)=>{const option=document.createElement("option");option.value=String(i/Math.max(1,choices.length-1));option.textContent=choice;return option}));el.dataset.choices=JSON.stringify(choices)}el.value=String(node.value??0)}
      else if(!(el instanceof HTMLInputElement))el.textContent=node.label;
    }
  }
  dispose(){for(const el of this.elements.values())el.remove();this.elements.clear()}
}
