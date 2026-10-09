import { useEffect, useState } from 'react';
import { Download, Loader2, Share2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useExport } from '@/editor/exportStore';
import { useAssets } from '@/store/assets';
import { useToasts } from '@/store/toasts';
import { downloadBlob, renderProjectSlides, zipNamedBlobs } from '@/export/ExportController';
import { hdrCapabilities, renderHDRSlide, type HDRCapabilities } from '@/export/hdr';
import { PanelHeader } from '../ui';
import { ProjectTransfer } from '../ProjectTransfer';

export function ExportPanel() {
  const [mode, setMode] = useState<'png' | 'jpeg' | 'hdr'>('jpeg');
  const [target, setTarget] = useState<'current' | 'all'>('all');
  const [scale, setScale] = useState<1 | 2>(1);
  const [capabilities, setCapabilities] = useState<HDRCapabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ files: File[]; download: Blob; name: string } | null>(null);
  const doc = useEditor((s) => s.doc);
  const selected = useEditorSession((s) => s.selectedSlideId);
  const exportCarousel = useExport((s) => s.exportCarousel);
  const exportingCarousel = useExport((s) => s.exporting);
  const assets = useAssets((s) => s.assets);
  const animatedIds = new Set(assets.filter((asset) => asset.mediaKind === 'gif' || asset.mediaKind === 'video').map((asset) => asset.id));
  const hasAnimation = Object.values(doc.layers).some((layer) => layer.kind === 'image' && layer.assetId && animatedIds.has(layer.assetId));
  const toast = useToasts((s) => s.addToast);
  useEffect(() => { setResult(null); }, [doc.id, doc.revision]);
  useEffect(() => { let current = true; void hdrCapabilities().then((result) => { if (current) setCapabilities(result); }); return () => { current = false; }; }, []);
  const prepare = async () => {
    setBusy(true); setError(''); setResult(null);
    const snapshot = structuredClone(doc);
    try {
      const indexes = target === 'all' ? snapshot.slideOrder.map((_, i) => i) : [Math.max(0, snapshot.slideOrder.indexOf(selected))];
      const safe = snapshot.name.replace(/[^a-z0-9-_]+/gi, '_') || 'post';
      const files: File[] = [];
      for (const [position, index] of indexes.entries()) {
        setProgress(`Rendering ${position + 1} of ${indexes.length}…`);
        const blob = mode === 'hdr' ? await renderHDRSlide(snapshot, index, scale) : (await renderProjectSlides(snapshot, [index], { format: mode, pixelRatio: scale, quality: .95 }))[0];
        if (!blob) throw new Error('The image renderer returned no file.');
        files.push(new File([blob], `${safe}_${String(index + 1).padStart(2, '0')}${mode === 'hdr' ? '_HDR' : ''}.${mode === 'png' ? 'png' : 'jpg'}`, { type: blob.type }));
      }
      const download = files.length === 1 ? files[0] : await zipNamedBlobs(files.map((file) => ({ name: file.name, blob: file })));
      if (useEditor.getState().doc.id !== snapshot.id || useEditor.getState().doc.revision !== snapshot.revision) throw new Error('The post changed during export. Prepare it again to include your latest edits.');
      setResult({ files, download, name: files.length === 1 ? files[0].name : `${safe}${mode === 'hdr' ? '_HDR' : ''}_carousel.zip` });
    } catch (error) { setError(error instanceof Error ? error.message : 'Export failed.'); }
    finally { setBusy(false); setProgress(''); }
  };
  const canShare = result && typeof navigator.canShare === 'function' && navigator.canShare({ files: result.files });
  const share = async () => {
    if (!result) return;
    try { await navigator.share({ files: result.files }); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) toast('Sharing failed. Use Download instead.', 'error'); }
  };
  return <div className="flex h-full min-h-0 flex-col">
    <PanelHeader title="Export your post" hint="Prepare the files, then download or share them."/>
    <div className="space-y-4 overflow-auto px-3 pb-4 text-sm">
      <label className="block">Slides<select className="input mt-2" aria-label="Slides" value={target} disabled={busy} onChange={(e) => { setTarget(e.target.value as 'current' | 'all'); setResult(null); }}><option value="all">Whole carousel ({doc.slideOrder.length})</option><option value="current">Selected slide</option></select></label>
      <label className="block">Image format<select className="input mt-2" aria-label="Image format" value={mode} disabled={busy} onChange={(e) => { setMode(e.target.value as typeof mode); setResult(null); }}><option value="jpeg">JPEG · SDR</option><option value="png">PNG · SDR</option><option value="hdr" disabled={!capabilities?.hdr}>JPEG · Adaptive HDR{capabilities === null ? ' (checking…)' : !capabilities.hdr ? ' (helper unavailable)' : ''}</option></select></label>
      <p className="leading-relaxed text-ink-dim">{capabilities?.hdr ? 'HDR export uses untouched originals and your Mac’s image tools. The editing canvas shows an SDR preview.' : capabilities?.error || 'Checking HDR export support…'}</p>
      {mode === 'hdr' && <p className="leading-relaxed text-ink-dim">Each exported slide must contain visible HDR highlights. Animated media is excluded. Files include an SDR image and an HDR gain map.</p>}
      <label className="block">Resolution<select className="input mt-2" aria-label="Resolution" value={scale} disabled={busy} onChange={(e) => { setScale(Number(e.target.value) as 1 | 2); setResult(null); }}><option value="1">1× · {doc.format.width} × {doc.format.height}</option><option value="2">2× · {doc.format.width * 2} × {doc.format.height * 2}</option></select></label>
      <button className="btn btn-primary w-full" disabled={busy || mode === 'hdr' && !capabilities?.hdr} onClick={() => void prepare()}>{busy && <Loader2 size={14} className="animate-spin"/>}{busy ? progress || 'Packaging…' : 'Prepare export'}</button>
      {error && <p role="alert" className="rounded border border-red-500/40 p-3 leading-relaxed text-red-200">{error}</p>}
      {result && <div className="space-y-3 rounded-lg border border-line-strong bg-bg-inset p-3" aria-live="polite"><p>{result.files.length} image{result.files.length === 1 ? '' : 's'} ready · {(result.download.size / 1024 / 1024).toFixed(1)} MB</p><button className="btn btn-primary w-full" onClick={() => downloadBlob(result.download, result.name)}><Download size={14}/>Download{result.files.length > 1 ? ' ZIP' : ' image'}</button>{canShare && <button className="btn btn-secondary w-full" onClick={() => void share()}><Share2 size={14}/>Share images</button>}<p className="break-all text-ink-dim">{result.name}</p></div>}
      {hasAnimation && <div className="border-t border-line pt-4"><p className="mb-3 text-ink-dim">For animated GIFs and videos, use PNG / MP4 carousel export.</p><button className="btn btn-secondary w-full" disabled={busy || exportingCarousel} onClick={() => void exportCarousel()}>Export animated carousel</button></div>}
      <div className="border-t border-line pt-4"><p className="mb-3 text-ink-dim">Keep an editable backup with all original photos.</p><ProjectTransfer backup/></div>
    </div>
  </div>;
}
