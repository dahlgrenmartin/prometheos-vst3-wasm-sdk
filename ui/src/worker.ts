import { InlineUi } from "./abi.js";
// The worker is host-owned code. Packages supply only WASM and data.
export function installUiWorker(port:{postMessage:(value:unknown)=>void;onmessage:((e:{data:any})=>void)|null}) {
  let ui:InlineUi|undefined;let starting=false;let dead=false;
  port.onmessage=async ({data:m})=>{
    if(dead)return;
    try {
      if(m.type==="start") {
        if(ui||starting)throw Error("UI_LIFECYCLE_INVALID");starting=true;
        ui=await InlineUi.create(m.wasm,{
          submit:(kind,value)=>port.postMessage({type:"submit",kind,value}),
          request:value=>port.postMessage({type:"host-request",value}),
          parameter:(op,id,value)=>port.postMessage({type:"request",op,id,value}),
          invalidate:()=>port.postMessage({type:"invalidate"}),
          diagnostic:code=>port.postMessage({type:"diagnostic",code}),
        });port.postMessage({type:"ready"});return;
      }
      if(!ui)throw Error("UI_LIFECYCLE_INVALID");
      switch(m.type){case "configure":ui.configure(m.parameters);break;case "event":ui.event(m.event);break;case "parameter":ui.parameter(m.id,m.value);break;case "resize":ui.resize(m.width,m.height,m.scale);break;case "frame":ui.frame(m.time);break;case "destroy":ui.dispose();dead=true;break;default:throw Error("UI_MESSAGE_INVALID")}
      port.postMessage({type:"done",frame:m.type==="frame"});
    }catch(error){dead=true;port.postMessage({type:"error",code:"UI_WORKER_TRAP",message:error instanceof Error?error.message:String(error)})}
  };
}
const scope=globalThis as unknown as {document?:unknown;postMessage?:(value:unknown)=>void;onmessage:((e:{data:any})=>void)|null};
if(typeof scope.postMessage==="function"&&scope.document===undefined)installUiWorker(scope as Parameters<typeof installUiWorker>[0]);
