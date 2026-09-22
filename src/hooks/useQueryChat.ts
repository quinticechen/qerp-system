import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const QUERY_API_URL = import.meta.env.VITE_QUERY_API_URL ?? 'http://localhost:3100';
const HISTORY_KEY = 'query-chat-history';
const MAX_STORED_MESSAGES = 100;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: Array<Omit<ChatMessage, 'timestamp'> & { timestamp: string }> = JSON.parse(raw);
    return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // Ignore storage quota errors
  }
}

export function useQueryChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('未登入，請重新整理頁面');
      }

      // Build conversation history (exclude the message just added)
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${QUERY_API_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ message: text.trim(), history }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`伺服器錯誤 (${res.status})：${body}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply ?? '已完成。',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      // Keep the user message in history so conversation context is preserved.
      // Add an inline error assistant bubble instead of removing the message.
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ 發生錯誤：${err.message ?? '未知錯誤'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  }, []);

  return { messages, isLoading, sendMessage, clearMessages };
}
