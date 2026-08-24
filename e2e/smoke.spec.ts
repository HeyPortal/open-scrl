import { expect,test,type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BlobReader, ZipReader } from '@zip.js/zip.js';

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const tinyGif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
async function archiveEntries(download:Download){const path=await download.path();expect(path).not.toBeNull();const bytes=await readFile(path!);const reader=new ZipReader(new BlobReader(new Blob([new Uint8Array(bytes)])));const entries=await reader.getEntries();await reader.close();return entries.map((entry)=>entry.filename);}
test('creates a large project while keeping viewport canvases bounded',async({page})=>{
  const errors:string[]=[];page.on('pageerror',(error)=>errors.push(error.message));
  await page.goto('/');await expect(page.getByText('Open-SCRL').first()).toBeVisible();await page.getByRole('button',{name:/create|start/i}).first().click();await expect(page.getByTitle('Zoom out')).toBeVisible();
  await page.getByRole('button',{name:'Shapes'}).click();const addSlide=page.getByTitle('Add slide');
  for(let slide=0;slide<20;slide++){for(let layer=0;layer<10;layer++)await page.getByRole('button',{name:'Rectangle'}).first().click();if(slide<19)await addSlide.click();}
  const canvases=page.locator('canvas');await expect(canvases).toHaveCount(3);const viewport=page.viewportSize()!;const sizes=await canvases.evaluateAll((nodes)=>nodes.map((node)=>({width:(node as HTMLCanvasElement).width,height:(node as HTMLCanvasElement).height})));expect(sizes.every((size)=>size.width<=viewport.width&&size.height<=viewport.height)).toBeTruthy();expect(errors).toEqual([]);
  const slideDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Slide PNG'}).click();expect((await slideDownload).suggestedFilename()).toMatch(/_20\.png$/);
  await expect(page.getByRole('button',{name:'Export Carousel'})).toBeVisible();expect(errors).toEqual([]);
});

test('imports, deduplicates, persists, and uses asset metadata',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();
  const largePngBase64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const context=canvas.getContext('2d')!;context.fillStyle='#7c5cff';context.fillRect(0,0,1200,800);return canvas.toDataURL('image/png').split(',')[1];});
  const largePng=Buffer.from(largePngBase64,'base64');const input=page.locator('input[type=file]');await input.setInputFiles({name:'large.png',mimeType:'image/png',buffer:largePng});await expect(page.getByText('Imported 1 media file.')).toBeVisible();const thumbnail=page.getByAltText('large.png');await expect(thumbnail).toBeVisible();expect(await thumbnail.evaluate((image)=>(image as HTMLImageElement).naturalWidth)).toBeLessThanOrEqual(240);
  await input.setInputFiles({name:'large-copy.png',mimeType:'image/png',buffer:largePng});await expect(page.getByText(/already been imported/).first()).toBeVisible();
  await thumbnail.click();await expect(page.getByText('Photo').last()).toBeVisible();const cropZoom=page.getByLabel('Crop zoom');await expect(cropZoom).toBeVisible();await cropZoom.fill('2');await expect(cropZoom).toHaveValue('2');await page.getByLabel('Horizontal crop position').fill('0.25');await expect(page.getByLabel('Horizontal crop position')).toHaveValue('0.25');await page.locator('input.input').first().fill('First project');await page.getByTitle('Projects').click();await expect(page.getByText('Your projects')).toBeVisible();
  await page.getByLabel('Project name').fill('Second project');await page.getByRole('button',{name:/create|start/i}).first().click();await expect(page.getByText('No media yet.')).toBeVisible();await expect(page.getByAltText('large.png')).toHaveCount(0);
  await page.getByTitle('Projects').click();await page.getByRole('button',{name:/First project/}).click();await page.getByRole('button',{name:'Media',exact:true}).click();await expect(page.getByAltText('large.png')).toBeVisible();
});

test('removes a still-photo background on this device',async({page})=>{
  test.setTimeout(180000);
  const pageErrors:string[]=[];
  page.on('pageerror',(error)=>pageErrors.push(error.message));
  page.on('console',(msg)=>{if(msg.type()==='error')pageErrors.push(msg.text());});
  await page.goto('/');
  await page.getByRole('button',{name:'Create & open editor'}).click();
  await expect(page.getByTitle('Zoom out')).toBeVisible();
  const pngBase64=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');
    canvas.width=320;canvas.height=320;
    const context=canvas.getContext('2d')!;
    context.fillStyle='#ffffff';context.fillRect(0,0,320,320);
    context.fillStyle='#7c5cff';context.beginPath();context.arc(160,160,90,0,Math.PI*2);context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({name:'subject.png',mimeType:'image/png',buffer:Buffer.from(pngBase64,'base64')});
  await page.getByAltText('subject.png').click();
  await expect(page.getByRole('button',{name:'Remove background'})).toBeVisible();
  await page.getByRole('button',{name:'Remove background'}).click();
  await expect(page.getByRole('button',{name:'Restore original'})).toBeVisible({timeout:120000});
  expect(pageErrors.filter((message)=>!/Download the React DevTools|React Router/i.test(message))).toEqual([]);
});

