import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { command } from '@/core/document/commands';
import { POST_PRESETS, deleteTemplate, listTemplates, presetDocument, saveTemplate, type PostTemplate } from '@/lib/templates';
import type { ProjectDocumentV2 } from '@/types';
import { useToasts } from '@/store/toasts';

function Thumb({ doc }: { doc: ProjectDocumentV2 }) {
  const f = doc.format;
  return <div className="flex h-20 justify-center gap-1 rounded bg-bg-inset p-2" aria-hidden>
    {doc.slideOrder.slice(0, 3).map((sid) => <svg key={sid} viewBox={`0 0 ${f.width} ${f.height}`} className="h-full min-w-0 flex-1">
      <rect width={f.width} height={f.height} fill="#fff"/>
      {doc.slides[sid].layerOrder.map((lid) => doc.layers[lid]).filter((layer) => layer.kind === 'image').map((layer) => <rect key={layer.id} x={layer.x} y={layer.y} width={layer.width} height={layer.height} fill="#7c5cff" stroke="#fff" strokeWidth={layer.kind === 'image' ? (layer.strokeWidth ?? 0) * 2 : 0} transform={`rotate(${layer.rotation} ${layer.x + layer.width/2} ${layer.y + layer.height/2})`}/>)}
    </svg>)}
  </div>;
}
export function PostTemplates() {
  const [saved, setSaved] = useState<PostTemplate[]>([]);
  const [name, setName] = useState('My layout');
  const format = useEditor((s) => s.doc.format);
  const toast = useToasts((s) => s.addToast);
  const refresh = useCallback(() => listTemplates().then(setSaved).catch(() => toast('Saved templates could not be loaded.', 'error')), [toast]);
  useEffect(() => { void refresh(); }, [refresh]); // Device-local layouts are loaded once on opening the panel.
  const apply = (layout: ProjectDocumentV2) => {
    const old = useEditor.getState().doc;
    const photos = old.slideOrder.flatMap((sid) => old.slides[sid].layerOrder.flatMap((lid) => { const layer = old.layers[lid]; return layer?.kind === 'image' && layer.assetId ? [layer.assetId] : []; }));
    const next = structuredClone(layout);
    let cursor = 0;
    for (const sid of next.slideOrder) for (const lid of next.slides[sid].layerOrder) { const layer = next.layers[lid]; if (layer.kind === 'image') layer.assetId = photos[cursor++] ?? null; }
    useEditor.getState().execute(command('Apply post template', (draft) => { draft.format = next.format; draft.slides = next.slides; draft.layers = next.layers; draft.slideOrder = next.slideOrder; }));
    useEditorSession.getState().resetSelection(next.slideOrder[0]);
    toast('Post layout applied. Existing photos fill the slots in order. Undo restores your previous layout.', 'success');
  };
  return <div className="space-y-3 px-3 pb-4">
    <p className="text-sm leading-relaxed text-ink-dim">Replaces the post layout. Photos fill the new slots in order; extras stay in Media. You can undo.</p>
    {POST_PRESETS.map((preset) => {
      const doc = presetDocument(preset.id, format);
      return <button key={preset.id} className="tile block w-full p-2 text-left" onClick={() => apply(doc)}><Thumb doc={doc}/><span className="mt-2 block text-sm font-semibold">{preset.name}</span><span className="text-sm text-ink-dim">{preset.description}</span></button>;
    })}
    <div className="border-t border-line pt-3"><label className="block text-sm">Save this post as a template<input className="input mt-2" aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)}/></label><button className="btn btn-secondary mt-2 w-full" onClick={() => { void saveTemplate(useEditor.getState().doc, name).then(() => { void refresh(); toast('Layout saved without your photos.', 'success'); }).catch((error: unknown) => toast(error instanceof Error ? error.message : 'Template could not be saved.', 'error')); }}>Save layout</button></div>
    {saved.map((template) => <div key={template.id} className="rounded border border-line p-2"><button className="block w-full text-left" onClick={() => apply(template.document)}><Thumb doc={template.document}/><span className="mt-2 block text-sm font-semibold">{template.name}</span></button><button className="mt-2 text-sm text-ink-dim" onClick={() => { void deleteTemplate(template.id).then(refresh).catch(() => toast('Template could not be removed.', 'error'));  }}>Remove template</button></div>)}
  </div>;
}
