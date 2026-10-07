import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useCurrentOrganization } from './useCurrentOrganization';

const QUERY_API_URL = import.meta.env.VITE_QUERY_API_URL ?? 'http://localhost:3100';
// Purely a per-browser convenience (which session to reopen) — the actual
// conversation data lives in Supabase (query_sessions / query_messages), not here.
const ACTIVE_SESSION_KEY = 'query-chat-active-session-id';
const TITLE_MAX_LENGTH = 24;
const TITLE_PLACEHOLDER = '新對話';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface QuerySessionRow {
  id: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuerySession {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed;
}

function loadStoredActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function saveActiveSessionId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
    else localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // Ignore storage errors — it's only a convenience pointer
  }
}

export function useQueryChat() {
  const { user } = useAuth();
  const { organizationId } = useCurrentOrganization();
  const queryClient = useQueryClient();

  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    loadStoredActiveSessionId
  );
  const [isLoading, setIsLoading] = useState(false);

  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
    saveActiveSessionId(id);
  }, []);

  const { data: rawSessions = [], isSuccess: sessionsLoaded } = useQuery({
    queryKey: ['query-sessions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('query_sessions')
        .select('id, title, pinned, created_at, updated_at')
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const sessions: QuerySession[] = useMemo(
    () =>
      rawSessions.map((s) => ({
        id: s.id,
        title: s.title,
        pinned: s.pinned,
        createdAt: new Date(s.created_at),
        updatedAt: new Date(s.updated_at),
      })),
    [rawSessions]
  );

  // Auto-pick a session when none is active yet, or the remembered one isn't in this user's
  // list (deleted from another device, or left in localStorage by another account on this
  // browser). Wait for the list to load so the remembered choice isn't discarded early.
  useEffect(() => {
    if (!sessionsLoaded) return;
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return;
    const fallbackId = sessions[0]?.id ?? null;
    if (fallbackId !== activeSessionId) setActiveSessionId(fallbackId);
  }, [sessionsLoaded, sessions, activeSessionId, setActiveSessionId]);

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['query-messages', activeSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('query_messages')
        .select('id, role, content, created_at')
        .eq('session_id', activeSessionId as string)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!activeSessionId,
  });

  const messages: ChatMessage[] = useMemo(
    () =>
      rawMessages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
      })),
    [rawMessages]
  );

  const invalidateSessions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['query-sessions', user?.id] });
  }, [queryClient, user?.id]);

  const invalidateMessages = useCallback(
    (sessionId: string) => {
      queryClient.invalidateQueries({ queryKey: ['query-messages', sessionId] });
    },
    [queryClient]
  );

  const createSession = useCallback(async () => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('query_sessions')
      .insert({ user_id: user.id, organization_id: organizationId ?? null })
      .select('id, title, pinned, created_at, updated_at')
      .single();
    if (error) {
      console.error('Error creating query session:', error);
      return null;
    }
    // Add the new session to the cache before activating it — otherwise the auto-pick
    // effect sees an id missing from the stale list and switches back to sessions[0].
    queryClient.setQueryData<QuerySessionRow[]>(['query-sessions', user.id], (old = []) => {
      const pinnedCount = old.filter((s) => s.pinned).length;
      return [...old.slice(0, pinnedCount), data, ...old.slice(pinnedCount)];
    });
    invalidateSessions();
    setActiveSessionId(data.id);
    return data.id as string;
  }, [user, organizationId, queryClient, invalidateSessions, setActiveSessionId]);

  const switchSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
    },
    [setActiveSessionId]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('query_sessions').delete().eq('id', id);
      if (error) {
        console.error('Error deleting query session:', error);
        return;
      }
      // Drop it from the cache first so the auto-pick effect can't re-select the deleted session.
      queryClient.setQueryData<QuerySessionRow[]>(['query-sessions', user?.id], (old = []) =>
        old.filter((s) => s.id !== id)
      );
      invalidateSessions();
      if (activeSessionId === id) {
        // Let the auto-pick effect choose the next best session once the list refreshes.
        setActiveSessionId(null);
      }
    },
    [activeSessionId, user?.id, queryClient, invalidateSessions, setActiveSessionId]
  );

  const togglePin = useCallback(
    async (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      const { error } = await supabase
        .from('query_sessions')
        .update({ pinned: !session.pinned })
        .eq('id', id);
      if (error) {
        console.error('Error toggling pin:', error);
        return;
      }
      invalidateSessions();
    },
    [sessions, invalidateSessions]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading || !user) return;
      if (!organizationId) {
        toast.error('請先選擇組織');
        return;
      }

      // Never write into a session that isn't in this user's list — RLS would reject it.
      let sessionId =
        activeSessionId && sessions.some((s) => s.id === activeSessionId) ? activeSessionId : null;
      if (!sessionId) {
        sessionId = await createSession();
        if (!sessionId) {
          toast.error('無法建立對話，請稍後再試');
          return;
        }
      }

      // Only overwrite the placeholder title — a no-op once the session already has one.
      await supabase
        .from('query_sessions')
        .update({ title: deriveTitle(trimmed) })
        .eq('id', sessionId)
        .eq('title', TITLE_PLACEHOLDER);

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const { error: userMsgError } = await supabase
        .from('query_messages')
        .insert({ session_id: sessionId, role: 'user', content: trimmed });
      if (userMsgError) {
        console.error('Error saving user message:', userMsgError);
        toast.error('訊息傳送失敗，請稍後再試');
        return;
      }
      invalidateMessages(sessionId);
      invalidateSessions();

      setIsLoading(true);
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession?.access_token) {
          throw new Error('未登入，請重新整理頁面');
        }

        const res = await fetch(`${QUERY_API_URL}/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authSession.access_token}`,
          },
          body: JSON.stringify({ message: trimmed, history, organization_id: organizationId }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`伺服器錯誤 (${res.status})：${body}`);
        }

        const data = await res.json();
        await supabase
          .from('query_messages')
          .insert({ session_id: sessionId, role: 'assistant', content: data.reply ?? '已完成。' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        await supabase
          .from('query_messages')
          .insert({ session_id: sessionId, role: 'assistant', content: `⚠️ 發生錯誤：${message}` });
      } finally {
        setIsLoading(false);
        invalidateMessages(sessionId);
        invalidateSessions();
      }
    },
    [activeSessionId, sessions, isLoading, user, organizationId, messages, createSession, invalidateMessages, invalidateSessions]
  );

  const clearMessages = useCallback(async () => {
    if (!activeSessionId) return;
    const { error } = await supabase
      .from('query_messages')
      .delete()
      .eq('session_id', activeSessionId);
    if (error) {
      console.error('Error clearing messages:', error);
      return;
    }
    await supabase
      .from('query_sessions')
      .update({ title: TITLE_PLACEHOLDER })
      .eq('id', activeSessionId);
    invalidateMessages(activeSessionId);
    invalidateSessions();
  }, [activeSessionId, invalidateMessages, invalidateSessions]);

  return {
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
  };
}
