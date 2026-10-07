import { useEffect, useRef, useState, KeyboardEvent, type ReactNode } from 'react';
import { X, Send, Trash2, Loader2, ChevronDown, Pin, Plus, Trash } from 'lucide-react';
import { MantaRayIcon } from './MantaRayIcon';
import { MarkdownMessage } from './MarkdownMessage';
import { ActionCard } from './ActionCard';
import { useQueryChat, QuerySession } from '@/hooks/useQueryChat';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

interface QueryChatProps {
  onClose: () => void;
}

const WELCOME_MESSAGE = `你好！我是 **Query**，你的 ERP 智慧助理 🐟

我可以幫你：
- 查詢客戶、訂單和產品資訊
- 檢查庫存狀況和低庫存警示
- 查看採購單和出貨記錄
- 了解合作工廠資訊

有什麼需要幫忙的嗎？`;

export function QueryChat({ onClose }: QueryChatProps) {
  const {
    sessions,
    activeSessionId,
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    createSession,
    switchSession,
    deleteSession,
    togglePin,
  } = useQueryChat();
  // inputKey is incremented on every send to force-remount the textarea,
  // guaranteeing the DOM value and height are fully reset regardless of browser
  // or React controlled-component quirks.
  const [inputKey, setInputKey] = useState(0);
  const [hasInput, setHasInput] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Re-focus after each send (textarea remounts)
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputKey]);

  // Initial focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const text = inputRef.current?.value?.trim() ?? '';
    if (!text || isLoading) return;
    setHasInput(false);
    setInputKey((k) => k + 1);   // remounts textarea → value & height reset
    sendMessage(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-t-2xl shrink-0">
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <button
              aria-label="對話紀錄"
              className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-lg px-1 -mx-1 py-0.5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20 shrink-0">
                <MantaRayIcon size={24} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm leading-none">Query</p>
                <p className="text-white/70 text-xs mt-0.5 truncate">
                  {activeSession?.title && messages.length > 0
                    ? activeSession.title
                    : 'ERP 智慧助理'}
                </p>
              </div>
              <ChevronDown
                size={14}
                className={`text-white/70 shrink-0 transition-transform ${historyOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-80 p-0 overflow-hidden">
            <SessionHistoryPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={(id) => { switchSession(id); setHistoryOpen(false); }}
              onCreate={() => { createSession(); setHistoryOpen(false); }}
              onDelete={deleteSession}
              onTogglePin={togglePin}
            />
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={clearMessages}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="清除對話"
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50/80">
        {/* Welcome bubble */}
        <AssistantBubble>
          <MarkdownMessage content={WELCOME_MESSAGE} />
        </AssistantBubble>

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} content={msg.content} />
          ) : msg.kind === 'action' && msg.actionId ? (
            <AssistantBubble key={msg.id}>
              <ActionCard actionId={msg.actionId} />
            </AssistantBubble>
          ) : (
            <AssistantBubble key={msg.id}>
              <MarkdownMessage content={msg.content} />
            </AssistantBubble>
          )
        )}

        {isLoading && <ThinkingBubble />}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions (shown when no messages) */}
      {messages.length === 0 && (
        <div className="px-4 pb-3 bg-gray-50/80 flex flex-wrap gap-2 shrink-0">
          {['查詢所有客戶', '庫存低於門檻的產品', '最新的採購單'].map((s) => (
            <button
              key={s}
              onClick={() => { sendMessage(s); }}
              className="text-xs px-3 py-1.5 rounded-full bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors shadow-sm"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-3 bg-white border-t border-gray-100 rounded-b-2xl shrink-0">
        <div className="flex items-end gap-2 bg-gray-100 rounded-xl px-3 py-2">
          <textarea
            key={inputKey}
            ref={inputRef}
            defaultValue=""
            onChange={(e) => {
              setHasInput(e.target.value.trim().length > 0);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 112) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息… (Enter 送出，Shift+Enter 換行)"
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm text-gray-800 placeholder:text-gray-400 outline-none leading-relaxed"
            style={{ height: 'auto', maxHeight: '112px' }}
          />
          <button
            onClick={handleSend}
            disabled={!hasInput || isLoading}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
          >
            {isLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SessionHistoryPanelProps {
  sessions: QuerySession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}

function SessionHistoryPanel({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onTogglePin,
}: SessionHistoryPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-800">對話紀錄</p>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-50 transition-colors"
        >
          <Plus size={13} />
          新對話
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-gray-400">還沒有對話紀錄</p>
      ) : (
        <ScrollArea className="max-h-80">
          <div className="py-1">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => onSelect(session.id)}
                onDelete={() => onDelete(session.id)}
                onTogglePin={() => onTogglePin(session.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function SessionRow({
  session,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  session: QuerySession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
        isActive ? 'bg-indigo-50' : 'hover:bg-gray-50'
      }`}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isActive ? 'text-indigo-700 font-medium' : 'text-gray-700'}`}>
          {session.title}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">{formatSessionTime(session.updatedAt)}</p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 data-[pinned=true]:opacity-100" data-pinned={session.pinned}>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`p-1.5 rounded-md transition-colors ${
            session.pinned ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title={session.pinned ? '取消釘選' : '釘選對話'}
        >
          <Pin size={13} fill={session.pinned ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          title="刪除對話"
        >
          <Trash size={13} />
        </button>
      </div>
    </div>
  );
}

function formatSessionTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }
  const isThisYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    year: isThisYear ? undefined : 'numeric',
  });
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-indigo-600 text-white text-sm leading-relaxed">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 mt-0.5">
        <MantaRayIcon size={16} className="text-white" />
      </div>
      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-white shadow-sm border border-gray-100 text-gray-800">
        {children}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-2.5 items-center">
      <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600">
        <MantaRayIcon size={16} className="text-white" />
      </div>
      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white shadow-sm border border-gray-100">
        <div className="flex gap-1 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
