import Konva from 'konva';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Asset, Document, Layer, ProjectDocumentV2, Slide } from '@/types';
import { getSlideLayers } from '@/core/document/selectors';
import { getAsset } from '@/lib/assets';
import { createAnimatedGifCanvas, stopAnimatedGifCanvas } from '@/lib/gif';
import { downloadBlob } from './ExportController';

const FPS = 30;
const DEFAULT_SLIDE_DURATION = 3;
const MAX_SLIDE_DURATION = 60;
type Drawable = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function legacyDocument(doc: ProjectDocumentV2): Document {
  return { id: doc.id, name: doc.name, format: doc.format, createdAt: doc.createdAt, updatedAt: doc.updatedAt, slides: doc.slideOrder.map((slideId) => ({ id: slideId, background: doc.slides[slideId].background, layers: getSlideLayers(doc, slideId) })) };
}

function kind(asset: Asset) { return asset.mediaKind ?? (asset.mime.startsWith('video/') ? 'video' : asset.mime === 'image/gif' ? 'gif' : 'image'); }

async function image(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try { return await new Promise<HTMLImageElement>((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = url; }); }
  finally { window.setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

async function video(blob: Blob) {
  const url = URL.createObjectURL(blob); const value = document.createElement('video'); value.muted = true; value.loop = true; value.playsInline = true; value.preload = 'auto'; value.src = url;
  try { await new Promise<void>((resolve, reject) => { value.onloadeddata = () => resolve(); value.onerror = () => reject(new Error('This browser could not decode an imported video.')); }); value.width = value.videoWidth; value.height = value.videoHeight; await value.play().catch(() => undefined); return value; }
  catch (error) { URL.revokeObjectURL(url); throw error; }
}

async function drawable(asset: Asset): Promise<Drawable> {
  if (kind(asset) === 'video') return video(asset.blob);
  if (kind(asset) === 'gif') return createAnimatedGifCanvas(asset.blob, asset.width, asset.height);
  return image(asset.blob);
}

function release(value: Drawable) {
  if (value instanceof HTMLCanvasElement) { stopAnimatedGifCanvas(value); return; }
  if (value instanceof HTMLVideoElement) { value.pause(); URL.revokeObjectURL(value.src); value.removeAttribute('src'); value.load(); }
}

function crop(layer: Extract<Layer, {kind:'image'}>, source: Drawable) {
  const scale=Math.max(1,layer.cropScale??1);const box=layer.width/layer.height;const ratio=source.width/source.height;let width=source.width,height=source.height;if(ratio>box)width=source.height*box;else height=source.width/box;width/=scale;height/=scale;const maxX=Math.max(0,source.width-width),maxY=Math.max(0,source.height-height);return{x:maxX/2+layer.cropOffsetX*maxX,y:maxY/2+layer.cropOffsetY*maxY,width,height};
}

async function addLayer(target: Konva.Layer, item: Layer, offsetX: number, supplied?: Drawable) {
  if (item.kind === 'image') {
    if (!item.assetId) return; const asset = await getAsset(item.assetId); if (!asset) return; const source = supplied ?? await drawable(asset); const area = crop(item, source);
    target.add(new Konva.Image({x:offsetX+item.x+item.width/2,y:item.y+item.height/2,offsetX:item.width/2,offsetY:item.height/2,width:item.width,height:item.height,rotation:item.rotation,opacity:item.opacity,cornerRadius:item.cornerRadius,image:source,crop:area})); return;
  }
  if (item.kind === 'shape') {
    if (item.shape === 'rect') target.add(new Konva.Rect({x:offsetX+item.x+item.width/2,y:item.y+item.height/2,offsetX:item.width/2,offsetY:item.height/2,width:item.width,height:item.height,rotation:item.rotation,opacity:item.opacity,fill:item.fill,stroke:item.strokeWidth>0?item.stroke:undefined,strokeWidth:item.strokeWidth,cornerRadius:item.cornerRadius}));
    else target.add(new Konva.Ellipse({x:offsetX+item.x+item.width/2,y:item.y+item.height/2,radiusX:item.width/2,radiusY:item.height/2,rotation:item.rotation,opacity:item.opacity,fill:item.fill,stroke:item.strokeWidth>0?item.stroke:undefined,strokeWidth:item.strokeWidth}));
    return;
  }
  target.add(new Konva.Text({x:offsetX+item.x+item.width/2,y:item.y+item.height/2,offsetX:item.width/2,offsetY:item.height/2,width:item.width,height:item.height,rotation:item.rotation,opacity:item.opacity,text:item.text,fontFamily:item.fontFamily,fontSize:item.fontSize,fontStyle:`${item.italic?'italic ':''}${item.fontWeight}`,fill:item.fill,align:item.align,lineHeight:item.lineHeight,letterSpacing:item.letterSpacing}));
}

async function prepareStage(doc: Document, slide: Slide) {
  const format=doc.format;const targetIndex=Math.max(0,doc.slides.findIndex((item)=>item.id===slide.id));const container=document.createElement('div');container.style.cssText='position:absolute;left:-99999px;top:-99999px';document.body.appendChild(container);const stage=new Konva.Stage({container,width:format.width,height:format.height});const layer=new Konva.Layer();const media:Drawable[]=[];stage.add(layer);
  if(slide.background.kind==='solid')layer.add(new Konva.Rect({x:0,y:0,width:format.width,height:format.height,fill:slide.background.color}));else layer.add(new Konva.Rect({x:0,y:0,width:format.width,height:format.height,fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:format.width*Math.cos(slide.background.angle*Math.PI/180),y:format.height*Math.sin(slide.background.angle*Math.PI/180)},fillLinearGradientColorStops:[0,slide.background.from,1,slide.background.to]}));
  for(let index=0;index<doc.slides.length;index++){const sourceSlide=doc.slides[index];const offset=(index-targetIndex)*format.width;for(const item of sourceSlide.layers){if(!item.visible)continue;let source:Drawable|undefined;if(item.kind==='image'&&item.assetId){const asset=await getAsset(item.assetId);if(asset){source=await drawable(asset);media.push(source);}}await addLayer(layer,item,offset,source);}}
  layer.draw();return{stage,layer,destroy:()=>{media.forEach(release);stage.destroy();container.remove();}};
}

async function slideDuration(slide: Slide) { let duration=DEFAULT_SLIDE_DURATION;for(const layer of slide.layers){if(layer.kind!=='image'||!layer.visible||!layer.assetId)continue;const asset=await getAsset(layer.assetId);if(asset&&kind(asset)!=='image')duration=Math.max(duration,asset.duration||0);}return Math.min(MAX_SLIDE_DURATION,duration); }
function waitUntil(deadline:number){const remaining=deadline-performance.now();return remaining>1?new Promise<void>((resolve)=>window.setTimeout(resolve,remaining)):Promise.resolve();}

export async function exportProjectAsVideo(project: ProjectDocumentV2, onProgress?: (frame:number,total:number)=>void) {
  if(!('VideoEncoder'in window)||!('VideoFrame'in window))throw new Error('MP4 export needs a browser with WebCodecs support. Try the latest Chrome or Edge.');
  const doc=legacyDocument(project);const durations=await Promise.all(doc.slides.map(slideDuration));const counts=durations.map((duration)=>Math.max(1,Math.round(duration*FPS)));const total=counts.reduce((sum,count)=>sum+count,0);
  const config:VideoEncoderConfig={codec:'avc1.420033',width:doc.format.width,height:doc.format.height,bitrate:Math.max(6_000_000,Math.round(doc.format.width*doc.format.height*FPS*.18)),framerate:FPS,hardwareAcceleration:'prefer-hardware',latencyMode:'quality',avc:{format:'avc'}};const support=await VideoEncoder.isConfigSupported(config);if(!support.supported)throw new Error('This device cannot encode an Instagram-compatible H.264 MP4.');
  const target=new ArrayBufferTarget();const muxer=new Muxer({target,video:{codec:'avc',width:doc.format.width,height:doc.format.height,frameRate:FPS},fastStart:'in-memory'});let encoderError:DOMException|null=null;const encoder=new VideoEncoder({output:(chunk,metadata)=>muxer.addVideoChunk(chunk,metadata),error:(error)=>{encoderError=error;}});encoder.configure(support.config??config);let global=0;
  try{for(let index=0;index<doc.slides.length;index++){const prepared=await prepareStage(doc,doc.slides[index]);const started=performance.now();try{for(let local=0;local<counts[index];local++){await waitUntil(started+local*1000/FPS);prepared.layer.draw();const canvas=prepared.stage.toCanvas({pixelRatio:1});const frame=new VideoFrame(canvas,{timestamp:Math.round(global*1_000_000/FPS),duration:Math.round(1_000_000/FPS)});encoder.encode(frame,{keyFrame:global%(FPS*2)===0});frame.close();global++;onProgress?.(global,total);if(encoder.encodeQueueSize>8)await encoder.flush();if(encoderError)throw encoderError;}}finally{prepared.destroy();}}await encoder.flush();if(encoderError)throw encoderError;muxer.finalize();const safe=doc.name.replace(/[^a-z0-9-_]+/gi,'_')||'project';downloadBlob(new Blob([target.buffer],{type:'video/mp4'}),`${safe}.mp4`);}finally{encoder.close();}
}
