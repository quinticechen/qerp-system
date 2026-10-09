import { useCallback, useEffect, useRef, useState } from 'react';
import { MantaRayIcon } from './MantaRayIcon';
import { QueryChat } from './QueryChat';
import { useSwipeBack } from './useSwipeBack';
import { useIsMobile } from '@/hooks/use-mobile';

// Marks the history entry pushed while the full-screen chat is open on mobile
const HISTORY_FLAG = 'queryFullScreen';

function isFullScreenEntry(): boolean {
  return Boolean((window.history.state as Record<string, unknown> | null)?.[HISTORY_FLAG]);
}

export function QueryFloatButton() {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
          <QueryChat onClose={close} fullScreen />
        </div>
      </>
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
        <QueryChat onClose={close} />
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
