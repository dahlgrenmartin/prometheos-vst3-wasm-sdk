export interface AssetDeclaration {path:string;type:"image"|"font"|"binary";sha256?:string}
export interface AssetBudgets {maxAssetBytes:number;maxTotalBytes:number;maxImagePixels:number;maxFonts:number}
export const defaultAssetBudgets:AssetBudgets={maxAssetBytes:16*1024*1024,maxTotalBytes:64*1024*1024,maxImagePixels:16*1024*1024,maxFonts:8};
export function safePackagePath(path:string){return !!path&&!/[\\:\x00-\x1f]/.test(path)&&!path.startsWith("/")&&!path.split("/").some(p=>!p||p==="."||p==="..")}
function isSvg(bytes:Uint8Array){const head=new TextDecoder().decode(bytes.subarray(0,1024)).replace(/^﻿/,"").trimStart();return head.startsWith("<svg")||(head.startsWith("<?xml")&&head.includes("<svg"))}
/** Raster images decode directly. SVG decodes through an <img> (no script, no network) and rasterizes above intrinsic size so zoomed editors stay sharp. */
export async function decodeImageBytes(bytes:Uint8Array,rasterScale=3,maxPixels=defaultAssetBudgets.maxImagePixels):Promise<ImageBitmap> {
  if(!isSvg(bytes))return createImageBitmap(new Blob([new Uint8Array(bytes)]));
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"image/svg+xml"}));
  try {
    const image=new Image();image.src=url;await image.decode();
    const w=image.naturalWidth,h=image.naturalHeight;if(!w||!h||w*h>maxPixels)throw Error("UI_ASSET_BUDGET_EXCEEDED");
    const scale=Math.max(1,Math.min(rasterScale,Math.sqrt(maxPixels/(w*h))));
    const width=Math.floor(w*scale),height=Math.floor(h*scale);
    const canvas=typeof OffscreenCanvas!=="undefined"?new OffscreenCanvas(width,height):Object.assign(document.createElement("canvas"),{width,height});
    const ctx=canvas.getContext("2d") as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;if(!ctx)throw Error("UI_ASSET_INVALID");
    ctx.drawImage(image,0,0,width,height);return await createImageBitmap(canvas);
  } finally {URL.revokeObjectURL(url)}
}
interface Cached {value:unknown;bytes:number;refs:number;cleanup:()=>void}
export class AssetCache {
  private entries=new Map<string,Promise<Cached>>();private total=0;private fonts=0;
  constructor(private declarations:Record<string,AssetDeclaration>,private read:(path:string)=>Promise<Uint8Array>,private budgets:AssetBudgets=defaultAssetBudgets,private decodeImage:(bytes:Uint8Array)=>Promise<{width:number;height:number;close():void}>=bytes=>decodeImageBytes(bytes,3,budgets.maxImagePixels)) {}
  async acquire(id:string):Promise<{value:unknown;release:()=>void}> {
    const declaration=Object.hasOwn(this.declarations,id)?this.declarations[id]:undefined;
    if(!/^[\w.-]{1,256}$/.test(id)||id===".."||!declaration||!safePackagePath(declaration.path))throw Error("UI_ASSET_MISSING");
    let pending=this.entries.get(id);
    if(!pending){pending=this.load(id,declaration);this.entries.set(id,pending);pending.catch(()=>{if(this.entries.get(id)===pending)this.entries.delete(id)})}
    const cached=await pending;cached.refs++;let released=false;
    return {value:cached.value,release:()=>{if(released)return;released=true;if(--cached.refs===0){this.entries.delete(id);this.total-=cached.bytes;cached.cleanup()}}};
  }
  private async load(id:string,d:AssetDeclaration):Promise<Cached> {
    const bytes=await this.read(d.path);if(bytes.byteLength>this.budgets.maxAssetBytes)throw Error("UI_ASSET_BUDGET_EXCEEDED");
    if(d.sha256){const digest=await crypto.subtle.digest("SHA-256",new Uint8Array(bytes));const hex=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");if(hex!==d.sha256)throw Error("UI_ASSET_HASH_INVALID")}
    let size=bytes.byteLength,value:unknown=bytes,cleanup=()=>{};
    if(d.type==="image") {const bitmap=await this.decodeImage(bytes);size+=bitmap.width*bitmap.height*4;if(bitmap.width*bitmap.height>this.budgets.maxImagePixels){bitmap.close();throw Error("UI_ASSET_BUDGET_EXCEEDED")}value=bitmap;cleanup=()=>bitmap.close()}
    if(d.type==="font") {
      if(this.fonts>=this.budgets.maxFonts)throw Error("UI_ASSET_BUDGET_EXCEEDED");this.fonts++;
      try{const family=`webvst-${id}-${AssetCache.fontSerial++}`;const face=new FontFace(family,new Uint8Array(bytes));await face.load();document.fonts.add(face);value=family;cleanup=()=>{document.fonts.delete(face);this.fonts--}}catch(e){this.fonts--;throw e}
    }
    if(this.total+size>this.budgets.maxTotalBytes){cleanup();throw Error("UI_ASSET_BUDGET_EXCEEDED")}
    this.total+=size;return {value,bytes:size,cleanup,refs:0};
  }
  private static fontSerial=0;
}
