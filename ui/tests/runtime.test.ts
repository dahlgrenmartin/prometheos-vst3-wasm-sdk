import {it,expect,vi} from "vitest";
import {validateDisplayList,validateSemantics,renderCanvas} from "../src/graphics";
import {AssetCache} from "../src/assets";
import {CustomSession} from "../src/session";

it("rejects whole invalid frames before touching a renderer",()=>{
  const context={save:vi.fn()};
  expect(()=>renderCanvas(context as any,{version:1,commands:[{op:"save"},{op:"rect",x:NaN,y:0,width:5,height:5,color:"red"}]})).toThrow();
  expect(context.save).not.toHaveBeenCalled();
  expect(()=>validateDisplayList({version:1,commands:[{op:"restore"}]})).toThrow();
  expect(()=>validateDisplayList({version:1,commands:[{op:"image",x:0,y:0,width:1,height:1,asset:"https://evil"}]})).toThrow();
  expect(()=>validateSemantics({version:1,nodes:[{id:"x",role:"script",bounds:{x:0,y:0,width:1,height:1},label:""}]})).toThrow();
});
it("shares decoded assets while enforcing logical ids and budgets",async()=>{
  const read=vi.fn(async()=>new Uint8Array([1,2,3]));
  const decode=vi.fn(async()=>({width:10,height:10,close:vi.fn()}));
  const cache=new AssetCache({logo:{path:"assets/logo.png",type:"image"}},read,{maxAssetBytes:10,maxTotalBytes:500,maxImagePixels:200,maxFonts:1},decode);
  const [a,b]=await Promise.all([cache.acquire("logo"),cache.acquire("logo")]);expect(a.value).toBe(b.value);expect(decode).toHaveBeenCalledTimes(1);
  a.release();expect((b.value as any).close).not.toHaveBeenCalled();b.release();expect((b.value as any).close).toHaveBeenCalledTimes(1);
  await expect(cache.acquire("../logo")).rejects.toThrow();
  const small=new AssetCache({logo:{path:"assets/logo.png",type:"image"}},read,{maxAssetBytes:2,maxTotalBytes:5,maxImagePixels:200,maxFonts:1},decode);
  await expect(small.acquire("logo")).rejects.toThrow(/BUDGET/);
});
function worker(){const result={onmessage:null as any,onerror:null as any,postMessage:vi.fn(),terminate:vi.fn()};return result}
it("negotiates before starting custom code",()=>{
  const create=vi.fn(worker),fallback=vi.fn();
  const s=new CustomSession({createWorker:create,requiredCapabilities:["unsupported/1"],capabilities:[],onFallback:fallback,onMessage:()=>{}});
  s.start(new Uint8Array());expect(create).not.toHaveBeenCalled();expect(fallback).toHaveBeenCalledWith("UI_CAPABILITY_MISSING");
});
it("terminates stalled workers once and ignores late messages",()=>{
  vi.useFakeTimers();const w=worker(),fallback=vi.fn(),messages=vi.fn();
  const s=new CustomSession({createWorker:()=>w,requiredCapabilities:[],capabilities:[],timeoutMs:20,onFallback:fallback,onMessage:messages});
  s.start(new Uint8Array());vi.advanceTimersByTime(21);
  expect(w.terminate).toHaveBeenCalledTimes(1);expect(fallback).toHaveBeenCalledWith("UI_WORKER_TIMEOUT");
  w.onmessage?.({data:{type:"ready"}});expect(messages).not.toHaveBeenCalled();s.dispose();vi.useRealTimers();
});
it("preserves ordered reliable messages and bounds in-flight frame requests",()=>{
  const w=worker();const s=new CustomSession({createWorker:()=>w,requiredCapabilities:[],capabilities:[],onFallback:()=>{},onMessage:()=>{}});
  s.start(new Uint8Array());w.onmessage({data:{type:"ready"}});
  s.send({type:"parameter",id:3,value:0.2});s.send({type:"parameter",id:3,value:0.3});
  s.frame(1);s.frame(2);expect(w.postMessage.mock.calls.filter(c=>c[0].type==="frame")).toHaveLength(1);
  w.onmessage({data:{type:"done"}});s.frame(3);expect(w.postMessage.mock.calls.filter(c=>c[0].type==="frame")).toHaveLength(2);s.dispose();
});
import {validateHostRequest,programEvent,HOST_REQUEST_KIND} from "../src/programs";
it("accepts only well-formed program requests and bounds program lists",()=>{
  expect(HOST_REQUEST_KIND).toBe(3);
  expect(validateHostRequest({type:"program",category:2,program:7})).toEqual({type:"program",category:2,program:7});
  for(const bad of [null,{type:"program",category:-1,program:0},{type:"program",category:0,program:1.5},{type:"load",category:0,program:0},{type:"program",category:0,program:0,url:"x"}])
    expect(()=>validateHostRequest(bad)).toThrow(/UI_REQUEST_INVALID/);
  expect(programEvent([{name:"Pads",programs:["Bell Pad"]}])).toEqual({type:"programs",categories:[{name:"Pads",programs:["Bell Pad"]}]});
  expect(()=>programEvent([{name:"x",programs:Array(65537).fill("p")}])).toThrow(/BUDGET/);
});
