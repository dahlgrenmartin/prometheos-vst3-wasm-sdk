/** Capability granting an editor a request/reply channel to its own plugin's DSP. */
export const MESSAGES_CAPABILITY = "dsp.messages/1";
/** submit() kind carrying a DSP message from the UI (programs use 3). */
export const DSP_MESSAGE_KIND = 4;
/** Requests from one editor that may await a reply at once; more are refused, not queued. */
export const MAX_MESSAGES_IN_FLIGHT = 8;
export const MAX_MESSAGE_BYTES = 64*1024;
export const MAX_REPLY_BYTES = 1024*1024;
export type DspMessage = {id:number;body:unknown};
/** The host's side: a plugin-agnostic pipe to the DSP instance behind this editor. */
export interface MessageHost { request(body:unknown):Promise<unknown> }
/** Structural check only; the body is opaque to the host and interpreted by the DSP. */
export function validateDspMessage(value:unknown):DspMessage {
  const m=value as DspMessage;
  if(!m||typeof m!=="object"||Array.isArray(m)||!Number.isInteger(m.id)||m.id<0||m.id>0x7fffffff||!("body" in m)||Object.keys(m).length!==2)throw Error("UI_MESSAGE_INVALID");
  if(new TextEncoder().encode(JSON.stringify(m.body)).length>MAX_MESSAGE_BYTES)throw Error("UI_MESSAGE_BUDGET_EXCEEDED");
  return {id:m.id,body:m.body};
}
/** The reply event delivered back into the editor. Oversized replies become errors. */
export function replyEvent(id:number,result:{body?:unknown;error?:string}) {
  if(result.error!==undefined)return {type:"dsp-reply",id,error:String(result.error).slice(0,256)};
  if(new TextEncoder().encode(JSON.stringify(result.body??null)).length>MAX_REPLY_BYTES)return {type:"dsp-reply",id,error:"UI_REPLY_BUDGET_EXCEEDED"};
  return {type:"dsp-reply",id,body:result.body??null};
}
