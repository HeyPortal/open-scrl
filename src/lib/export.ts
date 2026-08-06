import type { ProjectDocumentV2 } from '@/types';
import { downloadBlob, renderProjectSlides, zipBlobs } from '@/export/ExportController';
export { exportProjectAsVideo } from '@/export/video';

interface ExportOptions { format:'png'|'jpeg';quality:number;pixelRatio:number;signal?:AbortSignal }
export async function renderSlideToBlob(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){return (await renderProjectSlides(doc,[slideIndex],options))[0];}
export async function exportSlide(doc:ProjectDocumentV2,slideIndex:number,options:Partial<ExportOptions>={}){const blob=await renderSlideToBlob(doc,slideIndex,options);if(!blob)return;const ext=(options.format??'png')==='jpeg'?'jpg':'png';const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'slide';downloadBlob(blob,`${safe}_${String(slideIndex+1).padStart(2,'0')}.${ext}`);}
export async function exportAllAsZip(doc:ProjectDocumentV2,options:Partial<ExportOptions>={},onProgress?:(i:number,total:number)=>void){const indexes=doc.slideOrder.map((_,i)=>i);const blobs=await renderProjectSlides(doc,indexes,{...options,onProgress:(p)=>{if(p.phase==='render')onProgress?.(p.current,p.total);}});const ext=(options.format??'png')==='jpeg'?'jpg':'png';const zip=await zipBlobs(blobs,ext);const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';downloadBlob(zip,`${safe}.zip`);}
