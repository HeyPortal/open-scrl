import { expect,test } from '@playwright/test';

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('creates a large project while keeping viewport canvases bounded',async({page})=>{
  const errors:string[]=[];page.on('pageerror',(error)=>errors.push(error.message));
  await page.goto('/');await expect(page.getByText('Open-SCRL').first()).toBeVisible();await page.getByRole('button',{name:/create|start/i}).first().click();await expect(page.getByTitle('Zoom out')).toBeVisible();
  await page.getByRole('button',{name:'Shapes'}).click();const addSlide=page.getByTitle('Add slide');
  for(let slide=0;slide<20;slide++){for(let layer=0;layer<10;layer++)await page.getByRole('button',{name:'Rectangle'}).first().click();if(slide<19)await addSlide.click();}
  const canvases=page.locator('canvas');await expect(canvases).toHaveCount(3);const viewport=page.viewportSize()!;const sizes=await canvases.evaluateAll((nodes)=>nodes.map((node)=>({width:(node as HTMLCanvasElement).width,height:(node as HTMLCanvasElement).height})));expect(sizes.every((size)=>size.width<=viewport.width&&size.height<=viewport.height)).toBeTruthy();expect(errors).toEqual([]);
  const slideDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Slide PNG'}).click();expect((await slideDownload).suggestedFilename()).toMatch(/_20\.png$/);
  await expect(page.getByRole('button',{name:'Export MP4'})).toBeVisible();expect(errors).toEqual([]);
});

test('imports, deduplicates, persists, and uses asset metadata',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();
  const input=page.locator('input[type=file]');await input.setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:tinyPng});await expect(page.getByText('Imported 1 media file.')).toBeVisible();await expect(page.getByAltText('tiny.png')).toBeVisible();
  await input.setInputFiles({name:'tiny-copy.png',mimeType:'image/png',buffer:tinyPng});await expect(page.getByText(/already been imported/).first()).toBeVisible();
  await page.getByAltText('tiny.png').click();await expect(page.getByText('Photo').last()).toBeVisible();await page.waitForTimeout(900);await page.reload();await page.getByText('Untitled',{exact:true}).click();await page.getByRole('button',{name:'Media',exact:true}).click();await expect(page.getByAltText('tiny.png')).toBeVisible();
});

test('exports a single-slide Instagram MP4 or explains missing browser support',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();const button=page.getByRole('button',{name:'Export MP4'});await expect(button).toBeVisible();
  const download=page.waitForEvent('download',{timeout:20000}).then((value)=>{expect(value.suggestedFilename()).toMatch(/\.mp4$/);return'download';}).catch(()=>'timeout');const unsupported=page.getByText(/WebCodecs support|cannot encode an Instagram-compatible/).waitFor({state:'visible',timeout:20000}).then(()=>'unsupported').catch(()=>'timeout');await button.click();expect(await Promise.race([download,unsupported])).not.toBe('timeout');
});

test('wheel scrolling moves the rendered carousel with the scroll container',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/create|start/i}).first().click();const scroll=page.getByTestId('canvas-scroll');await page.getByTitle('Add slide').click();await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBeGreaterThan(0);
  const canvasFrame=()=>page.locator('canvas').first().evaluate((canvas)=>(canvas as HTMLCanvasElement).toDataURL());const beforeColor=await canvasFrame();
  await page.getByRole('button',{name:'BG'}).click();await page.locator('.grid.grid-cols-6 button').nth(6).click();await expect.poll(canvasFrame).not.toBe(beforeColor);
  await page.getByTitle('Slide 1').click();await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBe(0);const firstSlideFrame=await canvasFrame();const stage=await page.locator('.konvajs-content').boundingBox();expect(stage).not.toBeNull();await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height/2);await page.mouse.wheel(0,700);await expect.poll(()=>scroll.evaluate((element)=>element.scrollLeft)).toBeGreaterThan(0);await expect.poll(canvasFrame).not.toBe(firstSlideFrame);
});
