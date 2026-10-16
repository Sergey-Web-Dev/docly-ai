create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
-- no client access at all

-- Fixed-window limiter. Returns true when the call is allowed.
create function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  if p_key is null or length(p_key) > 200 or p_window_seconds is null or p_window_seconds < 1 or p_max is null or p_max < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 hour';
  end if;

  return v_count <= p_max;
end;
$$;

grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- Owners may publish/unpublish their own bot (RLS "chatbots: owner updates" already scopes rows).
grant update (is_published) on public.chatbots to authenticated;

-- Applied separately via execute_sql (Supabase MCP declines revoke inside apply_migration).
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;
