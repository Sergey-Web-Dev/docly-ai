-- Chatbots: one per owner
create table public.chatbots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name varchar(60) not null check (length(btrim(name)) > 0),
  welcome_message varchar(300) not null check (length(btrim(welcome_message)) > 0),
  accent_color text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null,
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error_message text,
  ingest_started_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chatbot_id, file_name)
);
create index documents_chatbot_id_idx on public.documents (chatbot_id);

create table public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  chatbot_id uuid not null references public.chatbots (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(768) not null
);
create index document_chunks_chatbot_id_idx on public.document_chunks (chatbot_id);
create index document_chunks_document_id_idx on public.document_chunks (document_id);
create index document_chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- RLS
alter table public.chatbots enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

revoke all on public.chatbots, public.documents, public.document_chunks from anon, authenticated;
grant select, insert on public.chatbots to authenticated;
grant update (name, welcome_message, is_published, updated_at) on public.chatbots to authenticated;
grant select, delete on public.documents to authenticated;
-- document_chunks: no client access at all (server uses the secret key)

create policy "chatbots: owner reads" on public.chatbots for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "chatbots: owner inserts own" on public.chatbots for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "chatbots: owner updates" on public.chatbots for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "documents: owner reads" on public.documents for select to authenticated
  using (exists (select 1 from public.chatbots c where c.id = chatbot_id and c.owner_id = (select auth.uid())));
create policy "documents: owner deletes" on public.documents for delete to authenticated
  using (exists (select 1 from public.chatbots c where c.id = chatbot_id and c.owner_id = (select auth.uid())));

-- Atomic quota + duplicate check. Service role only; limit comes from src/lib/plans.ts.
create function public.create_document(p_chatbot_id uuid, p_file_name text, p_size_bytes integer, p_max_documents integer)
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
  select owner_id into v_owner from public.chatbots where id = p_chatbot_id for update;
  if v_owner is null then
    raise exception 'NOT_FOUND';
  end if;

  select count(*) into v_count from public.documents where chatbot_id = p_chatbot_id;
  if v_count >= p_max_documents then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  begin
    insert into public.documents (id, chatbot_id, file_name, storage_path, size_bytes)
    values (v_id, p_chatbot_id, p_file_name, v_owner::text || '/' || v_id::text, p_size_bytes)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'DUPLICATE';
  end;

  return v_row;
end;
$$;

revoke execute on function public.create_document(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.create_document(uuid, text, integer, integer) to service_role;

-- Storage: private bucket, owner-only folder {owner_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880, array['application/pdf', 'text/plain']);

create policy "documents bucket: owner reads own folder" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "documents bucket: owner uploads to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "documents bucket: owner deletes own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
