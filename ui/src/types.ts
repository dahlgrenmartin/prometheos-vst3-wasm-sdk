export interface Rect { x:number; y:number; width:number; height:number }
export interface ParameterInfo { id:string; name:string; defaultValue:number; stepCount:number; choices?:string[]; readOnly?:boolean; format?:(value:number)=>string }
export interface ParameterHost {
  metadata:readonly ParameterInfo[];
  get(id:string):number;
  begin(id:string):void;
  set(id:string,value:number):void;
  end(id:string):void;
  subscribe(listener:(id:string,value:number)=>void):()=>void;
}
export interface UiNode {
  type:string; id?:string; parameter?:string; label?:string; text?:string; asset?:string;
  children?:UiNode[]; width?:number|string; height?:number|string;
  minWidth?:number; minHeight?:number; maxWidth?:number; maxHeight?:number;
  flex?:number; padding?:number; gap?:number; columns?:number; aspectRatio?:number;
  align?:"start"|"center"|"end"|"stretch"; orientation?:"horizontal"|"vertical";
  visible?:boolean; disabled?:boolean; choices?:string[];
  breakpoints?:Array<{maxWidth:number;columns?:number;gap?:number}>;
}
export interface UiDocument { version:1; root:UiNode; theme?:Record<string,string|number> }
export interface Graph { root:string; nodes:Map<string,UiNode & {id:string}>; children:Map<string,string[]>; parents:Map<string,string>; theme:Record<string,string|number> }
export interface InputEvent {
  type:string; targetId?:string; x?:number; y?:number; pointerId?:number; pointerType?:string;
  pressure?:number; button?:number; buttons?:number; key?:string; shiftKey?:boolean;
  ctrlKey?:boolean; altKey?:boolean; metaKey?:boolean; value?:number; deltaX?:number; deltaY?:number;
}
export interface SemanticNode { id:string; role:string; label:string; value?:number|string; min?:number; max?:number; checked?:boolean; bounds:Rect; parameter?:string; disabled?:boolean; choices?:string[] }
export interface SemanticTree { version:1; nodes:SemanticNode[] }
export type Command = {op:string;[key:string]:unknown};
export interface DisplayList { version:1; commands:Command[] }
export interface Frame { display:DisplayList; semantics:SemanticTree }
export interface Diagnostic { severity:"warning"|"error"; subsystem:string; packageId:string; editorId:string; componentId?:string; code:string; message:string }
export type Diagnostics = (diagnostic:Diagnostic)=>void;
export const CORE_CAPABILITIES = ["webvst-ui-core/1","input.keyboard/1","accessibility/1","graphics.paths/1","graphics.images/1","assets.fonts/1"] as const;
