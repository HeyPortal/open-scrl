import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Check, Download, Loader2, Package, Smartphone } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { useExport } from '@/editor/exportStore';
import { inspectSlideVideo } from '@/export/video';
import { ExportSlidePreview } from './ExportSlidePreview';
import './export.css';

type Scope = 'all' | 'current' | 'chosen';

/** The same export controls in the desktop dialog and phone sheet. */
export function ExportPanel({ onDone }: { onDone: () => void }) {
  const doc = useEditor((s) => s.doc);
  const current = useEditorSession((s) => s.selectedSlideId);
  const state = useExport();
  const [scope, setScope] = useState<Scope>('all');
  const [chosen, setChosen] = useState(() => new Set(doc.slideOrder));
  const [fileName, setFileName] = useState(doc.name);
  const [animatedCount, setAnimatedCount] = useState(0);
  const [checking, setChecking] = useState(true);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const id = useId();
  const indexes = useMemo(() => doc.slideOrder.flatMap((slideId, index) => (
    scope === 'all' || (scope === 'current' ? slideId === current : chosen.has(slideId)) ? [index] : []
  )), [doc.slideOrder, scope, current, chosen]);

  useEffect(() => {
    if (!useExport.getState().exporting) useExport.setState({ error: null, outcome: 'idle' });
  }, [doc.id]);
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setInspectionError(null);
    void Promise.all(indexes.map((index) => inspectSlideVideo(doc, doc.slideOrder[index]))).then((slides) => {
      if (!cancelled) { setAnimatedCount(slides.filter((slide) => slide.animated).length); setChecking(false); }
    }, () => {
      if (!cancelled) { setInspectionError('Could not check the selected slides. Try again.'); setChecking(false); }
    });
    return () => { cancelled = true; };
  }, [doc, indexes, attempt]);

  const settings = state.settings;
  const stillCount = settings.animation === 'still' ? indexes.length : indexes.length - animatedCount;
  const videoCount = settings.animation === 'still' ? 0 : animatedCount;
  const width = doc.format.width * settings.pixelRatio;
  const height = doc.format.height * settings.pixelRatio;
  const safe = fileName.trim().replace(/[^a-z0-9-_]+/gi, '_') || 'project';
  const single = scope === 'current';
  const extension = videoCount ? 'mp4' : settings.format === 'jpeg' ? 'jpg' : 'png';
  const downloadName = single ? `${safe}_${String((indexes[0] ?? 0) + 1).padStart(2, '0')}.${extension}` : `${safe}_instagram.zip`;
  const error = localError ?? state.error ?? inspectionError;
  const action = single ? 'Save this slide' : scope === 'chosen' ? 'Export selected slides' : 'Export carousel';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.exporting || checking || indexes.length === 0 || inspectionError) return;
    setLocalError(null);
    const options = { ...settings, fileName, slideIndexes: indexes };
    try {
      if (single) await state.exportCurrentSlide(options);
      else await state.exportCarousel(options);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Export failed. Please try again.');
    }
  };

  return <form className="export-panel" onSubmit={(event) => void submit(event)}>
    <div className="export-fields scrollbar-thin">
      <ExportSlidePreview doc={doc} indexes={indexes} current={current} format={settings.format} />
      <fieldset disabled={state.exporting} className="export-scope">
        <legend>Slides</legend>
        <div className="export-segments">
          {([['all', 'All slides'], ['current', 'This slide'], ['chosen', 'Choose slides']] as const).map(([value, label]) => <label key={value}>
            <input type="radio" name={`${id}-scope`} value={value} checked={scope === value} onChange={() => setScope(value)} />
            <span>{label}</span>
          </label>)}
        </div>
        {scope === 'chosen' && <div className="export-slide-picker">
          <div className="export-pick-actions"><span>{indexes.length} selected</span><button type="button" onClick={() => setChosen(new Set(doc.slideOrder))}>Select all</button><button type="button" onClick={() => setChosen(new Set())}>Clear</button></div>
          <div className="export-slide-choices">
            {doc.slideOrder.map((slideId, index) => <label key={slideId}><input type="checkbox" checked={chosen.has(slideId)} onChange={(event) => setChosen((previous) => { const next = new Set(previous); if (event.target.checked) next.add(slideId); else next.delete(slideId); return next; })} /><span>Slide {index + 1}</span></label>)}
          </div>
        </div>}
      </fieldset>
      <fieldset disabled={state.exporting} className="export-options">
        <div className="export-option-row">
          <label>Image format<select disabled={!checking && stillCount === 0} value={settings.format} onChange={(event) => state.setSettings({ format: event.target.value as 'png' | 'jpeg' })}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
          <label>Image resolution<select disabled={!checking && stillCount === 0} value={settings.pixelRatio} onChange={(event) => state.setSettings({ pixelRatio: Number(event.target.value) })}><option value="1">1× · Original</option><option value="2">2× · High detail</option></select></label>
        </div>
        {settings.format === 'jpeg' && stillCount > 0 && <label className="export-quality" htmlFor={`${id}-quality`}>JPEG quality <output>{Math.round(settings.quality * 100)}%</output><input id={`${id}-quality`} type="range" min="50" max="100" step="1" value={Math.round(settings.quality * 100)} onChange={(event) => state.setSettings({ quality: Number(event.target.value) / 100 })} /><span>Smaller file<span>Best quality</span></span></label>}
        {animatedCount > 0 && <label>Animated slides<select value={settings.animation} onChange={(event) => state.setSettings({ animation: event.target.value as 'auto' | 'still' })}><option value="auto">Keep animations as MP4</option><option value="still">Export still frames</option></select></label>}
        <details className="export-naming"><summary>File name</summary><label className="sr-only" htmlFor={`${id}-filename`}>Export file name</label><input id={`${id}-filename`} value={fileName} maxLength={120} placeholder="project" onChange={(event) => setFileName(event.target.value)} /></details>
      </fieldset>
      <div className="export-output" aria-live="polite">
        <p>{checking ? 'Checking slides…' : indexes.length === 0 ? 'Choose at least one slide.' : single ? 'One file' : `${indexes.length} numbered ${indexes.length === 1 ? 'file' : 'files'} in a ZIP`}</p>
        {!checking && stillCount > 0 && <span>{settings.format === 'jpeg' ? 'JPEG' : 'PNG'} · {width} × {height} px{settings.format === 'jpeg' ? ' · White behind transparency' : ''}</span>}
        {!checking && videoCount > 0 && <span>{videoCount} MP4 {videoCount === 1 ? 'video' : 'videos'} · {doc.format.width} × {doc.format.height} px</span>}
        {indexes.length > 0 && <span className="export-filename" title={downloadName}>{downloadName}</span>}
      </div>
      {error && <div className="export-feedback" data-tone="error"><p role="alert">{error}</p>{inspectionError && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry check</button>}</div>}
      {!state.exporting && state.outcome === 'complete' && !error && <p className="export-feedback" role="status"><Check size={15} aria-hidden />Your download is ready.</p>}
      {!state.exporting && state.outcome === 'cancelled' && <p className="export-feedback" role="status">Export cancelled. You can change the settings and try again.</p>}
    </div>
    <div className="export-footer">
      {state.exporting ? <>
        <div className="export-progress"><span role="status">{state.progress}</span><div role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.fraction === null ? undefined : Math.round(state.fraction * 100)}><span style={state.fraction === null ? undefined : { width: `${Math.max(2, state.fraction * 100)}%` }} data-indeterminate={state.fraction === null} /></div></div>
        <button className="export-cancel" type="button" disabled={state.cancelling} onClick={state.cancel}>{state.cancelling ? 'Cancelling…' : 'Cancel export'}</button>
      </> : <div className="export-buttons">
        <button className="export-submit" type="submit" disabled={checking || indexes.length === 0 || Boolean(inspectionError)}>{checking ? <Loader2 size={17} className="animate-spin" aria-hidden /> : single ? <Download size={17} aria-hidden /> : <Package size={17} aria-hidden />}{action}</button>
        <button className="export-preview" type="button" aria-label="Preview on phone" title="Preview on phone" onClick={() => { useEditorView.getState().setPreviewOpen(true); onDone(); }}><Smartphone size={18} aria-hidden /></button>
      </div>}
    </div>
  </form>;
}
