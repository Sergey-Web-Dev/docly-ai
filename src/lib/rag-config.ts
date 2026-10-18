// Starting values, tuned in Epic 03
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MIN_TEXT_CHARS = 50;
export const MAX_TEXT_CHARS = 150_000;
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;
export const MAX_CHUNKS = 200;
export const EMBEDDING_DIMENSIONS = 768;
export const EMBED_BATCH_SIZE = 100;
export const MATCH_COUNT = 5;
export const MIN_SIMILARITY = 0.55;
export const MAX_MESSAGE_CHARS = 1000;
// Chat time budget: the route has maxDuration = 30 s, so the whole pipeline gets 25 s.
export const CHAT_DEADLINE_MS = 25_000;
export const QUERY_EMBED_TIMEOUT_MS = 5_000;
// Gemini Flash-Lite answers in ~5 s but has latency spikes; the request deadline (25 s) still caps it.
export const GENERATION_TIMEOUT_MS = 20_000;
export const RETRY_BACKOFF_MS = 1_500;
// A retry is only worth starting when the backoff plus this much time is still left.
export const MIN_RETRY_ATTEMPT_MS = 6_000;
// Thinking config is intentionally omitted (lite models may not support it), so leave headroom for hidden thinking tokens.
export const MAX_OUTPUT_TOKENS = 1024;
