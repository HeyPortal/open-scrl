import type { ProjectDocumentV2 } from '@/types';
import { createNamedBlobZip, downloadBlob, renderProjectSlides, zipBlobs } from '@/export/ExportController';
import { inspectSlideVideo, renderSlideAsVideoResource } from '@/export/video';

interface ExportOptions { format:'png'|'jpeg';quality:number;pixelRatio:number;signal?:AbortSignal }
export async function renderSlideToBlob(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){return (await renderProjectSlides(doc,[slideIndex],options))[0];}
export async function exportSlide(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){const blob=await renderSlideToBlob(doc,slideIndex,options);if(!blob)return;const ext=(options.format??'png')==='jpeg'?'jpg':'png';const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'slide';downloadBlob(blob,`${safe}_${String(slideIndex+1).padStart(2,'0')}.${ext}`);}
export async function exportAllAsZip(doc:ProjectDocumentV2,options:Partial<ExportOptions>={},onProgress?:(i:number,total:number)=>void){const indexes=doc.slideOrder.map((_,i)=>i);const blobs=await renderProjectSlides(doc,indexes,{...options,onProgress:(p)=>{if(p.phase==='render')onProgress?.(p.current,p.total);}});const ext=(options.format??'png')==='jpeg'?'jpg':'png';const zip=await zipBlobs(blobs,ext);const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';downloadBlob(zip,`${safe}.zip`);}

export async function exportInstagramCarousel(doc:ProjectDocumentV2,onProgress?:(label:string)=>void){
  const plan=await Promise.all(doc.slideOrder.map(async(slideId,index)=>({slideId,index,video:(await inspectSlideVideo(doc,slideId)).animated})));
  const archive=await createNamedBlobZip();
  try{
    for(const item of plan){
      const number=String(item.index+1).padStart(2,'0');
      if(item.video){
        onProgress?.(`Slide ${item.index+1}/${plan.length} · video`);
        const video=await renderSlideAsVideoResource(doc,item.slideId,(frame,total)=>onProgress?.(`Slide ${item.index+1}/${plan.length} · ${Math.round(frame/total*100)}%`));
        try{await archive.add(`${number}.mp4`,video.blob);}finally{await video.release();}
      }else{
        onProgress?.(`Slide ${item.index+1}/${plan.length} · image`);
        const [blob]=await renderProjectSlides(doc,[item.index],{format:'png',pixelRatio:1});
        if(blob)await archive.add(`${number}.png`,blob);
      }
    }
    onProgress?.('Packaging…');
    const zip=await archive.close();
    const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';
    downloadBlob(zip.blob,`${safe}_instagram.zip`,zip.release);
  }catch(error){
    await archive.discard();
    throw error;
  }
}
