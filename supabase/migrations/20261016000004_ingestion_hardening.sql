-- Epic 02 review fixes: narrower grants, reserved-slot uploads, stale processing rows,
-- SQLSTATE error codes, and an atomic "chunks + ready" completion.

-- M4: clients may only set name/welcome on insert and update; is_published is granted in Epic 04.
revoke insert, update on public.chatbots from authenticated;
grant insert (owner_id, name, welcome_message) on public.chatbots to authenticated;
grant update (name, welcome_message) on public.chatbots to authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger chatbots_set_updated_at
  before update on public.chatbots
  for each row execute function public.set_updated_at();

-- M1: uploads are allowed only into a slot reserved by create_document.
-- (applied as ALTER POLICY so the original policy name is kept)
alter policy "documents bucket: owner uploads to own folder" on storage.objects
  with check (
    bucket_id = 'documents'
    and (storage.foldername(objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.documents d
      join public.chatbots c on c.id = d.chatbot_id
      where d.storage_path = objects.name
        and d.status = 'processing'
        and d.ingest_started_at is null
        and c.owner_id = (select auth.uid())
    )
  );

-- H1b, L1, L2: validated limit, stale rows released, SQLSTATE codes.
-- DQ001 = quota exceeded, DQ002 = duplicate file name, DQ003 = document not processing.
create or replace function public.create_document(p_chatbot_id uuid, p_file_name text, p_size_bytes integer, p_max_documents integer)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
  v_id uuid := gen_random_uuid();
  v_row public.documents;
begin
  if p_max_documents is null or p_max_documents < 0 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  select owner_id into v_owner from public.chatbots where id = p_chatbot_id for update;
  if v_owner is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.documents
     set status = 'failed',
         error_message = 'Processing timed out. Please delete the file and upload it again.'
   where chatbot_id = p_chatbot_id
     and status = 'processing'
     and coalesce(ingest_started_at, created_at) < now() - interval '10 minutes';

  select count(*) into v_count from public.documents where chatbot_id = p_chatbot_id;
  if v_count >= p_max_documents then
    raise exception 'QUOTA_EXCEEDED' using errcode = 'DQ001';
  end if;

  begin
    insert into public.documents (id, chatbot_id, file_name, storage_path, size_bytes)
    values (v_id, p_chatbot_id, p_file_name, v_owner::text || '/' || v_id::text, p_size_bytes)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'DUPLICATE' using errcode = 'DQ002';
  end;

  return v_row;
end;
$$;

-- H2: chunks and the ready status are written in one transaction.
-- p_chunks: [{ "chunk_index": 0, "content": "...", "embedding": "[0.1, ...]" }, ...]
create function public.complete_document(p_document_id uuid, p_size_bytes integer, p_chunks jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chatbot uuid;
begin
  select chatbot_id into v_chatbot
    from public.documents
   where id = p_document_id and status = 'processing'
   for update;
  if v_chatbot is null then
    raise exception 'NOT_PROCESSING' using errcode = 'DQ003';
  end if;

  insert into public.document_chunks (document_id, chatbot_id, chunk_index, content, embedding)
  select p_document_id,
         v_chatbot,
         (chunk ->> 'chunk_index')::integer,
         chunk ->> 'content',
         (chunk ->> 'embedding')::extensions.vector(768)
    from jsonb_array_elements(p_chunks) as chunk;

  update public.documents
     set status = 'ready', error_message = null, size_bytes = p_size_bytes
   where id = p_document_id;
end;
$$;

revoke execute on function public.complete_document(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.complete_document(uuid, integer, jsonb) to service_role;
