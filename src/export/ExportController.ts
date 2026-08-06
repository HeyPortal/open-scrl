import type { ProjectDocumentV2 } from '@/types';
import { id } from '@/lib/nano';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { renderSlides, type ExportProgress, type RenderOptions } from './canvas2d/render';

export interface ExportRequestOptions extends Partial<RenderOptions> { signal?: AbortSignal; onProgress?: (progress: ExportProgress)=>void }
const defaults:RenderOptions={format:'png',quality:.95,pixelRatio:1};

async function workerRender(doc:ProjectDocumentV2,indexes:number[],options:RenderOptions,request:ExportRequestOptions):Promise<Blob[]>{
  if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined')return renderSlides(doc,indexes,(assetId)=>assetRepository.readOriginal(assetId),(w,h)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;return canvas;},options,request.signal,request.onProgress);
  const worker=new Worker(new URL('./export.worker.ts',import.meta.url),{type:'module'});const requestId=id();
  return new Promise((resolve,reject)=>{const cancel=()=>worker.postMessage({type:'cancel',id:requestId});request.signal?.addEventListener('abort',cancel,{once:true});worker.onmessage=(event:MessageEvent<{id:string;type:string;blobs?:Blob[];error?:string;progress?:ExportProgress}>)=>{if(event.data.id!==requestId)return;if(event.data.type==='progress'&&event.data.progress)request.onProgress?.(event.data.progress);if(event.data.type==='complete'){worker.terminate();resolve(event.data.blobs??[]);}if(event.data.type==='error'){worker.terminate();reject(new Error(event.data.error));}};worker.postMessage({type:'start',id:requestId,doc,indexes,options});});
}

export async function renderProjectSlides(doc:ProjectDocumentV2,indexes:number[],request:ExportRequestOptions={}){const {signal,onProgress,...render}=request;void signal;void onProgress;return workerRender(doc,indexes,{...defaults,...render},request);}

export function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}

export async function zipNamedBlobs(entries:{name:string;blob:Blob}[],onProgress?:(current:number,total:number)=>void){const {BlobReader,BlobWriter,ZipWriter}=await import('@zip.js/zip.js');const writer=new ZipWriter(new BlobWriter('application/zip'));for(let i=0;i<entries.length;i++){await writer.add(entries[i].name,new BlobReader(entries[i].blob));onProgress?.(i+1,entries.length);}return writer.close();}

export async function zipBlobs(blobs:Blob[],extension:string,onProgress?:(current:number,total:number)=>void){return zipNamedBlobs(blobs.map((blob,index)=>({name:`${String(index+1).padStart(2,'0')}.${extension}`,blob})),onProgress);}