test('clicking selected media again duplicates its image layer',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();
  const input=page.locator('input[type=file]');await input.setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:tinyPng});const thumbnail=page.getByAltText('tiny.png');await expect(thumbnail).toBeVisible();
  await thumbnail.click();await expect(page.getByText('1 of 1')).toBeVisible();await thumbnail.click();await expect(page.getByText('2 of 2')).toBeVisible();
});

test('moves selected layers backward and forward in the canvas stack',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();await page.getByRole('button',{name:'Shapes'}).click();await page.getByRole('button',{name:'Rectangle'}).first().click();await page.getByRole('button',{name:'Ellipse'}).first().click();await expect(page.getByText('2 of 2')).toBeVisible();await page.getByRole('button',{name:'Send to back'}).click();await expect(page.getByText('1 of 2')).toBeVisible();await page.getByRole('button',{name:'Bring to front'}).click();await expect(page.getByText('2 of 2')).toBeVisible();
});

test('slide navigation does not rescan the complete media catalog',async({page})=>{
  await page.addInitScript(()=>{
    Object.assign(window,{__metadataGetAllCount:0});const original=IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll=function(query?:IDBValidKey|IDBKeyRange|null,count?:number){if(this.name==='metadata')(window as unknown as{__metadataGetAllCount:number}).__metadataGetAllCount++;return original.call(this,query,count);};
  });
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();const input=page.locator('input[type=file]');await input.setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:tinyPng});
  for(let slide=0;slide<6;slide++){await page.getByAltText('tiny.png').click();if(slide<5)await page.getByTitle('Add slide').click();}
  await page.evaluate(()=>(window as unknown as{__metadataGetAllCount:number}).__metadataGetAllCount=0);
  for(const slide of [1,6,2,5,3,4])await page.getByTitle(`Slide ${slide}`).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as{__metadataGetAllCount:number}).__metadataGetAllCount)).toBe(0);
});

test('exports every static carousel slide as a separate PNG',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();await page.getByTitle('Add slide').click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Carousel'}).click();const value=await download;expect(value.suggestedFilename()).toMatch(/_instagram\.zip$/);expect(await archiveEntries(value)).toEqual(['01.png','02.png']);
});

test('exports animated carousel slides as MP4 without combining slides',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();const button=page.getByRole('button',{name:'Export Carousel'});await expect(button).toBeEnabled();
  const input=page.locator('input[type=file]');await input.setInputFiles({name:'tiny.gif',mimeType:'image/gif',buffer:tinyGif});await page.getByAltText('tiny.gif').click();await page.getByTitle('Add slide').click();
  const download=page.waitForEvent('download',{timeout:30000}).then((value)=>({type:'download' as const,value})).catch(()=>({type:'timeout' as const}));const unsupported=page.getByText(/WebCodecs support|cannot encode an Instagram-compatible/).waitFor({state:'visible',timeout:30000}).then(()=>({type:'unsupported' as const})).catch(()=>({type:'timeout' as const}));await button.click();const outcome=await Promise.race([download,unsupported]);expect(outcome.type).not.toBe('timeout');
  if(outcome.type==='download'){expect(outcome.value.suggestedFilename()).toMatch(/_instagram\.zip$/);expect(await archiveEntries(outcome.value)).toEqual(['01.mp4','02.png']);}
});

test('wheel scrolling moves the rendered carousel with the scroll container',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();
  const scroll=page.getByTestId('canvas-scroll');await page.getByTitle('Add slide').click();await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBeGreaterThan(0);
  const canvasFrame=()=>page.locator('canvas').first().evaluate((canvas)=>{const context=(canvas as HTMLCanvasElement).getContext('2d')!;const {width,height}=canvas as HTMLCanvasElement;const pixels=context.getImageData(0,0,width,height).data;let hash=2166136261;for(let y=0;y<height;y+=17){for(let x=0;x<width;x+=17){const offset=(y*width+x)*4;hash^=pixels[offset];hash=Math.imul(hash,16777619);hash^=pixels[offset+1];hash=Math.imul(hash,16777619);hash^=pixels[offset+2];hash=Math.imul(hash,16777619);}}return(hash>>>0).toString(16);});
  const beforeColor=await canvasFrame();await page.getByRole('button',{name:'BG'}).click();await page.locator('.grid.grid-cols-6 button').nth(6).click();await expect.poll(canvasFrame).not.toBe(beforeColor);const secondSlideFrame=await canvasFrame();
  await page.getByTitle('Slide 1').click();await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBe(0);await expect.poll(canvasFrame).not.toBe(secondSlideFrame);const firstSlideFrame=await canvasFrame();
  const stage=await page.locator('.konvajs-content').boundingBox();expect(stage).not.toBeNull();await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height/2);await page.mouse.wheel(0,700);await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBeGreaterThan(0);await expect.poll(canvasFrame).not.toBe(firstSlideFrame);
  await page.getByTitle('Slide 1').click();await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBe(0);await expect.poll(canvasFrame).toBe(firstSlideFrame);
});
