-- Query 訊息：種類與附加資料（docs/QUERY_AGENT_PHASE0.md §4.4，P0-4；D8 已同意建立）
--
-- kind：text（一般訊息）／action（P0-5 的確認卡片）
-- metadata：mcp-server 寫入 assistant 回覆時記錄 trace_id 與 entities
--   entities：[{ type, id, label }]，本輪工具查到的特定紀錄，下一輪提供給模型，不需重新查詢

ALTER TABLE public.query_messages
  ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'action')),
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 後端依對話讀取最近的訊息
CREATE INDEX IF NOT EXISTS query_messages_session_created_idx ON public.query_messages (session_id, created_at);
