import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MantaRayIcon } from './MantaRayIcon';
import { QueryChat, type QueryLayout } from './QueryChat';
import { useSwipeBack } from './useSwipeBack';
import { useIsMobile } from '@/hooks/use-mobile';

// Marks the history entry pushed while the full-screen chat is open on mobile
const HISTORY_FLAG = 'queryFullScreen';

function isFullScreenEntry(): boolean {
  return Boolean((window.history.state as Record<string, unknown> | null)?.[HISTORY_FLAG]);
}

// Desktop layout and sidebar width are remembered per browser (docs/requirements/QUERY_UI_LAYOUT_AND_RECORD_NAV.md §2).
const LAYOUT_KEY = 'query-layout';
const WIDTH_KEY = 'query-sidebar-width';
/** Same width as the floating panel. */
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
/** CSS variable Layout.tsx reserves on the right while the sidebar is open, so the ERP shrinks. */
const SIDEBAR_WIDTH_VAR = '--query-sidebar-width';

const maxWidth = () => Math.max(MIN_WIDTH, Math.floor(window.innerWidth / 2));
const clampWidth = (width: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));

function readStored<T>(key: string, parse: (value: string) => T | null, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

const parseLayout = (value: string): QueryLayout | null =>
  value === 'floating' || value === 'sidebar' || value === 'fullscreen' ? value : null;
const parseWidth = (value: string): number | null => (Number.isFinite(Number(value)) ? clampWidth(Number(value)) : null);

export function QueryFloatButton() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [layout, setLayout] = useState<QueryLayout>(() => readStored(LAYOUT_KEY, parseLayout, 'floating'));
  const [width, setWidth] = useState<number>(() => readStored(WIDTH_KEY, parseWidth, DEFAULT_WIDTH));
  const panelRef = useRef<HTMLDivElement>(null);

  const changeLayout = useCallback((next: QueryLayout) => {
    setLayout(next);
    store(LAYOUT_KEY, next);
  }, []);

  // The sidebar takes its width from the ERP instead of covering it.
  const sidebarOpen = !isMobile && isOpen && layout === 'sidebar';
  useEffect(() => {
    const root = document.documentElement;
    if (sidebarOpen) root.style.setProperty(SIDEBAR_WIDTH_VAR, `${width}px`);
    else root.style.removeProperty(SIDEBAR_WIDTH_VAR);
    return () => {
      root.style.removeProperty(SIDEBAR_WIDTH_VAR);
    };
  }, [sidebarOpen, width]);

  // Dragging the sidebar's left edge resizes it.
  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const onMove = (e: PointerEvent) => setWidth(clampWidth(window.innerWidth - e.clientX));
    const onUp = (e: PointerEvent) => {
      store(WIDTH_KEY, String(clampWidth(window.innerWidth - e.clientX)));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // On mobile the chat is a page of its own: opening pushes a history entry, so the browser's
  // back button or edge-swipe returns to the ERP page instead of leaving it.
  const open = useCallback(() => {
    if (isMobile && !isFullScreenEntry()) {
      window.history.pushState({ ...window.history.state, [HISTORY_FLAG]: true }, '');
    }
    setIsOpen(true);
  }, [isMobile]);

  const close = useCallback(() => {
    if (isFullScreenEntry()) {
      window.history.back(); // the popstate listener below closes the panel
    } else {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onPopState = () => {
      if (!isFullScreenEntry()) setIsOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isOpen]);

  // While the full-screen chat covers the page, the ERP page must not scroll (or show its
  // scrollbar) underneath — only the conversation scrolls.
  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const html = document.documentElement;
    const previous = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previous.html;
      document.body.style.overflow = previous.body;
    };
  }, [isMobile, isOpen]);

  const swipeHandlers = useSwipeBack(panelRef, close);

  // After a confirmed write the ERP opens the record (QUERY_UI_LAYOUT_AND_RECORD_NAV.md §1.4): on
  // mobile the chat page closes; a full-screen chat becomes the sidebar so the record is visible.
  const openRecord = useCallback((path: string) => {
    if (isMobile) setIsOpen(false);
    else if (layout === 'fullscreen') changeLayout('sidebar');
    navigate(path);
  }, [isMobile, layout, changeLayout, navigate]);

  if (isMobile) {
    return (
      <>
        {!isOpen && (
          <div className="fixed bottom-6 right-6 z-50">
            <TriggerButton isOpen={false} onClick={open} />
          </div>
        )}
        <div
          ref={panelRef}
          {...swipeHandlers}
          role="dialog"
          aria-label="Query 助理"
          className={[
            'fixed inset-0 z-50 h-dvh bg-white touch-pan-y',
            // visibility flips at the end of the slide-out, taking the closed page out of focus order
            'transition-[transform,visibility] duration-300 ease-out',
            isOpen ? 'translate-x-0 visible' : 'translate-x-full invisible',
          ].join(' ')}
        >
          <QueryChat onClose={close} fullScreen onOpenRecord={openRecord} />
        </div>
      </>
    );
  }

  const chat = <QueryChat onClose={close} layout={layout} onLayoutChange={changeLayout} onOpenRecord={openRecord} />;

  if (isOpen && layout === 'sidebar') {
    return (
      <aside
        role="dialog"
        aria-label="Query 助理"
        className="fixed top-0 right-0 z-40 h-screen bg-white border-l border-gray-200 shadow-xl"
        style={{ width }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="調整 Query 寬度"
          title="拖曳調整寬度"
          onPointerDown={startResize}
          className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-indigo-300/60 active:bg-indigo-400/60"
        />
        {chat}
      </aside>
    );
  }

  if (isOpen && layout === 'fullscreen') {
    return (
      <div role="dialog" aria-label="Query 助理" className="fixed inset-0 z-50 bg-white">
        {chat}
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {/* Chat Panel */}
      <div
        className={[
          'w-[380px] h-[580px] rounded-2xl shadow-2xl border border-gray-200/60 overflow-hidden',
          'transition-all duration-300 origin-bottom-right',
          isOpen
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none',
        ].join(' ')}
        style={{ background: 'white' }}
      >
        {chat}
      </div>

      <TriggerButton isOpen={isOpen} onClick={isOpen ? close : open} />
    </div>
  );
}

function TriggerButton({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'pointer-events-auto flex items-center gap-2.5 pl-3 pr-4 py-3 rounded-full shadow-lg',
        'bg-gradient-to-r from-indigo-600 to-violet-600 text-white',
        'hover:shadow-xl hover:scale-105 active:scale-95',
        'transition-all duration-200',
      ].join(' ')}
      aria-label="開啟 Query 助理"
    >
      <div className={`transition-transform duration-300 ${isOpen ? 'rotate-12' : ''}`}>
        <MantaRayIcon size={26} className="text-white drop-shadow-sm" />
      </div>
      <span className="text-sm font-semibold tracking-wide">Query</span>
    </button>
  );
}
