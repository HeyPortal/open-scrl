import { useEffect, useId, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Check, Download, FileImage, Loader2, Package, Smartphone } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { useExport } from '@/editor/exportStore';
import { inspectSlideVideo } from '@/export/video';
import { ExportPanorama } from './ExportPanorama';
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
  const included = useMemo(() => new Set(indexes), [indexes]);

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

  const toggle = (slideId: string, on: boolean) => setChosen((previous) => { const next = new Set(previous); if (on) next.add(slideId); else next.delete(slideId); return next; });
  const imagesLocked = !checking && stillCount === 0;
  const kind = settings.format === 'jpeg' ? 'JPEG' : 'PNG';

  return <form className="export-panel" onSubmit={(event) => void submit(event)}>
    <div className="export-fields scrollbar-thin">
      <section className="export-stage" aria-label="Preview">
        <ExportPanorama doc={doc} included={included} choosing={scope === 'chosen' && !state.exporting} checkerboard={settings.format === 'png'} onToggle={toggle} />
        <div className="export-stage-caption">
          <p className="export-project">{doc.name || 'Untitled'}</p>
          <span>{indexes.length === doc.slideOrder.length ? `${doc.slideOrder.length} ${doc.slideOrder.length === 1 ? 'slide' : 'slides'}` : `${indexes.length} of ${doc.slideOrder.length} slides`} · {doc.format.name}</span>
        </div>
      </section>
      <fieldset disabled={state.exporting} className="export-settings">
        <div className="export-scope">
          <Segments label="Slides" name={`${id}-scope`} value={scope} onChange={setScope} options={[['all', 'All slides'], ['current', 'This slide'], ['chosen', 'Choose slides']]} />
          {scope === 'chosen' && <div className="export-pick-actions"><span>{indexes.length ? `${indexes.length} selected` : 'Tap slides above to include them'}</span><button type="button" onClick={() => setChosen(new Set(doc.slideOrder))}>Select all</button><button type="button" onClick={() => setChosen(new Set())}>Clear</button></div>}
        </div>
        <div className="export-group">
          <Row label="Format" hint={settings.format === 'jpeg' ? 'Smaller files, no transparency' : 'Lossless, keeps transparency'}>
            <Segments label="Image format" name={`${id}-format`} value={settings.format} disabled={imagesLocked} onChange={(format) => state.setSettings({ format })} options={[['png', 'PNG'], ['jpeg', 'JPEG']]} compact />
          </Row>
          <Row label="Size" hint={settings.pixelRatio === 2 ? 'Double size for extra detail' : 'Native size for every platform'}>
            <Segments label="Image resolution" name={`${id}-scale`} value={String(settings.pixelRatio) as '1' | '2'} disabled={imagesLocked} onChange={(value) => state.setSettings({ pixelRatio: Number(value) })} options={[['1', '1×'], ['2', '2×']]} compact />
          </Row>
          {settings.format === 'jpeg' && stillCount > 0 && <Row label="Quality" hint={settings.quality >= .9 ? 'Best quality' : settings.quality >= .75 ? 'Balanced' : 'Smallest file'}>
            <div className="export-quality"><input type="range" className="range" aria-label="JPEG quality" min="50" max="100" step="1" value={Math.round(settings.quality * 100)} style={{ '--fill': `${(Math.round(settings.quality * 100) - 50) * 2}%` } as CSSProperties} onChange={(event) => state.setSettings({ quality: Number(event.target.value) / 100 })} /><output>{Math.round(settings.quality * 100)}%</output></div>
          </Row>}
          {animatedCount > 0 && <Row label="Animations" hint={settings.animation === 'still' ? 'First frame as an image' : 'H.264 video, Instagram ready'}>
            <Segments label="Animated slides" name={`${id}-animation`} value={settings.animation ?? 'auto'} onChange={(animation: 'auto' | 'still') => state.setSettings({ animation })} options={[['auto', 'MP4'], ['still', 'Still']]} compact />
          </Row>}
          <Row label="File name" htmlFor={`${id}-filename`}>
            <div className="export-filename-field"><input id={`${id}-filename`} aria-label="Export file name" value={fileName} maxLength={120} placeholder="project" spellCheck={false} onChange={(event) => setFileName(event.target.value)} /><span aria-hidden>{downloadName.slice(safe.length)}</span></div>
          </Row>
        </div>
      </fieldset>
      <div className="export-output" aria-live="polite">
        <span className="export-output-icon" aria-hidden>{single ? <FileImage size={18} /> : <Package size={18} />}</span>
        <div>
          <p>{checking ? 'Checking slides…' : indexes.length === 0 ? 'Choose at least one slide.' : single ? 'One file' : `${indexes.length} numbered ${indexes.length === 1 ? 'file' : 'files'} in a ZIP`}</p>
          {!checking && stillCount > 0 && <span>{kind} · {width} × {height} px{settings.format === 'jpeg' ? ' · White behind transparency' : ''}</span>}
          {!checking && videoCount > 0 && <span>{videoCount} MP4 {videoCount === 1 ? 'video' : 'videos'} · {doc.format.width} × {doc.format.height} px</span>}
          {indexes.length > 0 && <span className="export-filename" title={downloadName}>{downloadName}</span>}
        </div>
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

/** A settings line: label and hint on the left, its control on the right. */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return <div className="export-row">
    <div className="export-row-text">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}{hint && <small>{hint}</small>}</div>
    {children}
  </div>;
}

/** Native radios styled as a segmented control, so keyboard and form semantics come for free. */
function Segments<T extends string>({ label, name, value, options, onChange, disabled, compact }: {
  label: string; name: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; disabled?: boolean; compact?: boolean;
}) {
  return <div className="export-segments" role="radiogroup" aria-label={label} data-compact={compact || undefined}>
    {options.map(([option, text]) => <label key={option}>
      <input type="radio" name={name} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)} />
      <span>{text}</span>
    </label>)}
  </div>;
}
