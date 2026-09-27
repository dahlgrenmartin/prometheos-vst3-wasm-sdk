import type { ProgramCategory } from "./types.js";
/** Capability granting an editor the host's program (preset) list and selection. */
export const PROGRAMS_CAPABILITY = "host.programs/1";
/** submit() kind carrying a host request from the UI (display list is 1, semantics 2). */
export const HOST_REQUEST_KIND = 3;
export type HostRequest = {type:"program";category:number;program:number};
const index=(v:unknown)=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=0xffff;
/** Structural check only; hosts bound indices against their own program list. */
export function validateHostRequest(value:unknown):HostRequest {
  const r=value as HostRequest;
  if(!r||typeof r!=="object"||r.type!=="program"||!index(r.category)||!index(r.program)||Object.keys(r).length!==3)throw Error("UI_REQUEST_INVALID");
  return {type:"program",category:r.category,program:r.program};
}
/** Bounded copy of a host's program list for the editor (names only, no preset data). */
export function programEvent(categories:readonly ProgramCategory[]) {
  if(categories.length>4096)throw Error("UI_PROGRAMS_BUDGET_EXCEEDED");
  let total=0;
  return {type:"programs",categories:categories.map(c=>{total+=c.programs.length;if(total>65536)throw Error("UI_PROGRAMS_BUDGET_EXCEEDED");return {name:String(c.name).slice(0,256),programs:c.programs.map(p=>String(p).slice(0,256))}})};
}
