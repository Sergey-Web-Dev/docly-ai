import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

const DOCUMENTS_BUCKET = 'documents';

describe('chatbots, documents, storage RLS and create_document', () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceBotId: string;
  const uploadedPaths: string[] = [];

  beforeAll(async () => {
    alice = await createTestUser('alice-docs');
    bob = await createTestUser('bob-docs');
  });

  afterAll(async () => {
    const admin = adminClient();
    if (uploadedPaths.length > 0) await admin.storage.from(DOCUMENTS_BUCKET).remove(uploadedPaths);
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it('should let an owner create one bot and reject a second one', async () => {
    const first = await alice.client.from('chatbots').insert({ owner_id: alice.id, name: 'Alice Bot', welcome_message: 'Hi' }).select('id').single();
    expect(first.error).toBeNull();
    aliceBotId = first.data?.id ?? '';

    const second = await alice.client.from('chatbots').insert({ owner_id: alice.id, name: 'Second', welcome_message: 'Hi' });
    expect(second.error?.code).toBe('23505');
  });

  it('should reject inserting a bot for another owner', async () => {
    const { error } = await alice.client.from('chatbots').insert({ owner_id: bob.id, name: 'Fake', welcome_message: 'Hi' });
    expect(error).not.toBeNull();
  });

  it('should hide the bot and its documents from another owner', async () => {
    await adminClient().rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'visible.txt', p_size_bytes: 10, p_max_documents: 5 });

    const bots = await bob.client.from('chatbots').select('id').eq('id', aliceBotId);
    const docs = await bob.client.from('documents').select('id').eq('chatbot_id', aliceBotId);
    expect(bots.data).toEqual([]);
    expect(docs.data).toEqual([]);

    await bob.client.from('chatbots').update({ name: 'Hacked' }).eq('id', aliceBotId);
    const { data } = await adminClient().from('chatbots').select('name').eq('id', aliceBotId).single();
    expect(data?.name).toBe('Alice Bot');
  });

  it('should deny create_document when called from a user client', async () => {
    const { error } = await alice.client.rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'x.txt', p_size_bytes: 10, p_max_documents: 99 });
    expect(error).not.toBeNull();
  });

  it('should enforce quota and duplicate names and build the storage path when called by the server', async () => {
    const admin = adminClient();
    await admin.from('documents').delete().eq('chatbot_id', aliceBotId);

    const first = await admin.rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'a.txt', p_size_bytes: 10, p_max_documents: 2 });
    const second = await admin.rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'b.txt', p_size_bytes: 10, p_max_documents: 2 });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.storage_path).toBe(`${alice.id}/${first.data?.id}`);

    const third = await admin.rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'c.txt', p_size_bytes: 10, p_max_documents: 2 });
    expect(third.error?.message).toContain('QUOTA_EXCEEDED');

    await admin.from('documents').delete().eq('id', second.data?.id ?? '');
    const duplicate = await admin.rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'a.txt', p_size_bytes: 10, p_max_documents: 2 });
    expect(duplicate.error?.message).toContain('DUPLICATE');
  });

  it('should deny any client access to document chunks', async () => {
    const select = await alice.client.from('document_chunks').select('id');
    expect(select.error !== null || select.data?.length === 0).toBe(true);

    const { data: doc } = await adminClient().from('documents').select('id').eq('chatbot_id', aliceBotId).limit(1).single();
    const insert = await alice.client.from('document_chunks').insert({
      document_id: doc?.id ?? '', chatbot_id: aliceBotId, chunk_index: 0, content: 'x', embedding: JSON.stringify(Array(768).fill(0.01)),
    });
    expect(insert.error).not.toBeNull();
  });

  it('should restrict storage objects to the owner folder', async () => {
    const body = new Blob(['hello'], { type: 'text/plain' });
    const own = await alice.client.storage.from(DOCUMENTS_BUCKET).upload(`${alice.id}/x.txt`, body, { contentType: 'text/plain' });
    if (!own.error) uploadedPaths.push(`${alice.id}/x.txt`);
    expect(own.error).toBeNull();

    const foreign = await alice.client.storage.from(DOCUMENTS_BUCKET).upload(`${bob.id}/x.txt`, body, { contentType: 'text/plain' });
    if (!foreign.error) uploadedPaths.push(`${bob.id}/x.txt`);
    expect(foreign.error).not.toBeNull();

    const download = await bob.client.storage.from(DOCUMENTS_BUCKET).download(`${alice.id}/x.txt`);
    expect(download.error).not.toBeNull();
  });

  it('should cascade chunk deletion when the owner deletes a document', async () => {
    const admin = adminClient();
    const { data: doc } = await admin.from('documents').select('id').eq('chatbot_id', aliceBotId).limit(1).single();
    const documentId = doc?.id ?? '';
    const insert = await admin.from('document_chunks').insert({
      document_id: documentId, chatbot_id: aliceBotId, chunk_index: 0, content: 'chunk', embedding: JSON.stringify(Array(768).fill(0.01)),
    });
    expect(insert.error).toBeNull();

    const { error } = await alice.client.from('documents').delete().eq('id', documentId);
    expect(error).toBeNull();

    const { count } = await admin.from('document_chunks').select('id', { count: 'exact', head: true }).eq('document_id', documentId);
    expect(count).toBe(0);
  });
});
