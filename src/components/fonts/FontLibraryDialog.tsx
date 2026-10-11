import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, WifiOff, X } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { editorActivity } from '@/editor/activity';
import { listFonts, type FontFamily, type FontVariant } from '@/render/fonts/library';
import { loadCustomFont } from '@/render/fonts/custom';
import { fontFileDefaults, importFontFile, MAX_FONT_BYTES } from '@/render/fonts/import';
import { downloadGoogleFont, fetchGoogleCatalog, googleFontsKey, GOOGLE_OFFLINE_MESSAGE, saveGoogleFontsKey, type GoogleFont } from '@/render/fonts/google';
import { fontSelection } from './FontSelector';
import { resolveFontFamily } from '@/render/fonts/families';
import './fonts.css';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}
export function FontLibraryDialog() {
  const ref = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  const networkRequest = useRef(false);
  const fileRequest = useRef(0);
  const projectId = useEditor((s) => s.doc.id);
  const [layerId] = useState(() => useEditorSession.getState().selectedLayerId);
  const [tab, setTab] = useState<'library' | 'google'>('library');
  const online = useOnline();
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [catalog, setCatalog] = useState<GoogleFont[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('400');
  const [style, setStyle] = useState<FontVariant['style']>('normal');
  const close = () => useEditorSession.getState().setOverlay(null);
  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    void Promise.all([listFonts(), googleFontsKey()]).then(([library, apiKey]) => {
      if (!alive.current) return;
      setFonts(library); setConfigured(Boolean(apiKey)); setShowKey(!apiKey);
    }).catch(() => { if (alive.current) setError('Your font settings could not be read. Try reopening this window.'); });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); useEditorSession.getState().setOverlay(null); }
      if (event.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])].filter((v) => v.getClientRects().length && v.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { alive.current = false; request.current?.abort(); window.removeEventListener('keydown', onKey, true); if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => { if (!online) { if (networkRequest.current) request.current?.abort(); setTab('library'); } }, [online]);

  const job = async (label: string, run: (signal: AbortSignal) => Promise<void>, network = false) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    networkRequest.current = network;
    const release = editorActivity.begin();
    setBusy(label); setError(''); setNotice('');
    try { await run(controller.signal); }
    catch (error) {
      if (alive.current && !controller.signal.aborted) setError(error instanceof TypeError ? 'Could not connect to Google Fonts. Check your connection and try again.' : error instanceof Error ? error.message : 'This font could not be loaded.');
    } finally {
      release();
      if (request.current === controller) request.current = null;
      if (alive.current) setBusy('');
    }
  };
  const apply = async (font: FontFamily) => {
    await loadCustomFont(font.family);
    if (!alive.current) return;
    const state = useEditor.getState();
    const target = layerId ? state.doc.layers[layerId] : undefined;
    if (state.doc.id === projectId && target?.kind === 'text') state.updateLayer(target.id, fontSelection(font, target));
    setNotice(`${font.name} is ready to use offline.`);
  };
  const refresh = async () => { const library = await listFonts(); if (alive.current) setFonts(library); };
  const browse = () => {
    setTab('google'); setQuery('');
    if (configured && !catalog.length) void job('Loading catalog…', async (signal) => { const items = await fetchGoogleCatalog(signal); if (alive.current && !signal.aborted) setCatalog(items); }, true);
  };
  const results = useMemo(() => catalog.filter((font) => font.family.toLowerCase().includes(query.toLowerCase().trim()) && (!category || font.category === category)), [catalog, query, category]);

  return <div className="studio-scrim fonts-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Fonts" className="studio-dialog fonts-dialog">
      <div className="studio-dialog-head"><div><h2 className="heading-md">Fonts</h2><p className="mt-1 text-xs text-ink-dim">Your font library, saved on this device.</p></div><button type="button" className="icon-btn" aria-label="Close Fonts" onClick={close}><X size={17} aria-hidden /></button></div>
      <div className="fonts-tabs" role="tablist" aria-label="Font sources">
        <button type="button" role="tab" aria-selected={tab === 'library'} aria-controls="font-library-panel" id="font-library-tab" onClick={() => { setTab('library'); setError(''); }}>Your fonts</button>
        <button type="button" role="tab" aria-selected={tab === 'google' && online} aria-controls="google-fonts-panel" id="google-fonts-tab" disabled={!online || Boolean(busy)} aria-describedby={!online ? 'google-fonts-offline' : undefined} title={!online ? GOOGLE_OFFLINE_MESSAGE : undefined} onClick={browse}>Google Fonts{!online && <WifiOff size={14} aria-hidden />}</button>
      </div>
      {!online && <p id="google-fonts-offline" role="status" className="fonts-message"><WifiOff size={15} aria-hidden />{GOOGLE_OFFLINE_MESSAGE} Your saved fonts are available below.</p>}
      {error && <p role="alert" className="fonts-message text-danger">{error}</p>}
      {(busy || notice) && <p role="status" className="fonts-message">{busy || notice}</p>}
      <div className="fonts-body scrollbar-thin">
        {(tab === 'library' || !online) ? <section role="tabpanel" id="font-library-panel" aria-labelledby="font-library-tab">
          <div className="fonts-import">
            <h3 className="heading-sm">Import a font file</h3>
            <p className="text-xs text-ink-dim">TTF, OTF, WOFF or WOFF2 · Up to 20 MB</p>
            <label className="fonts-file"><Upload size={16} aria-hidden /><span>{file?.name ?? 'Choose font file'}</span><input type="file" aria-label="Choose font file" accept=".ttf,.otf,.woff,.woff2" disabled={Boolean(busy)} onChange={async (event) => {
              const token = ++fileRequest.current;
              const chosen = event.target.files?.[0]; setFile(null); setError('');
              if (!chosen) return;
              if (!/\.(ttf|otf|woff2?)$/i.test(chosen.name) || !chosen.size || chosen.size > MAX_FONT_BYTES) { setError('Choose a TTF, OTF, WOFF or WOFF2 file smaller than 20 MB.'); return; }
              try { const defaults = fontFileDefaults(await chosen.arrayBuffer(), chosen.name); if (alive.current && token === fileRequest.current) { setFile(chosen); setName(defaults.name); setWeight(defaults.weight); setStyle(defaults.style); } }
              catch { if (alive.current) setError('This font file could not be read. Choose another file.'); }
            }} /></label>
            {file && <form className="fonts-import-form" onSubmit={(event) => {
              event.preventDefault();
              void job('Importing font…', async (signal) => { const saved = await importFontFile(file, name, { weight, style }); if (signal.aborted) return; await refresh(); await apply(saved); if (alive.current) setFile(null); });
            }}>
              <label>Font name<input className="input" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} required /></label>
              <div className="grid grid-cols-2 gap-2"><label>Weight or variable range<input className="input" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="400 or 100 900" required /></label><label>Style<select className="input" value={style} onChange={(e) => setStyle(e.target.value as FontVariant['style'])}><option value="normal">Normal</option><option value="italic">Italic</option></select></label></div>
              <p className="text-xs text-ink-dim">Check the name, weight and style before importing. Compressed files use filename defaults.</p>
              <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>Import and use font</button>
            </form>}
          </div>
          <div className="fonts-list">
            {fonts.length === 0 && <p className="fonts-empty">Your library is empty. Import a font file or download a family from Google Fonts.</p>}
            {fonts.map((font) => <div className="fonts-row" key={font.family}><div><p className="fonts-name">{font.name}</p><p className="text-xs text-ink-dim">{font.source === 'google' ? 'Google Fonts' : 'Imported'} · {font.variants.map((v) => `${v.weight}${v.style === 'italic' ? ' italic' : ''}`).join(', ')}</p></div><button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void job('Loading font…', async () => apply(font))}>Use font<span className="sr-only"> {font.name}</span></button></div>)}
          </div>
        </section> : <section role="tabpanel" id="google-fonts-panel" aria-labelledby="google-fonts-tab">
          <div className="fonts-google-settings">
            <div className="flex items-center justify-between gap-2"><p className="text-xs text-ink-dim">Download once. Edit and export offline.</p>{configured && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => setShowKey((v) => !v)}>API key settings</button>}</div>
            {showKey && <form className="fonts-key-form" onSubmit={(event) => {
              event.preventDefault();
              void job('Loading catalog…', async (signal) => { await saveGoogleFontsKey(key); const configuredKey = await googleFontsKey(); if (alive.current) setConfigured(Boolean(configuredKey)); const items = await fetchGoogleCatalog(signal, true); if (alive.current && !signal.aborted) { setCatalog(items); setKey(''); setShowKey(false); } }, true);
            }}><label>Google Fonts API key<input type="password" className="input" value={key} autoComplete="off" spellCheck={false} onChange={(event) => setKey(event.target.value)} placeholder={configured ? 'Replace key (blank uses deployment default)' : 'Paste your API key here'} /></label><p className="text-xs text-ink-dim">Saved only in this browser. Restrict your key to the Fonts Developer API and your website.</p><button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>Save key and browse</button></form>}
            {configured && !catalog.length && !busy && <button className="btn" type="button" onClick={() => void job('Loading catalog…', async (signal) => { const items = await fetchGoogleCatalog(signal, true); if (alive.current && !signal.aborted) setCatalog(items); }, true)}>Load catalog</button>}
          </div>
          {catalog.length > 0 && <>
            <div className="fonts-search"><input className="input" type="search" placeholder="Search font families…" aria-label="Search Google Fonts" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="input" aria-label="Font category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{['sans-serif', 'serif', 'display', 'handwriting', 'monospace'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
            <p className="fonts-count text-xs text-ink-dim">{results.length} families{results.length > 60 && ' · Showing the first 60; search to narrow the list'}</p>
            <div className="fonts-list">{results.slice(0, 60).map((font) => {
              const saved = fonts.find((v) => v.source === 'google' && v.name === font.family);
              return <div className="fonts-row" key={font.family}><div><p className="fonts-name" style={saved ? { fontFamily: resolveFontFamily(saved.family) } : undefined}>{font.family}</p><p className="text-xs text-ink-dim">{font.category} · {font.axes?.some((v) => v.tag === 'wght') ? 'Variable weights' : `${Object.keys(font.files).length} styles`}{saved && ' · Available offline'}</p></div><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void job(saved ? 'Loading font…' : `Downloading ${font.family}…`, async (signal) => { const fontRecord = saved ?? await downloadGoogleFont(font, signal); if (signal.aborted) return; await refresh(); await apply(fontRecord); }, !saved)}>{!saved && <Download size={14} aria-hidden />}{saved ? 'Use font' : 'Download'}<span className="sr-only"> {font.family}</span></button></div>;
            })}{results.length === 0 && <p className="fonts-empty">No fonts match your search. Try another name or category.</p>}</div>
          </>}
        </section>}
      </div>
    </div>
  </div>;
}
