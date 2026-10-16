-- Query 回覆讚／倒讚的測試（migration 20261016060000_query_message_feedback.sql）。先載入 _helpers.sql 再執行本檔。

-- The owner can rate, change and clear the rating of an assistant reply; only metadata.feedback changes
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_session uuid;
  v_reply uuid;
  v_result jsonb;
  v_row public.query_messages;
begin
  insert into public.query_sessions (user_id, organization_id) values (v_user, (fx->>'org_id')::uuid) returning id into v_session;
  insert into public.query_messages (session_id, role, content, metadata)
  values (v_session, 'assistant', '回覆', '{"trace_id": "t1"}') returning id into v_reply;

  v_result := pg_temp.call_as(v_user, format('select public.set_query_message_feedback(%L, %L)', v_reply, 'down'));
  perform pg_temp.check(v_result->'feedback'->>'value' = 'down', 'thumbs down is stored, got ' || v_result);
  perform pg_temp.check(v_result->>'trace_id' = 't1', 'the rest of metadata is kept');

  v_result := pg_temp.call_as(v_user, format('select public.set_query_message_feedback(%L, %L)', v_reply, 'up'));
  perform pg_temp.check(v_result->'feedback'->>'value' = 'up', 'the rating can change');

  v_result := pg_temp.call_as(v_user, format('select public.set_query_message_feedback(%L, null)', v_reply));
  perform pg_temp.check(not (v_result ? 'feedback'), 'null clears the rating');

  select * into v_row from public.query_messages where id = v_reply;
  perform pg_temp.check(v_row.content = '回覆', 'the content is unchanged');
end $$;

-- Nobody else can rate it, a user message cannot be rated, and only up/down are accepted
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_session uuid;
  v_reply uuid;
  v_question uuid;
begin
  insert into public.query_sessions (user_id, organization_id) values (v_user, (fx->>'org_id')::uuid) returning id into v_session;
  insert into public.query_messages (session_id, role, content) values (v_session, 'assistant', '回覆') returning id into v_reply;
  insert into public.query_messages (session_id, role, content) values (v_session, 'user', '問題') returning id into v_question;

  perform pg_temp.check_raises_as((other->>'user_id')::uuid,
    format('select public.set_query_message_feedback(%L, %L)', v_reply, 'up'), '找不到這則回覆', 'another user cannot rate the reply');
  perform pg_temp.check_raises_as(v_user,
    format('select public.set_query_message_feedback(%L, %L)', v_question, 'up'), '找不到這則回覆', 'a user message cannot be rated');
  perform pg_temp.check_raises_as(v_user,
    format('select public.set_query_message_feedback(%L, %L)', v_reply, 'meh'), '回饋只能是讚或倒讚', 'only up or down');

  -- No UPDATE policy: a direct update changes nothing.
  perform pg_temp.act_as(v_user);
  update public.query_messages set content = '改' where id = v_reply;
  execute 'reset role';
  perform pg_temp.check((select content from public.query_messages where id = v_reply) = '回覆', 'messages still cannot be updated directly');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
