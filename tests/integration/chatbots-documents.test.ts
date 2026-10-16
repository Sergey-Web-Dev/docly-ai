import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

const DOCUMENTS_BUCKET = 'documents';
const QUOTA_EXCEEDED = 'DQ001';
const DUPLICATE = 'DQ002';
const NOT_PROCESSING = 'DQ003';
const NOT_FOUND = 'P0002';
const INVALID_LIMIT = '22023';
const INSUFFICIENT_PRIVILEGE = '42501';
const VECTOR = JSON.stringify(Array<number>(768).fill(0.01));

describe('chatbots, documents, storage RLS and create_document', () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceBotId: string;
  let uploadedPaths: string[] = [];

  async function reserve(fileName: string, maxDocuments = 10) {
    return adminClient().rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: fileName, p_size_bytes: 10, p_max_documents: maxDocuments });
  }

  async function reserveOk(fileName: string): Promise<{ id: string; storage_path: string }> {
    const { data, error } = await reserve(fileName);
    expect(error).toBeNull();
    if (!data) throw new Error('create_document returned no row');
    return data;
  }

  beforeAll(async () => {
    alice = await createTestUser('alice-docs');
    bob = await createTestUser('bob-docs');
    const bot = await alice.client.from('chatbots').insert({ owner_id: alice.id, name: 'Alice Bot', welcome_message: 'Hi' }).select('id').single();
    expect(bot.error).toBeNull();
    aliceBotId = bot.data?.id ?? '';
  });

  afterEach(async () => {
    const admin = adminClient();
    if (uploadedPaths.length > 0) await admin.storage.from(DOCUMENTS_BUCKET).remove(uploadedPaths);
    uploadedPaths = [];
    await admin.from('documents').delete().eq('chatbot_id', aliceBotId);
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  describe('chatbots', () => {
    it('should reject a second bot for the same owner', async () => {
      const second = await alice.client.from('chatbots').insert({ owner_id: alice.id, name: 'Second', welcome_message: 'Hi' });
      expect(second.error?.code).toBe('23505');
    });

    it('should reject inserting a bot for another owner', async () => {
      const { error } = await bob.client.from('chatbots').insert({ owner_id: alice.id, name: 'Fake', welcome_message: 'Hi' });
      expect(error).not.toBeNull();
    });

    it('should hide the bot from another owner and ignore their update', async () => {
      const bots = await bob.client.from('chatbots').select('id').eq('id', aliceBotId);
      expect(bots.data).toEqual([]);

      const update = await bob.client.from('chatbots').update({ name: 'Hacked' }).eq('id', aliceBotId).select('id');
      expect(update.error).toBeNull();
      expect(update.data).toEqual([]);
      const { data } = await adminClient().from('chatbots').select('name').eq('id', aliceBotId).single();
      expect(data?.name).toBe('Alice Bot');
    });

    it('should let the owner update name and welcome message and bump updated_at by trigger', async () => {
      const before = await adminClient().from('chatbots').select('updated_at').eq('id', aliceBotId).single();
      const { data, error } = await alice.client.from('chatbots').update({ welcome_message: 'Hello again' }).eq('id', aliceBotId).select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const after = await adminClient().from('chatbots').select('updated_at, welcome_message').eq('id', aliceBotId).single();
      expect(after.data?.welcome_message).toBe('Hello again');
      expect(new Date(after.data?.updated_at ?? 0).getTime()).toBeGreaterThan(new Date(before.data?.updated_at ?? 0).getTime());
      await alice.client.from('chatbots').update({ welcome_message: 'Hi' }).eq('id', aliceBotId);
    });

    it('should not let the owner set is_published or updated_at on update', async () => {
      const publish = await alice.client.from('chatbots').update({ is_published: true }).eq('id', aliceBotId);
      expect(publish.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      const touch = await alice.client.from('chatbots').update({ updated_at: new Date().toISOString() }).eq('id', aliceBotId);
      expect(touch.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('should not let the owner set is_published on insert', async () => {
      const { error } = await alice.client.from('chatbots').insert({ owner_id: alice.id, name: 'Pub', welcome_message: 'Hi', is_published: true });
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('documents and create_document', () => {
    it('should hide documents from another owner', async () => {
      await reserveOk('visible.txt');
      const docs = await bob.client.from('documents').select('id').eq('chatbot_id', aliceBotId);
      expect(docs.data).toEqual([]);
    });

    it('should deny create_document when called from a user client', async () => {
      const { error } = await alice.client.rpc('create_document', { p_chatbot_id: aliceBotId, p_file_name: 'x.txt', p_size_bytes: 10, p_max_documents: 99 });
      expect(error).not.toBeNull();
    });

    it('should not let any user insert into documents', async () => {
      const row = { chatbot_id: aliceBotId, file_name: 'direct.txt', storage_path: `${alice.id}/direct`, size_bytes: 1 };
      expect((await alice.client.from('documents').insert(row)).error).not.toBeNull();
      expect((await bob.client.from('documents').insert(row)).error).not.toBeNull();
    });

    it('should build the storage path and raise DQ001 for quota and DQ002 for duplicates', async () => {
      const first = await reserve('a.txt', 2);
      const second = await reserve('b.txt', 2);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect(first.data?.storage_path).toBe(`${alice.id}/${first.data?.id}`);

      const third = await reserve('c.txt', 2);
      expect(third.error?.code).toBe(QUOTA_EXCEEDED);

      await adminClient().from('documents').delete().eq('id', second.data?.id ?? '');
      const duplicate = await reserve('a.txt', 2);
      expect(duplicate.error?.code).toBe(DUPLICATE);
    });

    it('should raise P0002 for an unknown bot and 22023 for an invalid limit', async () => {
      const unknown = await adminClient().rpc('create_document', {
        p_chatbot_id: crypto.randomUUID(), p_file_name: 'a.txt', p_size_bytes: 10, p_max_documents: 5,
      });
      expect(unknown.error?.code).toBe(NOT_FOUND);
      expect((await reserve('neg.txt', -1)).error?.code).toBe(INVALID_LIMIT);
    });

    it('should let exactly 2 of 3 concurrent create_document calls succeed with limit 2', async () => {
      const results = await Promise.all(['c1.txt', 'c2.txt', 'c3.txt'].map((name) => reserve(name, 2)));
      const succeeded = results.filter((r) => r.error === null);
      const failed = results.filter((r) => r.error !== null);
      expect(succeeded).toHaveLength(2);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.error?.code).toBe(QUOTA_EXCEEDED);
      const { count } = await adminClient().from('documents').select('id', { count: 'exact', head: true }).eq('chatbot_id', aliceBotId);
      expect(count).toBe(2);
    });

    it('should mark a processing row older than 10 minutes as failed when create_document runs', async () => {
      const stale = await reserveOk('stale.txt');
      const fresh = await reserveOk('fresh.txt');
      const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      const update = await adminClient().from('documents').update({ created_at: old }).eq('id', stale.id);
      expect(update.error).toBeNull();

      await reserveOk('trigger.txt');

      const rows = await adminClient().from('documents').select('id, status, error_message').in('id', [stale.id, fresh.id]);
      const byId = new Map(rows.data?.map((r) => [r.id, r]));
      expect(byId.get(stale.id)?.status).toBe('failed');
      expect(byId.get(stale.id)?.error_message).toContain('timed out');
      expect(byId.get(fresh.id)?.status).toBe('processing');
    });

    it('should not let another owner delete a document', async () => {
      const doc = await reserveOk('keep.txt');
      const { data, error } = await bob.client.from('documents').delete().eq('id', doc.id).select('id');
      expect(error).toBeNull();
      expect(data).toEqual([]);
      const { count } = await adminClient().from('documents').select('id', { count: 'exact', head: true }).eq('id', doc.id);
      expect(count).toBe(1);
    });
  });

  describe('document chunks and complete_document', () => {
    it('should deny any client access to document chunks', async () => {
      const doc = await reserveOk('chunks.txt');
      const select = await alice.client.from('document_chunks').select('id');
      expect(select.error !== null || select.data?.length === 0).toBe(true);
      const insert = await alice.client.from('document_chunks').insert({
        document_id: doc.id, chatbot_id: aliceBotId, chunk_index: 0, content: 'x', embedding: VECTOR,
      });
      expect(insert.error).not.toBeNull();
    });

    it('should not be callable by an authenticated user', async () => {
      const doc = await reserveOk('rpc.txt');
      const { error } = await alice.client.rpc('complete_document', { p_document_id: doc.id, p_size_bytes: 1, p_chunks: [] });
      expect(error).not.toBeNull();
      const { data } = await adminClient().from('documents').select('status').eq('id', doc.id).single();
      expect(data?.status).toBe('processing');
    });

    it('should insert chunks and set ready in one call, then raise DQ003 on a second call', async () => {
      const doc = await reserveOk('done.txt');
      const chunks = [0, 1].map((i) => ({ chunk_index: i, content: `chunk ${i}`, embedding: VECTOR }));
      const done = await adminClient().rpc('complete_document', { p_document_id: doc.id, p_size_bytes: 42, p_chunks: chunks });
      expect(done.error).toBeNull();

      const row = await adminClient().from('documents').select('status, size_bytes').eq('id', doc.id).single();
      expect(row.data).toEqual({ status: 'ready', size_bytes: 42 });
      const { count } = await adminClient().from('document_chunks').select('id', { count: 'exact', head: true }).eq('document_id', doc.id);
      expect(count).toBe(2);

      const again = await adminClient().rpc('complete_document', { p_document_id: doc.id, p_size_bytes: 42, p_chunks: chunks });
      expect(again.error?.code).toBe(NOT_PROCESSING);
    });

    it('should leave the document processing and insert no chunks when a chunk is invalid', async () => {
      const doc = await reserveOk('atomic.txt');
      const chunks = [{ chunk_index: 0, content: 'ok', embedding: VECTOR }, { chunk_index: 1, content: 'bad', embedding: '[1,2]' }];
      const { error } = await adminClient().rpc('complete_document', { p_document_id: doc.id, p_size_bytes: 1, p_chunks: chunks });
      expect(error).not.toBeNull();
      const { count } = await adminClient().from('document_chunks').select('id', { count: 'exact', head: true }).eq('document_id', doc.id);
      expect(count).toBe(0);
      const row = await adminClient().from('documents').select('status').eq('id', doc.id).single();
      expect(row.data?.status).toBe('processing');
    });

    it('should cascade chunk deletion when the owner deletes a document', async () => {
      const doc = await reserveOk('cascade.txt');
      const admin = adminClient();
      const insert = await admin.from('document_chunks').insert({ document_id: doc.id, chatbot_id: aliceBotId, chunk_index: 0, content: 'chunk', embedding: VECTOR });
      expect(insert.error).toBeNull();

      const { data, error } = await alice.client.from('documents').delete().eq('id', doc.id).select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { count } = await admin.from('document_chunks').select('id', { count: 'exact', head: true }).eq('document_id', doc.id);
      expect(count).toBe(0);
    });
  });

  describe('storage', () => {
    const body = () => new Blob(['hello'], { type: 'text/plain' });

    it('should reject an upload to an unreserved path in the owner folder', async () => {
      const path = `${alice.id}/${crypto.randomUUID()}`;
      const { error } = await alice.client.storage.from(DOCUMENTS_BUCKET).upload(path, body(), { contentType: 'text/plain' });
      if (!error) uploadedPaths.push(path);
      expect(error).not.toBeNull();
    });

    it('should allow an upload to a reserved processing slot and reject one in another folder', async () => {
      const doc = await reserveOk('slot.txt');
      const own = await alice.client.storage.from(DOCUMENTS_BUCKET).upload(doc.storage_path, body(), { contentType: 'text/plain' });
      if (!own.error) uploadedPaths.push(doc.storage_path);
      expect(own.error).toBeNull();

      const foreign = `${bob.id}/${doc.id}`;
      const other = await alice.client.storage.from(DOCUMENTS_BUCKET).upload(foreign, body(), { contentType: 'text/plain' });
      if (!other.error) uploadedPaths.push(foreign);
      expect(other.error).not.toBeNull();
    });

    it('should reject an upload once the slot has been claimed for ingestion', async () => {
      const doc = await reserveOk('claimed.txt');
      await adminClient().from('documents').update({ ingest_started_at: new Date().toISOString() }).eq('id', doc.id);
      const { error } = await alice.client.storage.from(DOCUMENTS_BUCKET).upload(doc.storage_path, body(), { contentType: 'text/plain' });
      if (!error) uploadedPaths.push(doc.storage_path);
      expect(error).not.toBeNull();
    });

    it('should not let another user download or delete the owner object', async () => {
      const doc = await reserveOk('private.txt');
      await adminClient().storage.from(DOCUMENTS_BUCKET).upload(doc.storage_path, body(), { contentType: 'text/plain' });
      uploadedPaths.push(doc.storage_path);

      const download = await bob.client.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path);
      expect(download.error).not.toBeNull();

      const removed = await bob.client.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
      expect(removed.data ?? []).toHaveLength(0);
      const stillThere = await adminClient().storage.from(DOCUMENTS_BUCKET).download(doc.storage_path);
      expect(stillThere.error).toBeNull();
    });
  });
});
