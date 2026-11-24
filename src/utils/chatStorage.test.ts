import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_HISTORY_STORAGE_KEY,
  MAX_PERSISTED_MESSAGES,
  clearPersistedChatHistory,
  loadPersistedChatHistory,
  sanitizePersistedMessages,
  savePersistedChatHistory,
  type StorageLike,
} from './chatStorage.ts';
import type { LlmChatMessage } from '../types/sales.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => {
      map.set(key, val);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('sanitizePersistedMessages filters invalid or empty streaming placeholders', () => {
  const cleaned = sanitizePersistedMessages([
    { role: 'user', content: 'How does IQR work?', timestamp: '3:40 PM' },
    { role: 'assistant', content: '   ', timestamp: '3:40 PM' },
    { role: 'system', content: 'bad role', timestamp: '3:40 PM' },
    { role: 'assistant', content: 'IQR uses Q3 + 1.5 * IQR.', timestamp: '3:40 PM' },
    null,
  ]);

  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].role, 'user');
  assert.equal(cleaned[1].content, 'IQR uses Q3 + 1.5 * IQR.');
});

test('save, load, cap, and clear persisted chat history', () => {
  const storage = createMemoryStorage();
  const many: LlmChatMessage[] = Array.from({ length: MAX_PERSISTED_MESSAGES + 10 }, (_, idx) => ({
    role: idx % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${idx + 1}`,
    timestamp: '3:45 PM',
  }));

  savePersistedChatHistory(many, storage);
  const loaded = loadPersistedChatHistory(storage);
  assert.equal(loaded.length, MAX_PERSISTED_MESSAGES);
  assert.equal(loaded[0].content, 'Message 11');
  assert.equal(loaded[loaded.length - 1].content, `Message ${MAX_PERSISTED_MESSAGES + 10}`);

  clearPersistedChatHistory(storage);
  assert.equal(loadPersistedChatHistory(storage).length, 0);
  assert.equal(storage.getItem(CHAT_HISTORY_STORAGE_KEY), null);
});

test('loadPersistedChatHistory recovers gracefully from malformed JSON', () => {
  const storage = createMemoryStorage();
  storage.setItem(CHAT_HISTORY_STORAGE_KEY, '{corrupted json');
  assert.deepEqual(loadPersistedChatHistory(storage), []);
});
