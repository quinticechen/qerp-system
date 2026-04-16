import { useState } from 'react';
import { MantaRayIcon } from './MantaRayIcon';
import { QueryChat } from './QueryChat';

export function QueryFloatButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
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
        <QueryChat onClose={() => setIsOpen(false)} />
      </div>

      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={[
          'flex items-center gap-2.5 pl-3 pr-4 py-3 rounded-full shadow-lg',
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
    </div>
  );
}
