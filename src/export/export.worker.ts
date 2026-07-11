/// <reference lib="webworker" />
import type { ProjectDocumentV2 } from '@/types';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { renderSlides, type RenderOptions } from './canvas2d/render';

const cancelled=new Set<string>();
self.onmessage=async(event:MessageEvent<{type:'start'|'cancel';id:string;doc?:ProjectDocumentV2;indexes?:number[];options?:RenderOptions}>)=>{
  const request=event.data;if(request.type==='cancel'){cancelled.add(request.id);return;}if(!request.doc||!request.indexes||!request.options)return;
  const signal={get aborted(){return cancelled.has(request.id);}} as AbortSignal;
  try{const blobs=await renderSlides(request.doc,request.indexes,(id)=>assetRepository.readOriginal(id),(w,h)=>new OffscreenCanvas(w,h),request.options,signal,(progress)=>self.postMessage({id:request.id,type:'progress',progress}));self.postMessage({id:request.id,type:'complete',blobs});}
  catch(error){self.postMessage({id:request.id,type:'error',error:error instanceof Error?error.message:String(error)});}finally{cancelled.delete(request.id);}
};
