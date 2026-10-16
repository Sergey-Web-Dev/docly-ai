create table public.usage_counters (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,
  message_count integer not null default 0 check (message_count >= 0),
  primary key (owner_id, month)
);

alter table public.usage_counters enable row level security;
grant select on public.usage_counters to authenticated;
create policy "usage_counters: owner reads own" on public.usage_counters for select to authenticated
  using ((select auth.uid()) = owner_id);

-- Atomically takes one message from this month's quota. Returns false when the limit is reached.
create function public.reserve_message(p_owner_id uuid, p_limit integer)
returns boolean
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

  return v_reserved is not null;
end;
$$;

-- Gives back a reservation when nothing was generated (no evidence or provider error).
create function public.refund_message(p_owner_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_counters
     set message_count = message_count - 1
   where owner_id = p_owner_id
     and month = date_trunc('month', now() at time zone 'utc')::date
     and message_count > 0;
$$;

-- Exact cosine search over one bot's READY chunks (bypasses HNSW on purpose: tenant post-filtering loses results).
create function public.match_chunks(p_chatbot_id uuid, p_embedding extensions.vector(768), p_match_count integer, p_min_similarity double precision)
returns table (id bigint, document_id uuid, content text, similarity double precision)
language sql
stable
security definer
set search_path = ''
as $$
  with bot_chunks as materialized (
    select c.id, c.document_id, c.content, c.embedding
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
     where c.chatbot_id = p_chatbot_id
       and d.status = 'ready'
  )
  select b.id, b.document_id, b.content, 1 - (b.embedding operator(extensions.<=>) p_embedding) as similarity
    from bot_chunks b
   where 1 - (b.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
   order by b.embedding operator(extensions.<=>) p_embedding
   limit least(greatest(p_match_count, 1), 20);
$$;

grant execute on function public.reserve_message(uuid, integer) to service_role;
grant execute on function public.refund_message(uuid) to service_role;
grant execute on function public.match_chunks(uuid, extensions.vector, integer, double precision) to service_role;

-- Applied separately via execute_sql (Supabase MCP declines revoke inside apply_migration).
revoke execute on function public.reserve_message(uuid, integer), public.refund_message(uuid), public.match_chunks(uuid, extensions.vector, integer, double precision) from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.usage_counters from anon, authenticated;
revoke select on public.usage_counters from anon;
