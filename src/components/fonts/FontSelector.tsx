import { useEffect, useState } from 'react';
import type { TextLayer } from '@/types';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { resolveFontFamily } from '@/render/fonts/families';
import { listFonts, type FontFamily } from '@/render/fonts/library';
import { loadCustomFont } from '@/render/fonts/custom';
import { editorActivity } from '@/editor/activity';

const BUILTIN_FONTS = ['Inter', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'system-ui'];

export function fontSelection(font: FontFamily, layer: TextLayer): Partial<TextLayer> {
  const style = layer.italic && font.variants.some((v) => v.style === 'italic') ? 'italic' : font.variants.some((v) => v.style === 'normal') ? 'normal' : 'italic';
  const weights = font.variants.filter((v) => v.style === style).map((v) => {
    const [min, max = min] = v.weight.split(' ').map(Number);
    return Math.max(min, Math.min(max, layer.fontWeight));
  });
  const weight = weights.sort((a, b) => Math.abs(a - layer.fontWeight) - Math.abs(b - layer.fontWeight))[0] ?? 400;
  return { fontFamily: font.family, fontWeight: weight, italic: style === 'italic' };
}

export function FontSelector({ layer }: { layer: TextLayer }) {
  const projectId = useEditor((s) => s.doc.id);
  const overlay = useEditorSession((s) => s.overlay);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void listFonts().then((value) => { if (current) setFonts(value); }).catch(() => { if (current) setError('Your font library could not be read. Try reopening the editor.'); });
    return () => { current = false; };
  }, [overlay, layer.fontFamily]);
  const choose = async (family: string) => {
    const release = editorActivity.begin();
    setBusy(true); setError('');
    try {
      await loadCustomFont(family);
      const state = useEditor.getState();
      const target = state.doc.layers[layer.id];
      if (state.doc.id !== projectId || useEditorSession.getState().selectedLayerId !== layer.id || target?.kind !== 'text') return;
      const font = fonts.find((v) => v.family === family);
      state.updateLayer(layer.id, font ? fontSelection(font, target) : { fontFamily: family });
    } catch (error) { setError(error instanceof Error ? error.message : 'This font could not be loaded.'); }
    finally { release(); setBusy(false); }
  };
  const known = BUILTIN_FONTS.includes(layer.fontFamily) || fonts.some((font) => font.family === layer.fontFamily);
  return <>
    <select className="input" value={layer.fontFamily} disabled={busy} onChange={(e) => void choose(e.target.value)} aria-label="Font" style={{ fontFamily: resolveFontFamily(layer.fontFamily) }}>
      {!known && <option value={layer.fontFamily}>Current font (unavailable on this device)</option>}
      {BUILTIN_FONTS.map((family) => <option key={family} value={family} style={{ fontFamily: resolveFontFamily(family) }}>{family}</option>)}
      {fonts.length > 0 && <optgroup label="Your fonts">{fonts.map((font) => <option key={font.family} value={font.family}>{font.name}{font.source === 'file' ? ` (${font.variants[0].weight}${font.variants[0].style === 'italic' ? ' italic' : ''})` : ''}</option>)}</optgroup>}
    </select>
    <button type="button" className="btn w-full" onClick={() => useEditorSession.getState().setOverlay('fonts')}>Manage fonts</button>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </>;
}
