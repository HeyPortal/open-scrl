import SharedMobileEditorShell from '@/components/mobile/MobileEditorShell';

/** CSS islands remain in flow so the shared stage measures their actual space. */
export default function MobileEditorShell() {
  return <div className="studio-mobile-shell h-full"><SharedMobileEditorShell /></div>;
}
