import type { LlmChatMessage } from '../types/sales.ts';

export const CHAT_HISTORY_STORAGE_KEY = 'uniqlo_ai_assistant_history_v1';
export const MAX_PERSISTED_MESSAGES = 40;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function sanitizePersistedMessages(raw: unknown): LlmChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const valid: LlmChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<LlmChatMessage>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant') continue;
    if (typeof candidate.content !== 'string' || !candidate.content.trim()) continue;
    const timestamp =
      typeof candidate.timestamp === 'string' && candidate.timestamp.trim()
        ? candidate.timestamp.slice(0, 32)
        : '';
    valid.push({
      role: candidate.role,
      content: candidate.content.slice(0, 8000),
      timestamp,
    });
  }
  return valid.slice(-MAX_PERSISTED_MESSAGES);
}

export function loadPersistedChatHistory(storage: StorageLike | null = getDefaultStorage()): LlmChatMessage[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return sanitizePersistedMessages(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function savePersistedChatHistory(
  messages: LlmChatMessage[],
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  const finalized = sanitizePersistedMessages(messages);
  try {
    if (finalized.length === 0) {
      storage.removeItem(CHAT_HISTORY_STORAGE_KEY);
    } else {
      storage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(finalized));
    }
  } catch {
    // Ignore storage quota or private-mode restriction errors cleanly.
  }
}

export function clearPersistedChatHistory(storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CHAT_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage errors cleanly.
  }
}
