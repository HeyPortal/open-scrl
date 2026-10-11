import type { ProjectDocumentV2 } from '@/types';
import { createNamedBlobZip, downloadBlob, renderProjectSlides, zipBlobs } from '@/export/ExportController';
import { inspectSlideVideo, renderSlideAsVideoResource } from '@/export/video';

export interface ExportOptions { format:'png'|'jpeg';quality:number;pixelRatio:number;signal?:AbortSignal;animation?:'auto'|'still';fileName?:string;slideIndexes?:number[] }
export type ExportReporter = (label:string,fraction?:number)=>void;
const assertActive=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');};
const safeName=(doc:ProjectDocumentV2,options:Partial<ExportOptions>)=>(options.fileName??doc.name).trim().replace(/[^a-z0-9-_]+/gi,'_')||'project';
const stillOptions=(options:Partial<ExportOptions>)=>({format:options.format??'png',quality:options.quality??.95,pixelRatio:options.pixelRatio??1,signal:options.signal});
export async function renderSlideToBlob(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){return (await renderProjectSlides(doc,[slideIndex],stillOptions(options)))[0];}
export async function exportSlide(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={},onProgress?:ExportReporter){
  assertActive(options.signal);
  const slideId=doc.slideOrder[slideIndex];if(!slideId)throw new Error('The selected slide no longer exists.');
  const number=String(slideIndex+1).padStart(2,'0');
  if(options.animation==='auto'&&(await inspectSlideVideo(doc,slideId)).animated){
    const video=await renderSlideAsVideoResource(doc,slideId,(frame,total)=>onProgress?.(`Rendering video · ${Math.round(frame/total*100)}%`,frame/total),{signal:options.signal});
    try{assertActive(options.signal);downloadBlob(video.blob,`${safeName(doc,options)}_${number}.mp4`,video.release);}catch(error){await video.release();throw error;}
  }else{
    onProgress?.(`Rendering slide ${slideIndex+1}…`,0);
    const blob=await renderSlideToBlob(doc,slideIndex,options);assertActive(options.signal);if(!blob)throw new Error('The slide could not be rendered.');
    downloadBlob(blob,`${safeName(doc,options)}_${number}.${options.format==='jpeg'?'jpg':'png'}`);
  }
}
export async function exportAllAsZip(doc:ProjectDocumentV2,options:Partial<ExportOptions>={},onProgress?:(i:number,total:number)=>void){const indexes=doc.slideOrder.map((_,i)=>i);const blobs=await renderProjectSlides(doc,indexes,{...options,onProgress:(p)=>{if(p.phase==='render')onProgress?.(p.current,p.total);}});const ext=(options.format??'png')==='jpeg'?'jpg':'png';const zip=await zipBlobs(blobs,ext);const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';downloadBlob(zip,`${safe}.zip`);}

export async function exportInstagramCarousel(doc:ProjectDocumentV2,onProgress?:ExportReporter,options:Partial<ExportOptions>={}){
  assertActive(options.signal);
  const indexes=options.slideIndexes??doc.slideOrder.map((_,index)=>index);
  if(indexes.length===0||indexes.some(index=>!Number.isInteger(index)||!doc.slideOrder[index]))throw new Error('Choose at least one valid slide to export.');
  const ordered=[...new Set(indexes)].sort((a,b)=>a-b);
  const plan=await Promise.all(ordered.map(async(index)=>({slideId:doc.slideOrder[index],index,video:options.animation!=='still'&&(await inspectSlideVideo(doc,doc.slideOrder[index])).animated})));
  assertActive(options.signal);
  const archive=await createNamedBlobZip();
  try{
    for(const [position,item] of plan.entries()){
      assertActive(options.signal);
      const number=String(item.index+1).padStart(2,'0');
      if(item.video){
        onProgress?.(`Slide ${position+1}/${plan.length} · video`,position/plan.length);
        const video=await renderSlideAsVideoResource(doc,item.slideId,(frame,total)=>onProgress?.(`Slide ${position+1}/${plan.length} · ${Math.round(frame/total*100)}%`,(position+frame/total)/plan.length),{signal:options.signal});
        try{await archive.add(`${number}.mp4`,video.blob);}finally{await video.release();}
      }else{
        onProgress?.(`Slide ${position+1}/${plan.length} · image`,position/plan.length);
        const [blob]=await renderProjectSlides(doc,[item.index],stillOptions(options));
        assertActive(options.signal);if(!blob)throw new Error(`Slide ${item.index+1} could not be rendered.`);
        await archive.add(`${number}.${options.format==='jpeg'?'jpg':'png'}`,blob);
      }
    }
    assertActive(options.signal);onProgress?.('Packaging…',1);
    const zip=await archive.close();
    try{assertActive(options.signal);downloadBlob(zip.blob,`${safeName(doc,options)}_instagram.zip`,zip.release);}catch(error){await zip.release();throw error;}
  }catch(error){
    await archive.discard();
    throw error;
  }
}
