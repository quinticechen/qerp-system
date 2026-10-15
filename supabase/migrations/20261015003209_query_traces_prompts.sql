-- 記錄每次回覆使用的 system prompt 版本（docs/requirements/QUERY_AGENT_EVAL_REDESIGN.md §5.2）：
-- { "<prompt 名稱>": { "label": "production", "version": 3 } | "code" }。
-- 正式環境的 prompt 改由 Langfuse 提供後，回覆要能對回產生它的 prompt。
ALTER TABLE public.query_traces
  ADD COLUMN IF NOT EXISTS prompts jsonb NOT NULL DEFAULT '{}'::jsonb;
