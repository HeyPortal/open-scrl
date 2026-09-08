import type { ProjectDocumentV2 } from '@/types';
import { id } from '@/lib/nano';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { createTemporaryExportFile } from '@/storage/exportTemp';
import { renderSlides, type ExportProgress, type RenderOptions } from './canvas2d/render';

export interface ExportRequestOptions extends Partial<RenderOptions> { signal?: AbortSignal; onProgress?: (progress: ExportProgress)=>void }
const defaults:RenderOptions={format:'png',quality:.95,pixelRatio:1};

async function workerRender(doc: ProjectDocumentV2, indexes: number[], options: RenderOptions, request: ExportRequestOptions): Promise<Blob[]> {
  if (request.signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return renderSlides(doc, indexes, (assetId) => assetRepository.readOriginal(assetId), (w, h) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas;
    }, options, request.signal, request.onProgress);
  }
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  const requestId = id();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      request.signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    // Each export owns its worker, so cancellation can release decoding and
    // rendering resources immediately, even if the worker is unresponsive.
    const cancel = () => fail(new DOMException('Export cancelled.', 'AbortError'));
    request.signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'Export worker failed.'));
    };
    worker.onmessageerror = () => fail(new Error('Could not read the export worker response.'));
    worker.onmessage = (event: MessageEvent<{ id: string; type: string; blobs?: Blob[]; error?: string; progress?: ExportProgress }>) => {
      if (event.data.id !== requestId) return;
      if (event.data.type === 'progress' && event.data.progress) request.onProgress?.(event.data.progress);
      if (event.data.type === 'complete') { cleanup(); resolve(event.data.blobs ?? []); }
      if (event.data.type === 'error') fail(new Error(event.data.error ?? 'Export failed.'));
    };
    try {
      worker.postMessage({ type: 'start', id: requestId, doc, indexes, options });
    } catch (error) {
      fail(error);
    }
  });
}

export async function renderProjectSlides(doc:ProjectDocumentV2,indexes:number[],request:ExportRequestOptions={}){const {signal,onProgress,...render}=request;void signal;void onProgress;return workerRender(doc,indexes,{...defaults,...render},request);}

export function downloadBlob(blob:Blob,filename:string,onReleased?:()=>void|Promise<void>){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>{URL.revokeObjectURL(url);void onReleased?.();},5000);}

export interface ZipArchiveResource { blob: Blob; release: () => Promise<void> }
export interface NamedBlobZipBuilder {
  add: (name: string, blob: Blob) => Promise<void>;
  close: () => Promise<ZipArchiveResource>;
  discard: () => Promise<void>;
}

export async function createNamedBlobZip(preferTemporary = true): Promise<NamedBlobZipBuilder> {
  const {BlobReader,BlobWriter,ZipWriter}=await import('@zip.js/zip.js');
  const temporary=preferTemporary?await createTemporaryExportFile('zip'):undefined;
  const blobWriter=temporary?undefined:new BlobWriter('application/zip');
  const writer=temporary
    ?new ZipWriter<unknown>(temporary.writable,{preventClose:true})
    :new ZipWriter(blobWriter!);
  let finished=false;

  return {
    add:async(name,blob)=>{if(finished)throw new Error('The ZIP archive is already closed.');await writer.add(name,new BlobReader(blob),{level:0});},
    close:async()=>{
      if(finished)throw new Error('The ZIP archive is already closed.');
      finished=true;
      try{
        const result=await writer.close();
        if(!temporary)return{blob:result as Blob,release:async()=>undefined};
        await temporary.close();
        return{blob:await temporary.getFile(),release:temporary.remove};
      }catch(error){
        await temporary?.abort(error);
        await temporary?.remove();
        throw error;
      }
    },
    discard:async()=>{
      if(finished)return;
      finished=true;
      await temporary?.abort();
      await temporary?.remove();
    },
  };
}

export async function zipNamedBlobs(entries:{name:string;blob:Blob}[],onProgress?:(current:number,total:number)=>void){const builder=await createNamedBlobZip(false);try{for(let i=0;i<entries.length;i++){await builder.add(entries[i].name,entries[i].blob);onProgress?.(i+1,entries.length);}return(await builder.close()).blob;}catch(error){await builder.discard();throw error;}}

export async function zipBlobs(blobs:Blob[],extension:string,onProgress?:(current:number,total:number)=>void){return zipNamedBlobs(blobs.map((blob,index)=>({name:`${String(index+1).padStart(2,'0')}.${extension}`,blob})),onProgress);}
