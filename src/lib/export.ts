import type { ProjectDocumentV2 } from '@/types';
import { downloadBlob, renderProjectSlides, zipBlobs, zipNamedBlobs } from '@/export/ExportController';
import { inspectSlideVideo, renderSlideAsVideo } from '@/export/video';

interface ExportOptions { format:'png'|'jpeg';quality:number;pixelRatio:number;signal?:AbortSignal }
export async function renderSlideToBlob(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){return (await renderProjectSlides(doc,[slideIndex],options))[0];}
export async function exportSlide(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){const blob=await renderSlideToBlob(doc,slideIndex,options);if(!blob)return;const ext=(options.format??'png')==='jpeg'?'jpg':'png';const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'slide';downloadBlob(blob,`${safe}_${String(slideIndex+1).padStart(2,'0')}.${ext}`);}
export async function exportAllAsZip(doc:ProjectDocumentV2,options:Partial<ExportOptions>={},onProgress?:(i:number,total:number)=>void){const indexes=doc.slideOrder.map((_,i)=>i);const blobs=await renderProjectSlides(doc,indexes,{...options,onProgress:(p)=>{if(p.phase==='render')onProgress?.(p.current,p.total);}});const ext=(options.format??'png')==='jpeg'?'jpg':'png';const zip=await zipBlobs(blobs,ext);const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';downloadBlob(zip,`${safe}.zip`);}

export async function exportInstagramCarousel(doc:ProjectDocumentV2,onProgress?:(label:string)=>void){
  const plan=await Promise.all(doc.slideOrder.map(async(slideId,index)=>({slideId,index,video:(await inspectSlideVideo(doc,slideId)).animated})));
  const entries:{name:string;blob:Blob}[]=[];
  for(const item of plan){
    const number=String(item.index+1).padStart(2,'0');
    if(item.video){
      onProgress?.(`Slide ${item.index+1}/${plan.length} · video`);
      const blob=await renderSlideAsVideo(doc,item.slideId,(frame,total)=>onProgress?.(`Slide ${item.index+1}/${plan.length} · ${Math.round(frame/total*100)}%`));
      entries.push({name:`${number}.mp4`,blob});
    }else{
      onProgress?.(`Slide ${item.index+1}/${plan.length} · image`);
      const [blob]=await renderProjectSlides(doc,[item.index],{format:'png',pixelRatio:1});
      if(blob)entries.push({name:`${number}.png`,blob});
    }
  }
  onProgress?.('Packaging…');
  const zip=await zipNamedBlobs(entries);
  const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';
  downloadBlob(zip,`${safe}_instagram.zip`);
}
