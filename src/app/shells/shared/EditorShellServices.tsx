import { ContextMenuHost } from '@/components/Menu';
import { EditorOverlays } from '@/components/Overlays';
import { PhonePreview } from '@/components/preview/PhonePreview';
import { useEditorView } from '@/editor/viewStore';

/** Mount once inside a shell, alongside its visual layout. */
export function EditorShellServices() {
  const previewOpen = useEditorView((s) => s.previewOpen);
  return <><ContextMenuHost /><EditorOverlays />{previewOpen && <PhonePreview />}</>;
}
