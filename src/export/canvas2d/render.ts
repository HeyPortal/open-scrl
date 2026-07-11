import type { Background, ImageLayer, Layer, ProjectDocumentV2, ShapeLayer, TextLayer } from '@/types';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import { layoutText } from '@/core/scene/textLayout';

export interface RenderOptions { format: 'png' | 'jpeg'; quality: number; pixelRatio: number }
export interface ExportProgress { phase: 'compile' | 'decode' | 'render' | 'encode'; current: number; total: number }
type Surface = OffscreenCanvas | HTMLCanvasElement;

function context(surface: Surface) {
  const value = surface.getContext('2d');
  if (!value) throw new Error('2D canvas is unavailable.');
  return value as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

function drawBackground(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bg: Background, width: number, height: number) {
  if (bg.kind === 'solid') ctx.fillStyle = bg.color;
  else {
    const angle = bg.angle * Math.PI / 180; const gradient = ctx.createLinearGradient(0,0,width*Math.cos(angle),height*Math.sin(angle));
    gradient.addColorStop(0,bg.from); gradient.addColorStop(1,bg.to); ctx.fillStyle = gradient;
  }
  ctx.fillRect(0,0,width,height);
}

function transform(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: Layer, x: number) {
  ctx.translate(x + layer.width/2, layer.y + layer.height/2); ctx.rotate(layer.rotation*Math.PI/180); ctx.globalAlpha=layer.opacity; ctx.translate(-layer.width/2,-layer.height/2);
}

function roundedRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r=Math.max(0,Math.min(radius,width/2,height/2));ctx.beginPath();ctx.roundRect(0,0,width,height,r);ctx.closePath();
}

function drawImage(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: ImageLayer, image: ImageBitmap, x: number) {
  ctx.save(); transform(ctx,layer,x); roundedRect(ctx,layer.width,layer.height,layer.cornerRadius);ctx.clip();
  const scale=Math.max(1,layer.cropScale??1);const box=layer.width/layer.height;const ratio=image.width/image.height;let sw=image.width,sh=image.height;if(ratio>box)sw=image.height*box;else sh=image.width/box;sw/=scale;sh/=scale;const maxX=Math.max(0,image.width-sw),maxY=Math.max(0,image.height-sh);const sx=maxX/2+layer.cropOffsetX*maxX,sy=maxY/2+layer.cropOffsetY*maxY;
  ctx.drawImage(image,sx,sy,sw,sh,0,0,layer.width,layer.height);ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: ShapeLayer, x: number) {
  ctx.save();transform(ctx,layer,x);ctx.beginPath();if(layer.shape==='ellipse')ctx.ellipse(layer.width/2,layer.height/2,layer.width/2,layer.height/2,0,0,Math.PI*2);else roundedRect(ctx,layer.width,layer.height,layer.cornerRadius);ctx.fillStyle=layer.fill;ctx.fill();if(layer.strokeWidth>0){ctx.strokeStyle=layer.stroke;ctx.lineWidth=layer.strokeWidth;ctx.stroke();}ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: TextLayer, x: number) {
  ctx.save();transform(ctx,layer,x);ctx.fillStyle=layer.fill;ctx.font=`${layer.italic?'italic ':''}${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;ctx.textBaseline='top';
  const lines=layoutText(layer,(text)=>ctx.measureText(text).width);for(const line of lines){const measured=ctx.measureText(line.text).width+Math.max(0,line.text.length-1)*layer.letterSpacing;const dx=layer.align==='center'?(layer.width-measured)/2:layer.align==='right'?layer.width-measured:0;if(layer.letterSpacing===0)ctx.fillText(line.text,dx,line.y);else{let cursor=dx;for(const char of line.text){ctx.fillText(char,cursor,line.y);cursor+=ctx.measureText(char).width+layer.letterSpacing;}}}ctx.restore();
}

async function toBlob(surface: Surface, options: RenderOptions) {
  const mime=options.format==='jpeg'?'image/jpeg':'image/png';
  if (surface instanceof OffscreenCanvas) return surface.convertToBlob({type:mime,quality:options.quality});
  return new Promise<Blob>((resolve,reject)=>surface.toBlob((blob)=>blob?resolve(blob):reject(new Error('Canvas encoding failed.')),mime,options.quality));
}

export async function renderSlides(
  doc: ProjectDocumentV2,
  slideIndexes: number[],
  readAsset: (id: string) => Promise<Blob | undefined>,
  createSurface: (width: number, height: number) => Surface,
  options: RenderOptions,
  signal?: AbortSignal,
  onProgress?: (progress: ExportProgress) => void,
): Promise<Blob[]> {
  const scenes=slideIndexes.map((index)=>{const viewport=getSlideViewport(doc,doc.slideOrder[index]);return viewport?compileScene(doc,viewport):[];});onProgress?.({phase:'compile',current:1,total:1});
  const uses=new Map<string,number>();for(const scene of scenes)for(const item of scene)if(item.layer.kind==='image'&&item.layer.assetId)uses.set(item.layer.assetId,(uses.get(item.layer.assetId)??0)+1);
  const decoded=new Map<string,ImageBitmap>();const output:Blob[]=[];
  try {
    for(let position=0;position<slideIndexes.length;position++){
      if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');const index=slideIndexes[position];const slideId=doc.slideOrder[index];const slide=doc.slides[slideId];const surface=createSurface(doc.format.width*options.pixelRatio,doc.format.height*options.pixelRatio);const ctx=context(surface);ctx.scale(options.pixelRatio,options.pixelRatio);drawBackground(ctx,slide.background,doc.format.width,doc.format.height);
      for(const item of scenes[position]){if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');const x=item.bounds.x-index*doc.format.width;const layer=item.layer;if(layer.kind==='image'&&layer.assetId){let bitmap=decoded.get(layer.assetId);if(!bitmap){const blob=await readAsset(layer.assetId);if(!blob)continue;bitmap=await createImageBitmap(blob);decoded.set(layer.assetId,bitmap);onProgress?.({phase:'decode',current:decoded.size,total:uses.size});}drawImage(ctx,layer,bitmap,x);const remaining=(uses.get(layer.assetId)??1)-1;uses.set(layer.assetId,remaining);if(remaining===0){bitmap.close();decoded.delete(layer.assetId);}}else if(layer.kind==='shape')drawShape(ctx,layer,x);else if(layer.kind==='text')drawText(ctx,layer,x);}
      onProgress?.({phase:'render',current:position+1,total:slideIndexes.length});output.push(await toBlob(surface,options));onProgress?.({phase:'encode',current:position+1,total:slideIndexes.length});await new Promise<void>((resolve)=>setTimeout(resolve,0));
    }
    return output;
  } finally { for(const bitmap of decoded.values())bitmap.close(); }
}
