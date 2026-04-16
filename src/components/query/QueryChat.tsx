import React, { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { X, Send, Trash2, Loader2 } from 'lucide-react';
import { MantaRayIcon } from './MantaRayIcon';
import { MarkdownMessage } from './MarkdownMessage';
import { useQueryChat } from '@/hooks/useQueryChat';

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
  const { messages, isLoading, error, sendMessage, clearMessages } = useQueryChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput('');
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
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
          <MantaRayIcon size={24} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm leading-none">Query</p>
          <p className="text-white/70 text-xs mt-0.5">ERP 智慧助理</p>
        </div>
        <div className="flex items-center gap-1">
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
        <AssistantBubble content={WELCOME_MESSAGE} />

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} content={msg.content} />
          ) : (
            <AssistantBubble key={msg.id} content={msg.content} />
          )
        )}

        {isLoading && <ThinkingBubble />}

        {error && (
          <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

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
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息… (Enter 送出，Shift+Enter 換行)"
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm text-gray-800 placeholder:text-gray-400 outline-none max-h-28 leading-relaxed"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
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

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-indigo-600 text-white text-sm leading-relaxed">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 mt-0.5">
        <MantaRayIcon size={16} className="text-white" />
      </div>
      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-white shadow-sm border border-gray-100 text-gray-800">
        <MarkdownMessage content={content} />
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
