-- Epic 03 review fixes.
-- M2: reserve_message returns the reserved month; refund_message takes that month (no wrong-month refunds at midnight UTC).
-- L1: match_chunks runs as SECURITY INVOKER (service_role bypasses RLS; an accidental EXECUTE grant still can't read chunks).
-- L2: the cosine distance is computed once per row.
-- L3: usage_counters.month must be the first day of a month.

drop function public.reserve_message(uuid, integer);
drop function public.refund_message(uuid);

create function public.reserve_message(p_owner_id uuid, p_limit integer)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_reserved integer;
begin
  if p_limit is null or p_limit < 0 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  insert into public.usage_counters (owner_id, month, message_count)
  values (p_owner_id, v_month, 0)
  on conflict (owner_id, month) do nothing;

  update public.usage_counters
     set message_count = message_count + 1
   where owner_id = p_owner_id and month = v_month and message_count < p_limit
  returning message_count into v_reserved;

  return case when v_reserved is null then null else v_month end;
end;
$$;

create function public.refund_message(p_owner_id uuid, p_month date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_counters
     set message_count = message_count - 1
   where owner_id = p_owner_id
     and month = p_month
     and message_count > 0;
$$;

create or replace function public.match_chunks(p_chatbot_id uuid, p_embedding extensions.vector(768), p_match_count integer, p_min_similarity double precision)
returns table (id bigint, document_id uuid, content text, similarity double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with bot_chunks as materialized (
    select c.id, c.document_id, c.content, 1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
     where c.chatbot_id = p_chatbot_id
       and d.status = 'ready'
  )
  select b.id, b.document_id, b.content, b.similarity
    from bot_chunks b
   where b.similarity >= p_min_similarity
   order by b.similarity desc
   limit least(greatest(coalesce(p_match_count, 1), 1), 20);
$$;

alter table public.usage_counters
  add constraint usage_counters_month_is_first_day check (month = date_trunc('month', month)::date);

revoke execute on function public.reserve_message(uuid, integer), public.refund_message(uuid, date) from public, anon, authenticated;
grant execute on function public.reserve_message(uuid, integer) to service_role;
grant execute on function public.refund_message(uuid, date) to service_role;
