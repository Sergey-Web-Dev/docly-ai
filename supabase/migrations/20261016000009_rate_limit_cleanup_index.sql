-- Cleanup uses window_start; the primary key (key, window_start) can't serve it.
create index rate_limits_window_start_idx on public.rate_limits (window_start);

-- Windows are capped at 1 hour so the 1-hour cleanup never deletes a live window.
create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_key is null or length(p_key) > 200
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 3600
     or p_max is null or p_max < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 hours';
  end if;

  return v_count <= p_max;
end;
$$;

-- Applied separately via execute_sql: trigger helper is not meant to be callable by clients.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
