import { expect, test } from './fixtures/test';

test('MP4 export shares repeated video sources and preserves every frame at fixed timestamps', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/e2e/fixtures/videoCounter.ts';
    const { exportVideoCounter } = await import(path) as typeof import('./fixtures/videoCounter');
    return exportVideoCounter();
  });
  test.skip(result === null, 'This Chromium build has no H.264 encoder');
  expect(result!.decoded).toBe(90);
  expect(result!.videoElements).toBe(0);
  expect(result!.frames).toBe(Math.round(result!.fps * 3));
  expect(result!.mismatches).toEqual([]);
  expect(result!.progress[0]).toEqual({ frame: 1, total: result!.frames });
  expect(result!.progress.at(-1)).toEqual({ frame: result!.frames, total: result!.frames });
  result!.timestamps.forEach((timestamp, index) => expect(timestamp).toBeCloseTo(index / result!.fps, 5));
});

test('transparent WebM video preserves the slide background in MP4', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/e2e/fixtures/videoCounter.ts';
    return (await import(path) as typeof import('./fixtures/videoCounter')).exportTransparentVideo();
  });
  test.skip(result === null, 'This Chromium build needs H.264 and VP9 encoders');
  expect(result!.editor[0]).toEqual([0, 255, 0, 255]);
  [255, 0, 0, 255].forEach((channel, index) => expect(Math.abs(result!.editor[1][index] - channel)).toBeLessThanOrEqual(10));
  // H.264 is lossy; check the transparent half against the editor's background
  // and ensure the opaque half still contains the red video.
  result!.exported[0].forEach((channel, component) => expect(Math.abs(channel - result!.editor[0][component])).toBeLessThanOrEqual(10));
  expect(result!.exported[1][0]).toBeGreaterThan(200);
  expect(result!.exported[1][1]).toBeLessThan(50);
  expect(result!.exported[1][2]).toBeLessThan(10);
});

test('selected video previews pause during export and resume afterward without changing the document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  const original = await page.evaluate(async () => {
    const fixturePath = '/e2e/fixtures/videoCounter.ts';
    const result = await (await import(fixturePath) as typeof import('./fixtures/videoCounter')).exportVideoCounter();
    if (!result) return null;
    result.doc.slides.slide.layerOrder = ['video']; delete result.doc.layers.duplicate;
    const videos: HTMLMediaElement[] = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!videos.includes(this)) videos.push(this); return play.call(this); };
    Object.assign(window, { playbackVideos: videos });
    const storePath = '/src/editor/documentStore.ts', sessionPath = '/src/editor/sessionStore.ts';
    const { useDocumentStore } = await import(storePath) as typeof import('../src/editor/documentStore');
    const { useEditorSession } = await import(sessionPath) as typeof import('../src/editor/sessionStore');
    useDocumentStore.setState({ doc: result.doc });
    useEditorSession.getState().selectSlide('slide'); useEditorSession.getState().selectLayer('video');
    return JSON.stringify(result.doc);
  });
  test.skip(original === null, 'This Chromium build has no H.264 encoder');
  const paused = () => page.evaluate(() => (window as unknown as { playbackVideos: HTMLMediaElement[] }).playbackVideos.map(video => video.paused));
  await expect.poll(paused).toEqual([false]);
  await page.evaluate(async () => {
    const path = '/src/editor/exportStore.ts';
    (await import(path) as typeof import('../src/editor/exportStore')).useExport.setState({ exporting: true });
  });
  await expect.poll(paused).toEqual([true]);
  await expect.poll(() => page.evaluate(() => {
    const konva = (window as unknown as { Konva: { Animation: { animations: Set<unknown> } } }).Konva;
    return konva.Animation.animations.size;
  })).toBe(0);
  // Completion, cancellation and failure all clear the same export state.
  await page.evaluate(async () => {
    const path = '/src/editor/exportStore.ts';
    (await import(path) as typeof import('../src/editor/exportStore')).useExport.setState({ exporting: false });
  });
  await expect.poll(paused).toEqual([false]);
  expect(await page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    return JSON.stringify((await import(path) as typeof import('../src/editor/documentStore')).useDocumentStore.getState().doc);
  })).toBe(original);
});
