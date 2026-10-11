import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HardDrive, Plus } from 'lucide-react';
import { AppLogo } from '../AppLogo';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { useEditor } from '@/store/editor';
import { GridStarters } from '../home/GridStarters';
import { BLANK, useHomeActions } from '../home/useHomeActions';
import { useNow } from '../home/useNow';
import { NewCarouselCard } from './home/NewCarouselCard';
import { ProjectList } from './home/ProjectList';
import './home/home.css';

/** Scroll distance (px) after which the large title hands over to the compact bar. */
const COLLAPSE_AT = 44;
/** A visual viewport this much shorter than the layout viewport means the on-screen keyboard is up. */
const KEYBOARD_INSET = 120;

const isTextField = (element: Element | null) =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;

/** True while the on-screen keyboard is likely open (visual viewport shrink, or a text field focused). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const shrunk = viewport ? window.innerHeight - viewport.height > KEYBOARD_INSET : false;
      setOpen(shrunk || isTextField(document.activeElement));
    };
    update();
    viewport?.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return open;
}

/** Mobile home screen: start a carousel and open saved projects. */
export default function MobileHome() {
  const projects = useEditor((s) => s.projects);
  const actions = useHomeActions();
  const now = useNow();

  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [name, setName] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [createVisible, setCreateVisible] = useState(true);
  const keyboardOpen = useKeyboardOpen();
  const scroller = useRef<HTMLElement>(null);
  const createCard = useRef<HTMLFormElement>(null);

  // The floating "New carousel" pill shows only while the create card is scrolled out of view.
  useEffect(() => {
    const root = scroller.current;
    const target = createCard.current;
    if (!root || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCreateVisible(entry.isIntersecting), { root, threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const scrollToCreate = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  const showPill = !createVisible && !keyboardOpen;

  return (
    <div className="mobile-home home home-phone">
      {/* Compact bar: fades in over the content once the large title scrolls away. */}
      <div aria-hidden className="home-topbar" data-collapsed={collapsed}>
        <div className="home-topbar-inner">
          <AppLogo className="home-logo home-logo-sm" size={26} />
          <span className="home-brand-name app-wordmark">Open-SCRL</span>
        </div>
      </div>

      <main
        ref={scroller}
        data-home-scroll
        className="home-phone-scroll"
        onScroll={(event) => setCollapsed(event.currentTarget.scrollTop > COLLAPSE_AT)}
      >
        <div className="home-phone-content">
          <header className="home-phone-header">
            <div className="home-phone-brand">
              <AppLogo className="home-logo home-logo-lg" size={44} />
              <h1 className="home-phone-title app-wordmark">Open-SCRL</h1>
            </div>
          </header>

          {actions.openError && (
            <div role="alert" className="home-alert">
              <AlertTriangle size={16} aria-hidden />
              <span>{actions.openError}</span>
            </div>
          )}

          <NewCarouselCard
            ref={createCard}
            format={format}
            onFormatChange={setFormat}
            name={name}
            onNameChange={setName}
            creating={actions.creating === BLANK}
            busy={actions.busy}
            onSubmit={() => void actions.create(format, name)}
          />

          <details className="home-grid-options">
            <summary>Start from a grid</summary>
            <GridStarters
              format={format}
              pendingId={actions.creating !== BLANK ? actions.creating : null}
              busy={actions.busy}
              onPick={(template) => void actions.create(format, name, template)}
            />
          </details>

          <ProjectList
            projects={projects}
            openingId={actions.openingId}
            busy={actions.busy}
            now={now}
            onOpen={(project) => void actions.open(project)}
            onCreate={scrollToCreate}
          />

          <footer className="home-phone-footer">
            <HardDrive size={12} aria-hidden />
            Projects are stored locally in this browser.
          </footer>
        </div>
      </main>

      <button type="button" className="home-fab" data-visible={showPill} tabIndex={showPill ? 0 : -1} aria-hidden={!showPill} onClick={scrollToCreate}>
        <Plus size={18} strokeWidth={2.5} aria-hidden />
        New carousel
      </button>
    </div>
  );
}
